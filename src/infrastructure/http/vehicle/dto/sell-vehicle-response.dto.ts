import { ApiProperty } from '@nestjs/swagger';
import { Sale, SaleStatus } from '../../../../domain/sale/sale.entity';

export class SellVehicleResponseDto {
  @ApiProperty() saleId: string;
  @ApiProperty() vehicleId: string;
  @ApiProperty() buyerCpf: string;
  @ApiProperty() price: number;
  @ApiProperty() saleDate: Date;
  @ApiProperty({ enum: SaleStatus }) status: SaleStatus;
  @ApiProperty({
    description: 'Código a ser usado pela entidade de pagamento para notificar o webhook',
  })
  paymentCode: string;

  static fromDomain(sale: Sale): SellVehicleResponseDto {
    const dto = new SellVehicleResponseDto();
    dto.saleId = sale.id;
    dto.vehicleId = sale.vehicleId;
    dto.buyerCpf = sale.buyerCpf;
    dto.price = Number(sale.price);
    dto.saleDate = sale.saleDate;
    dto.status = sale.status;
    dto.paymentCode = sale.paymentCode;
    return dto;
  }
}
