import { ApiProperty } from '@nestjs/swagger';
import { Sale, SaleStatus } from '../../../../domain/sale/sale.entity';

export class SaleResponseDto {
  @ApiProperty() saleId: string;
  @ApiProperty() vehicleId: string;
  @ApiProperty() paymentCode: string;
  @ApiProperty({ enum: SaleStatus }) status: SaleStatus;
  @ApiProperty() price: number;
  @ApiProperty() saleDate: Date;
  @ApiProperty() updatedAt: Date;

  static fromDomain(sale: Sale): SaleResponseDto {
    const dto = new SaleResponseDto();
    dto.saleId = sale.id;
    dto.vehicleId = sale.vehicleId;
    dto.paymentCode = sale.paymentCode;
    dto.status = sale.status;
    dto.price = Number(sale.price);
    dto.saleDate = sale.saleDate;
    dto.updatedAt = sale.updatedAt;
    return dto;
  }
}
