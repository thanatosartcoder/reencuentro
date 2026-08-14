import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export enum SyncOperationType {
  MISSING_REPORT = 'MISSING_REPORT',
  SIGHTING = 'SIGHTING',
  ZONE_REPORT = 'ZONE_REPORT',
  ZONE_VOTE = 'ZONE_VOTE',
}

export class PushOperation {
  /** Mismo UUID que la entidad que se va a crear: la clave de idempotencia. */
  @IsUUID('4')
  clientUuid: string;

  @IsEnum(SyncOperationType)
  type: SyncOperationType;

  /** Entidad sobre la que actúa la operación (por ejemplo, la zona que se vota). */
  @IsOptional()
  @IsUUID('4')
  targetId?: string;

  /** Cuerpo idéntico al que aceptaría el endpoint HTTP equivalente. */
  @IsObject()
  payload: Record<string, unknown>;
}

export class SyncPushDto {
  @IsArray()
  @ArrayMinSize(1)
  // Tope por lote: un dispositivo que estuvo días sin señal debe vaciar su cola
  // en varias tandas en lugar de en una petición que puede vencer por timeout
  // justo donde la red es peor.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PushOperation)
  operations: PushOperation[];
}
