import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import sharp from 'sharp';
import { Semaphore } from 'src/common/concurrency/semaphore';
import { tokensMatch } from 'src/common/crypto/tokens';
import { StorageService } from 'src/modules/storage/storage.service';
import { StorageObjectNotFound } from 'src/modules/storage/storage.types';
import { MissingPersonReport } from './entities/missing-person-report.entity';
import { SightingReport } from './entities/sighting-report.entity';
import { PersonPhoto } from './entities/person-photo.entity';
import { PhotoOwnerType } from './persons.enums';

/**
 * Recepción y almacenamiento de fotos.
 *
 * Las tres protecciones de este archivo salen de una misma medición: una foto
 * de 12 megapíxeles ocupa unos 35 MB al decodificarse, y el límite por defecto
 * de sharp admite hasta 268 megapíxeles, es decir 0,7 GB por imagen. Sin topes,
 * una ráfaga de subidas agota la memoria y mata el proceso — llevándose por
 * delante los reportes de personas, que no tienen nada que ver con las fotos.
 */

/**
 * Formato de salida.
 *
 * WebP por defecto: sobre una imagen de perfil fotográfico pesa entre un 24 y
 * un 37% menos que el JPEG equivalente por unos 15 ms más de codificación, y su
 * soporte es universal desde hace años. En una app pensada para redes de
 * emergencia, un tercio menos de bytes es un tercio menos de tiempo esperando
 * a que cargue la cara de alguien.
 *
 * AVIF comprime todavía más, pero codificar cuesta varias veces lo mismo y ese
 * coste se paga justo durante las ráfagas de subidas, que es el escenario que
 * los topes de este archivo intentan sobrevivir. Queda disponible por
 * configuración para quien tenga CPU de sobra.
 */
type OutputFormat = 'webp' | 'jpeg' | 'avif';

const EXTENSION: Record<OutputFormat, string> = {
  webp: 'webp',
  jpeg: 'jpg',
  avif: 'avif',
};

/**
 * Lado mayor tras el redimensionado. Suficiente para que un rostro sea
 * reconocible por una persona y por un comparador facial, y lo bastante
 * pequeño para subirse por una red saturada.
 */
const MAX_DIMENSION = 1280;

/**
 * Tope de píxeles de entrada: 50 MP.
 *
 * Cubre con holgura cualquier cámara real —un teléfono tope de gama ronda los
 * 50 MP y una réflex profesional los 45— y rechaza de plano las bombas de
 * descompresión: un PNG de 20.000 × 20.000 pesa pocos cientos de kilobytes en
 * disco y 1,2 GB al descomprimir.
 */
