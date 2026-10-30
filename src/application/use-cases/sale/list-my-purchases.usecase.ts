import { Inject, Injectable } from '@nestjs/common';
import { Sale } from '../../../domain/sale/sale.entity';
import { Vehicle } from '../../../domain/vehicle/vehicle.entity';
import { ISaleRepository } from '../../ports/sale.repository.port';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { SALE_REPOSITORY_TOKEN, VEHICLE_REPOSITORY_TOKEN } from '../../ports/tokens';

export interface MyPurchase {
  sale: Sale;
  vehicle: Vehicle | null;
}

/**
 * Compras do próprio cliente, da mais recente para a mais antiga. O filtro é
 * pelo id do comprador vindo do token — um cliente nunca enxerga compras de
 * outro, porque não existe parâmetro que permita escolher de quem consultar.
 */
@Injectable()
export class ListMyPurchasesUseCase {
  constructor(
    @Inject(SALE_REPOSITORY_TOKEN)
    private readonly saleRepository: ISaleRepository,
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
  ) {}

  async execute(buyerId: string): Promise<MyPurchase[]> {
    const compras = await this.saleRepository.findByBuyerId(buyerId);
    return Promise.all(
      compras.map(async (sale) => ({
        sale,
        vehicle: await this.vehicleRepository.findById(sale.vehicleId),
      })),
    );
  }
}
