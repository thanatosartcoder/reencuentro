import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import sharp from 'sharp';
import { PersonPhoto } from './entities/person-photo.entity';
import { PhotoOwnerType } from './persons.enums';

/** Formato al que se normaliza todo: una sola ruta de decodificación. */
const OUTPUT_FORMAT = 'jpeg';

/**
 * Lado mayor tras el redimensionado. Suficiente para que un rostro sea
 * reconocible por una persona y por un comparador facial, y lo bastante
 * pequeño para subirse por una red saturada.
 */
const MAX_DIMENSION = 1280;

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

  constructor(
    @InjectRepository(PersonPhoto)
    private readonly repo: Repository<PersonPhoto>,
    private readonly config: ConfigService,
  ) {}

  private get uploadsDir(): string {
    return resolve(this.config.get<string>('uploads.dir') ?? './uploads');
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
  }): Promise<PersonPhoto> {
    if (!ALLOWED_MIME.has(input.file.mimetype)) {
      throw new BadRequestException(`Formato no admitido: ${input.file.mimetype}`);
    }

    const existing = await this.repo.findOne({ where: { clientUuid: input.clientUuid } });
    if (existing) return existing;

    const pipeline = sharp(input.file.buffer, { failOn: 'none' })
      // Respeta la orientación EXIF antes de descartar los metadatos, para que
      // las fotos verticales no queden acostadas.
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .toFormat(OUTPUT_FORMAT, { quality: 78, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    const key = `${input.ownerType.toLowerCase()}/${input.ownerId}/${input.clientUuid}.jpg`;
    const fullPath = join(this.uploadsDir, key);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, data);

    const perceptualHash = await this.averageHash(data);

    return this.repo.save(
      this.repo.create({
        clientUuid: input.clientUuid,
        ownerType: input.ownerType,
        missingReportId: input.ownerType === PhotoOwnerType.MISSING_REPORT ? input.ownerId : null,
        sightingReportId: input.ownerType === PhotoOwnerType.SIGHTING_REPORT ? input.ownerId : null,
        storageKey: key,
        mimeType: `image/${OUTPUT_FORMAT}`,
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
   * Average hash: reduce la imagen a 8x8 en gris y marca cada píxel según esté
   * por encima o por debajo del promedio. Detecta que dos reportes subieron la
   * misma foto (algo frecuente cuando varios familiares reportan por separado)
   * sin necesidad de invocar un servicio de comparación facial.
   */
  private async averageHash(buffer: Buffer): Promise<string> {
    const pixels = await sharp(buffer).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();

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

  /** Lee un archivo del almacenamiento, impidiendo salir del directorio raíz. */
  async read(storageKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const root = this.uploadsDir;
    const target = resolve(root, normalize(storageKey));

    // Sin esta comprobación, una clave como "../../.env" leería archivos fuera
    // del almacenamiento de fotos.
    if (!target.startsWith(root + '/')) {
      throw new NotFoundException('Archivo no encontrado');
    }

    try {
      return { buffer: await readFile(target), mimeType: 'image/jpeg' };
    } catch {
      throw new NotFoundException('Archivo no encontrado');
    }
  }

  /** Fotos duplicadas de una dada, por hash perceptual exacto. */
  async findDuplicates(perceptualHash: string): Promise<PersonPhoto[]> {
    return this.repo.find({ where: { perceptualHash }, take: 20 });
  }
}
