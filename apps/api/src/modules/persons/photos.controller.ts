import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { PhotosService, UploadedPhoto } from './photos.service';
import { PhotoOwnerType } from './persons.enums';

class UploadPhotoDto {
  @IsUUID('4')
  clientUuid: string;

  @IsEnum(PhotoOwnerType)
  ownerType: PhotoOwnerType;

  @IsUUID('4')
  ownerId: string;

  /**
   * El claim token del reporte al que se adjunta.
   *
   * Es la credencial de quien reportó: el servidor la entregó una sola vez al
   * crear el caso y guarda únicamente su hash. Sin ella, conocer un `ownerId`
   * —que el listado público devuelve— bastaba para colgarle una foto a
   * cualquiera.
   *
   * 43 caracteres es la longitud de 32 bytes en base64url; el margen cubre un
   * token que llegue con relleno.
   */
  @IsString()
  @Length(43, 64)
  claimToken: string;
}

@Controller()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  /**
   * Sube una foto asociada a un reporte.
   *
   * Va en una petición aparte de la creación del reporte a propósito: en una
   * red intermitente el texto del reporte pesa unos pocos KB y debe llegar
   * cuanto antes, mientras que la foto puede reintentarse por su cuenta sin
   * bloquear el registro del caso.
   */
  @Post('personas/fotos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: UploadedPhoto | undefined, @Body() dto: UploadPhotoDto) {
    if (!file) throw new BadRequestException('Falta el archivo en el campo "file"');

    const photo = await this.photos.upload({
      file,
      clientUuid: dto.clientUuid,
      ownerType: dto.ownerType,
      ownerId: dto.ownerId,
      claimToken: dto.claimToken,
    });

    return {
      id: photo.id,
      url: `/media/${photo.storageKey}`,
      urlAvif: photo.avifStorageKey ? `/media/${photo.avifStorageKey}` : null,
      width: photo.width,
      height: photo.height,
      sizeBytes: photo.sizeBytes,
      avifSizeBytes: photo.avifSizeBytes,
    };
  }

  /**
   * Sirve una foto.
   *
   * Se transmite en flujo y nunca se lee entera a memoria: cada lector
   * concurrente sostendría su propia copia del archivo, y con suficientes
   * lectores eso tumba el proceso igual que una ráfaga de subidas.
   *
   * La clave se deriva del SHA-256 del contenido, así que un objeto no puede
   * cambiar: se marca inmutable y el navegador o el CDN dejan de volver a
   * pedirlo, que es lo que evita que cada vista del listado llegue al servidor.
   */
  @Get('media/*path')
  async serve(@Param('path') path: string | string[], @Res() res: Response) {
    const key = Array.isArray(path) ? path.join('/') : path;
    const { stream, contentType, size } = await this.photos.openStream(key);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (size !== undefined) res.setHeader('Content-Length', String(size));

    // Si el cliente aborta la descarga a media conexión —lo normal en una red
    // intermitente— hay que cerrar el flujo o el descriptor queda abierto.
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());

    stream.pipe(res);
  }
}
