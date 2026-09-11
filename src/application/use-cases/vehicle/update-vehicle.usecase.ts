import { Inject, Injectable } from '@nestjs/common';
import { Vehicle } from '../../../domain/vehicle/vehicle.entity';
import { VehicleNotFoundError } from '../../../domain/vehicle/vehicle.errors';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { VEHICLE_REPOSITORY_TOKEN } from '../../ports/tokens';

export interface UpdateVehicleInput {
  id: string;
  brand?: string;
  model?: string;
  year?: number;
  color?: string;
  price?: number;
}

@Injectable()
export class UpdateVehicleUseCase {
  constructor(
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
  ) {}

  async execute(input: UpdateVehicleInput): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findById(input.id);
    if (!vehicle) {
      throw new VehicleNotFoundError(input.id);
    }

    const updated = vehicle.update(input);
    return this.vehicleRepository.update(updated);
  }
}
