import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateVehicleDto {
  @ApiPropertyOptional({ example: 'Volkswagen' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  brand?: string;

  @ApiPropertyOptional({ example: 'Gol' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  model?: string;

  @ApiPropertyOptional({ example: 2022 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ example: 'Prata' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  color?: string;

  @ApiPropertyOptional({ example: 74990.0 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;
}
