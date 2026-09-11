import { Inject, Injectable } from '@nestjs/common';
import { Vehicle } from '../../../domain/vehicle/vehicle.entity';
import { VehicleNotFoundError } from '../../../domain/vehicle/vehicle.errors';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { VEHICLE_REPOSITORY_TOKEN } from '../../ports/tokens';

@Injectable()
export class GetVehicleUseCase {
  constructor(
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
  ) {}

  async execute(id: string): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findById(id);
    if (!vehicle) {
      throw new VehicleNotFoundError(id);
    }
    return vehicle;
  }
}
