import { Inject, Injectable } from '@nestjs/common';
import { Vehicle, VehicleStatus } from '../../../domain/vehicle/vehicle.entity';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { VEHICLE_REPOSITORY_TOKEN } from '../../ports/tokens';

/** Lista veículos à venda, do mais barato para o mais caro. */
@Injectable()
export class ListAvailableVehiclesUseCase {
  constructor(
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
  ) {}

  async execute(): Promise<Vehicle[]> {
    return this.vehicleRepository.findByStatus(VehicleStatus.AVAILABLE, 'price_asc');
  }
}
