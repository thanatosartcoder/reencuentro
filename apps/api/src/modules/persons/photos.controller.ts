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

  /** Sirve una foto. La ruta es opaca; no revela el contenido del reporte. */
  @Get('media/*path')
  async serve(@Param('path') path: string | string[], @Res() res: Response) {
    const key = Array.isArray(path) ? path.join('/') : path;
    const { buffer, mimeType } = await this.photos.read(key);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buffer);
  }
}
