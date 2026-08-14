import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { MissingStatus, Sex } from '../persons.enums';

export class QueryMissingDto extends PaginationDto {
  /** Busqueda difusa por nombre; tolera tildes ausentes y errores de tipeo. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  municipality?: string;

  @IsOptional()
  @IsEnum(MissingStatus)
  status?: MissingStatus;

  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  ageFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  ageTo?: number;

  /** Solo menores de edad: la busqueda de ninos se prioriza. */
  @IsOptional()
  @Type(() => Boolean)
  minorsOnly?: boolean;
}
