import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Sale } from '../../../domain/sale/sale.entity';
import {
  VehicleNotAvailableError,
  VehicleNotFoundError,
} from '../../../domain/vehicle/vehicle.errors';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { IPaymentGateway } from '../../ports/payment-gateway.port';
import { IUnitOfWork } from '../../ports/unit-of-work.port';
import {
  PAYMENT_GATEWAY_TOKEN,
  UNIT_OF_WORK_TOKEN,
  VEHICLE_REPOSITORY_TOKEN,
} from '../../ports/tokens';

export interface PurchaseVehicleInput {
  vehicleId: string;
  /** Identificador opaco do cliente no serviço de identidade. */
  buyerId: string;
}

export interface PurchaseVehicleOutput {
  sale: Sale;
  paymentCode: string;
}

/**
 * Compra de um veículo por um cliente cadastrado. Não conclui a venda de
 * imediato: cria uma Sale em PENDING_PAYMENT, aciona o gateway de pagamento e
 * move o veículo para RESERVED (sai do catálogo "à venda", mas ainda não entra
 * em "vendidos"). A efetivação chega de forma assíncrona pelo webhook de
 * pagamento (ver ProcessPaymentWebhookUseCase), identificada pelo `paymentCode`.
 *
 * O comprador chega aqui apenas como um id. Quem garante que ele está
 * cadastrado é a borda HTTP, ao validar o token do serviço de identidade — este
 * caso de uso não conhece autenticação e não recebe nenhum dado pessoal.
 *
 * Duas decisões de ordem das operações:
 *  1. A chamada ao gateway acontece FORA da transação de banco: manter uma
 *     transação aberta durante I/O de rede seguraria conexões e locks.
 *  2. A disponibilidade do veículo é revalidada DENTRO da transação, já que o
 *     estado pode ter mudado entre a leitura inicial e a escrita.
 */
@Injectable()
export class PurchaseVehicleUseCase {
  constructor(
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
    @Inject(PAYMENT_GATEWAY_TOKEN)
    private readonly paymentGateway: IPaymentGateway,
    @Inject(UNIT_OF_WORK_TOKEN)
    private readonly unitOfWork: IUnitOfWork,
  ) {}

  async execute(input: PurchaseVehicleInput): Promise<PurchaseVehicleOutput> {
    const vehicle = await this.vehicleRepository.findById(input.vehicleId);
    if (!vehicle) {
      throw new VehicleNotFoundError(input.vehicleId);
    }
    if (!vehicle.isAvailable()) {
      throw new VehicleNotAvailableError(input.vehicleId);
    }

    const { paymentCode } = await this.paymentGateway.requestPayment({
      amount: vehicle.price,
      reference: vehicle.id,
    });

    return this.unitOfWork.execute(async ({ vehicles, sales }) => {
      const current = await vehicles.findById(input.vehicleId);
      if (!current) {
        throw new VehicleNotFoundError(input.vehicleId);
      }
      if (!current.isAvailable()) {
        throw new VehicleNotAvailableError(input.vehicleId);
      }

      const sale = Sale.create({
        id: randomUUID(),
        vehicleId: current.id,
        buyerId: input.buyerId,
        price: current.price,
        paymentCode,
      });

      const savedSale = await sales.save(sale);
      await vehicles.update(current.reserve());

      return { sale: savedSale, paymentCode };
    });
  }
}
