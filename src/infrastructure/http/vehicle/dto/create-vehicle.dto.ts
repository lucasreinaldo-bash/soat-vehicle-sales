import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, Max, Min } from 'class-validator';

export class CreateVehicleDto {
  @ApiProperty({ example: 'Volkswagen', description: 'Marca do veículo' })
  @IsString()
  @IsNotEmpty()
  brand: string;

  @ApiProperty({ example: 'Gol', description: 'Modelo do veículo' })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({ example: 2022, description: 'Ano de fabricação' })
  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 'Prata', description: 'Cor do veículo' })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiProperty({ example: 79990.0, description: 'Preço de venda' })
  @IsNumber()
  @IsPositive()
  price: number;
}
