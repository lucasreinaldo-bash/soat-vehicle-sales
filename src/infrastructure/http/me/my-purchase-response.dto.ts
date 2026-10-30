import { ApiProperty } from '@nestjs/swagger';
import { SaleStatus } from '../../../domain/sale/sale.entity';
import { MyPurchase } from '../../../application/use-cases/sale/list-my-purchases.usecase';

class PurchasedVehicleDto {
  @ApiProperty() id: string;
  @ApiProperty() brand: string;
  @ApiProperty() model: string;
  @ApiProperty() year: number;
  @ApiProperty() color: string;
}

export class MyPurchaseResponseDto {
  @ApiProperty() saleId: string;
  @ApiProperty({ enum: SaleStatus }) status: SaleStatus;
  @ApiProperty() price: number;
  @ApiProperty() saleDate: Date;
  @ApiProperty() paymentCode: string;
  @ApiProperty({ type: PurchasedVehicleDto, nullable: true }) vehicle: PurchasedVehicleDto | null;

  static fromDomain({ sale, vehicle }: MyPurchase): MyPurchaseResponseDto {
    const dto = new MyPurchaseResponseDto();
    dto.saleId = sale.id;
    dto.status = sale.status;
    dto.price = Number(sale.price);
    dto.saleDate = sale.saleDate;
    dto.paymentCode = sale.paymentCode;
    dto.vehicle = vehicle
      ? {
          id: vehicle.id,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
          color: vehicle.color,
        }
      : null;
    return dto;
  }
}
