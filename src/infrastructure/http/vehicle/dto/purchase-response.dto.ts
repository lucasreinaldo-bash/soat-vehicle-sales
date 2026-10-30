import { ApiProperty } from '@nestjs/swagger';
import { Sale, SaleStatus } from '../../../../domain/sale/sale.entity';

export class PurchaseResponseDto {
  @ApiProperty() saleId: string;
  @ApiProperty() vehicleId: string;
  @ApiProperty() price: number;
  @ApiProperty({ description: 'Data da compra, definida pelo servidor' }) saleDate: Date;
  @ApiProperty({ enum: SaleStatus }) status: SaleStatus;
  @ApiProperty({
    description: 'Código que a entidade de pagamento usa para notificar o webhook',
  })
  paymentCode: string;

  static fromDomain(sale: Sale): PurchaseResponseDto {
    const dto = new PurchaseResponseDto();
    dto.saleId = sale.id;
    dto.vehicleId = sale.vehicleId;
    dto.price = Number(sale.price);
    dto.saleDate = sale.saleDate;
    dto.status = sale.status;
    dto.paymentCode = sale.paymentCode;
    return dto;
  }
}
