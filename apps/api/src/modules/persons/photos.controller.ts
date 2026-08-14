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
import { IsEnum, IsUUID } from 'class-validator';
import { PhotosService, UploadedPhoto } from './photos.service';
import { PhotoOwnerType } from './persons.enums';

class UploadPhotoDto {
  @IsUUID('4')
  clientUuid: string;

  @IsEnum(PhotoOwnerType)
  ownerType: PhotoOwnerType;

  @IsUUID('4')
  ownerId: string;
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
    });

    return {
      id: photo.id,
      url: `/media/${photo.storageKey}`,
      width: photo.width,
      height: photo.height,
      sizeBytes: photo.sizeBytes,
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
