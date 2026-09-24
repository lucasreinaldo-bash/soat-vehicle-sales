import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SellVehicleDto {
  @ApiProperty({
    example: '52998224725',
    description: 'CPF (com ou sem máscara) da pessoa que comprou o veículo',
  })
  @IsString()
  @IsNotEmpty()
  buyerCpf: string;

  @ApiPropertyOptional({
    example: '2026-09-23T14:30:00.000Z',
    description:
      'Data da venda (ISO 8601). Se omitida, o sistema registra o instante atual — o caso normal. ' +
      'Informe apenas para lançar uma venda ocorrida em data anterior. Datas futuras são rejeitadas.',
  })
  @IsOptional()
  @IsDateString()
  saleDate?: string;
}