const MAX_INPUT_PIXELS = 50_000_000;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  /**
   * Tope de decodificaciones simultáneas.
   *
   * Cuatro por defecto: con el tope de 50 MP, el peor caso son unos 600 MB de
   * pico, que un contenedor de 1 GB aguanta. Las subidas que no alcanzan cupo
   * esperan en cola en vez de competir por memoria.
   */
  private readonly gate: Semaphore;

  private readonly format: OutputFormat;
  private readonly quality: number;
  /** Si además del formato principal se genera una variante AVIF. */
  private readonly avifVariant: boolean;

  constructor(
    @InjectRepository(PersonPhoto)
    private readonly repo: Repository<PersonPhoto>,
    @InjectRepository(MissingPersonReport)
    private readonly missingRepo: Repository<MissingPersonReport>,
    @InjectRepository(SightingReport)
    private readonly sightingRepo: Repository<SightingReport>,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.gate = new Semaphore(this.config.get<number>('uploads.concurrency') ?? 4);
    this.format = (this.config.get<string>('uploads.format') as OutputFormat) ?? 'webp';
    this.quality = this.config.get<number>('uploads.quality') ?? 82;
    this.avifVariant = this.config.get<boolean>('uploads.avifVariant') ?? true;

    // libvips paraleliza internamente cada operación. Sumado al semáforo, sin
    // esto un solo redimensionado puede ocupar todos los núcleos y dejar sin
    // CPU al resto de la API.
    sharp.concurrency(2);
  }

  /**
   * Recibe una foto, la normaliza y la asocia a un reporte.
   *
   * Todo se recomprime al entrar en lugar de guardar el original: una foto de
   * 12 MB tomada con la cámara del teléfono multiplicada por miles de reportes
   * agota el almacenamiento, y en el otro extremo alguien la va a abrir desde
   * una conexión precaria.
   *
   * Recomprimir además descarta los metadatos EXIF, que en una foto de teléfono
   * suelen incluir las coordenadas GPS exactas de dónde se tomó. Ese dato no
   * puede viajar dentro de una imagen que se publica en un listado abierto.
   */
  async upload(input: {
    file: UploadedPhoto;
    clientUuid: string;
    ownerType: PhotoOwnerType;
    ownerId: string;
    claimToken: string;
  }): Promise<PersonPhoto> {
    // Lo primero, antes que nada: quién pregunta.
    //
    // Va delante del resto de comprobaciones a propósito. Después de esta línea
    // el archivo entra al decodificador de imágenes, que es código nativo
    // procesando bytes de un desconocido; no tiene por qué llegar ahí nadie que
    // no haya demostrado ser dueño del reporte.
    await this.assertOwnership(input.ownerType, input.ownerId, input.claimToken);

    if (!ALLOWED_MIME.has(input.file.mimetype)) {
      throw new BadRequestException(`Formato no admitido: ${input.file.mimetype}`);
    }

    const maxBytes = this.config.get<number>('uploads.maxBytes') ?? 8_000_000;
    if (input.file.size > maxBytes) {
      throw new BadRequestException(
        `La foto pesa ${Math.round(input.file.size / 1048576)} MB y el máximo es ${Math.round(maxBytes / 1048576)} MB`,
      );
    }

    const existing = await this.repo.findOne({ where: { clientUuid: input.clientUuid } });
    if (existing) return existing;

    // El espacio se consulta antes de procesar. Con almacenamiento de objetos
    // siempre pasa; con disco local protege a la base de datos, que comparte
    // volumen.
    const room = await this.storage.hasRoomFor(maxBytes);
    if (!room.ok) {
      this.logger.error(
        `Sin espacio para fotos (libres: ${Math.round((room.freeBytes ?? 0) / 1048576)} MB)`,
      );
      throw new ServiceUnavailableException(
        'No hay espacio para almacenar fotos en este momento. El reporte sí se guardó; ' +
          'puedes añadir la foto más tarde.',
      );
    }

    // Decodificar es lo caro y se hace una sola vez; de ese mismo búfer salen
    // las dos variantes. Todo dentro del semáforo, que es lo que acota la
    // memoria durante una ráfaga.
    const { primary, avif } = await this.gate.run(async () => {
      const resized = sharp(input.file.buffer, {
        failOn: 'none',
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        // Respeta la orientación EXIF antes de descartar los metadatos, para que
        // las fotos verticales no queden acostadas.
        .rotate()
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
          // Lanczos conserva mejor los bordes al reducir que el filtro por
          // defecto. En una foto que se va a usar para reconocer una cara, la
          // nitidez de los rasgos es justo lo que no se puede perder.
          kernel: 'lanczos3',
        });

      let encoded: { data: Buffer; info: sharp.OutputInfo };
      try {
        encoded = await this.encode(resized.clone(), this.format);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Sin esto, una imagen que supera el tope de píxeles o viene corrupta
        // sale como error 500 y quien reporta no entiende qué corregir.
        if (/pixel limit|unsupported image|Input buffer|premature end/i.test(message)) {
          throw new BadRequestException(
            'No se pudo procesar la imagen. Puede estar dañada o tener dimensiones ' +
              'excesivas (el máximo es 50 megapíxeles). Intenta con otra foto.',
          );
        }
        throw error;
      }

      // La variante AVIF es una mejora, no un requisito: si falla, la foto se
      // guarda igual. Perder la foto de un desaparecido porque un códec se
      // atragantó sería absurdo.
      let secondary: Buffer | null = null;
      if (this.avifVariant && this.format !== 'avif') {
        try {
          secondary = (await this.encode(resized.clone(), 'avif')).data;
        } catch (error) {
          this.logger.warn(
            `No se pudo generar la variante AVIF: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      return { primary: encoded, avif: secondary };
    });

    const data = primary.data;
    const info = primary.info;

    // La clave es el SHA-256 del resultado comprimido. Si esos bytes ya están
    // almacenados —la misma foto de WhatsApp que suben tres familiares— no se
    // vuelve a escribir nada.
    const stored = await this.storage.putContent(
      data,
      `image/${this.format}`,
      EXTENSION[this.format],
    );
    if (stored.deduplicated) {
      this.logger.debug(`Foto deduplicada: ${stored.contentHash.slice(0, 12)}…`);
    }

    const storedAvif = avif
      ? await this.storage.putContent(avif, 'image/avif', 'avif')
      : null;

    const perceptualHash = await this.averageHash(data);

    return this.repo.save(
      this.repo.create({
        clientUuid: input.clientUuid,
        ownerType: input.ownerType,
        missingReportId: input.ownerType === PhotoOwnerType.MISSING_REPORT ? input.ownerId : null,
        sightingReportId:
          input.ownerType === PhotoOwnerType.SIGHTING_REPORT ? input.ownerId : null,
        storageKey: stored.key,
        contentHash: stored.contentHash,
        avifStorageKey: storedAvif?.key ?? null,
        avifSizeBytes: avif?.length ?? null,
        mimeType: `image/${this.format}`,
        sizeBytes: data.length,
        width: info.width,
        height: info.height,
        perceptualHash,
        // El descriptor facial lo llena el proveedor biométrico cuando hay uno
        // configurado; sin él, el matching se apoya en las demás señales.
        faceDescriptor: null,
        hasFace: null,
      }),
    );
  }

  /**
   * Comprueba que quien sube la foto es quien creó el reporte.
   *
   * Hasta ahora este endpoint era público y aceptaba cualquier `ownerId`. Los
   * identificadores de los reportes no son secretos —el listado público los
   * devuelve en cada elemento—, así que cualquiera podía adjuntar la imagen que
   * quisiera al caso de cualquier desaparecido, y esa imagen se publicaba junto
   * a su nombre. En una plataforma donde la foto es lo que permite reconocer a
   * una persona, poder cambiársela a otro es poder impedir que la encuentren.
   *
   * La credencial es el claim token que el servidor entregó una sola vez al
   * crear el reporte. Se compara contra su hash y en tiempo constante, igual que
   * en el resto del sistema.
   *
   * El error no distingue entre "el reporte no existe" y "el token no es el
   * suyo": responder distinto convertiría este endpoint en una forma de
   * averiguar qué identificadores corresponden a un caso real.
   */
  private async assertOwnership(
    ownerType: PhotoOwnerType,
    ownerId: string,
    claimToken: string,
  ): Promise<void> {
    const noAutorizado = new UnauthorizedException(
      'El token de seguimiento no corresponde a este reporte.',
    );

    // Se piden solo las dos columnas que hacen falta. Traer la fila entera
    // descifraría documento, teléfono y correo en memoria para no mirarlos.
    const owner =
      ownerType === PhotoOwnerType.MISSING_REPORT
        ? await this.missingRepo.findOne({
            where: { id: ownerId },
            select: { id: true, claimTokenHash: true },
          })
        : await this.sightingRepo.findOne({
            where: { id: ownerId },
            select: { id: true, claimTokenHash: true },
          });

    if (!owner?.claimTokenHash) throw noAutorizado;
    if (!tokensMatch(claimToken, owner.claimTokenHash)) throw noAutorizado;
  }

  /** Aplica los ajustes de codificación de un formato a una tubería ya redimensionada. */
  private encode(
    pipeline: sharp.Sharp,
    format: OutputFormat,
  ): Promise<{ data: Buffer; info: sharp.OutputInfo }> {
    const encoded =
      format === 'webp'
        ? pipeline.webp({
            quality: this.quality,
            effort: 4,
            // Evita el submuestreo de color donde haría daño. Los tonos de piel
            // son lo primero que se degrada al submuestrear croma.
            smartSubsample: true,
          })
        : format === 'avif'
          ? // AVIF alcanza calidad equivalente con un número bastante menor: su
            // escala no es comparable a la de WebP o JPEG.
            pipeline.avif({ quality: Math.max(40, this.quality - 22), effort: 4 })
          : pipeline.jpeg({ quality: this.quality, mozjpeg: true, chromaSubsampling: '4:2:0' });

    return encoded.toBuffer({ resolveWithObject: true });
  }

  /**
   * Average hash: reduce la imagen a 8x8 en gris y marca cada píxel según esté
   * por encima o por debajo del promedio.
   *
   * Complementa al SHA-256, no lo repite: el SHA detecta bytes idénticos y
   * ahorra almacenamiento; este detecta imágenes *parecidas* —la misma foto
   * recortada o reenviada por otra aplicación que la recomprimió— y es una
   * señal para el motor de coincidencias.
   */
  private async averageHash(buffer: Buffer): Promise<string> {
    const pixels = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .greyscale()
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer();

    const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;

    let hash = '';
    for (let i = 0; i < pixels.length; i += 4) {
      let nibble = 0;
      for (let bit = 0; bit < 4; bit++) {
        if (pixels[i + bit] >= average) nibble |= 1 << (3 - bit);
      }
      hash += nibble.toString(16);
    }
    return hash;
  }

  /** Distancia de Hamming entre dos average hashes: 0 = idénticas. */
  static hammingDistance(a: string, b: string): number {
    if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
      let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    return distance;
  }

  /**
   * Devuelve un flujo, no el archivo entero.
   *
   * Leer la imagen completa a memoria en cada petición multiplica el consumo
   * por cada lector concurrente. Con flujo, el proceso solo sostiene el trozo
   * que va pasando hacia la red.
   */
  async openStream(storageKey: string) {
    try {
      return await this.storage.getStream(storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFound) {
        throw new NotFoundException('Archivo no encontrado');
      }
      throw error;
    }
  }

  /**
   * Desasocia una foto y borra los bytes solo si ningún otro reporte los usa.
   *
   * Con almacenamiento por contenido, varios reportes pueden compartir el mismo
   * objeto. Borrarlo al eliminar una referencia dejaría a los demás con una
   * imagen rota.
   */
  async remove(photoId: string): Promise<void> {
    const photo = await this.repo.findOne({ where: { id: photoId } });
    if (!photo) return;

    await this.repo.delete(photoId);

    const stillReferenced = await this.repo.count({
      where: { contentHash: photo.contentHash, id: Not(photoId) },
    });

    if (stillReferenced === 0) {
      await this.storage.delete(photo.storageKey);
    }
  }

  /** Fotos idénticas byte a byte, por hash de contenido. */
  async findByContentHash(contentHash: string): Promise<PersonPhoto[]> {
    return this.repo.find({ where: { contentHash }, take: 20 });
  }

  /** Fotos visualmente parecidas, por hash perceptual. */
  async findSimilar(perceptualHash: string): Promise<PersonPhoto[]> {
    return this.repo.find({ where: { perceptualHash }, take: 20 });
  }
}
