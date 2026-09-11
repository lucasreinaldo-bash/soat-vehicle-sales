import { ApiProperty } from '@nestjs/swagger';
import { Vehicle, VehicleStatus } from '../../../../domain/vehicle/vehicle.entity';

export class VehicleResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() brand: string;
  @ApiProperty() model: string;
  @ApiProperty() year: number;
  @ApiProperty() color: string;
  @ApiProperty() price: number;
  @ApiProperty({ enum: VehicleStatus }) status: VehicleStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static fromDomain(vehicle: Vehicle): VehicleResponseDto {
    const dto = new VehicleResponseDto();
    dto.id = vehicle.id;
    dto.brand = vehicle.brand;
    dto.model = vehicle.model;
    dto.year = vehicle.year;
    dto.color = vehicle.color;
    dto.price = Number(vehicle.price);
    dto.status = vehicle.status;
    dto.createdAt = vehicle.createdAt;
    dto.updatedAt = vehicle.updatedAt;
    return dto;
  }
}
