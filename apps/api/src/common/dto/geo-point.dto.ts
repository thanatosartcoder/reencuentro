import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Coordenadas tal como las envia el cliente: lat/lon, no el orden GeoJSON. */
export class GeoPointDto {
  @Type(() => Number)
  @IsLatitude({ message: 'latitude debe estar entre -90 y 90' })
  latitude: number;

  @Type(() => Number)
  @IsLongitude({ message: 'longitude debe estar entre -180 y 180' })
  longitude: number;

  /**
   * Precision del GPS en metros. En zona montanosa y bajo techo colapsado la
   * lectura puede errar cientos de metros, y el matching debe saberlo para no
   * tratar una ubicacion difusa como si fuera exacta.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;
}
