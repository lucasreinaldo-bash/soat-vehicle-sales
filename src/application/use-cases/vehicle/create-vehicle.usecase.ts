import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Vehicle } from '../../../domain/vehicle/vehicle.entity';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { VEHICLE_REPOSITORY_TOKEN } from '../../ports/tokens';

export interface CreateVehicleInput {
  brand: string;
  model: string;
  year: number;
  color: string;
  price: number;
}

@Injectable()
export class CreateVehicleUseCase {
  constructor(
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
  ) {}

  async execute(input: CreateVehicleInput): Promise<Vehicle> {
    const vehicle = Vehicle.create(randomUUID(), input);
    return this.vehicleRepository.save(vehicle);
  }
}
