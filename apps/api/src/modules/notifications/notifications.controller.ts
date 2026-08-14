import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { hashToken } from 'src/common/crypto/tokens';
import { NotificationsService } from './notifications.service';

export class RegisterDeviceDto {
  @IsString()
  @MaxLength(64)
  deviceId: string;

  @IsEnum(['web', 'android', 'ios'] as const, { message: 'platform debe ser web, android o ios' })
  platform: 'web' | 'android' | 'ios';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pushToken?: string;

  /** Se envía en claro; el servidor guarda solo su hash. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  claimToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Registra el dispositivo para push y lo asocia al caso que reportó. */
  @Post('devices')
  async registerDevice(@Body() dto: RegisterDeviceDto) {
    const device = await this.notifications.registerDevice({
      deviceId: dto.deviceId,
      platform: dto.platform,
      pushToken: dto.pushToken,
      claimTokenHash: dto.claimToken ? hashToken(dto.claimToken) : undefined,
      locale: dto.locale,
    });
    return { id: device.id, deviceId: device.deviceId, registeredCases: device.claimTokenHashes.length };
  }

  /**
   * Historial de avisos de un reportante. Se autentica con el claim token, no
   * con una sesión: quien reporta no tiene cuenta.
   */
  @Get()
  async list(@Query('claimToken') claimToken: string) {
    if (!claimToken) return { items: [] };

    const items = await this.notifications.listForRecipient(hashToken(claimToken));
    return {
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        payload: n.payload,
        status: n.status,
        createdAt: n.createdAt,
        sentAt: n.sentAt,
      })),
    };
  }
}
