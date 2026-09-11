import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SellVehicleDto {
  @ApiProperty({
    example: '52998224725',
    description: 'CPF (com ou sem máscara) da pessoa que comprou o veículo',
  })
  @IsString()
  @IsNotEmpty()
  buyerCpf: string;
}
