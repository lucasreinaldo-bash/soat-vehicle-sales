import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Sale } from '../../../domain/sale/sale.entity';
import {
  VehicleNotAvailableError,
  VehicleNotFoundError,
} from '../../../domain/vehicle/vehicle.errors';
import { Cpf } from '../../../domain/shared/value-objects/cpf.vo';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { IPaymentGateway } from '../../ports/payment-gateway.port';
import { IUnitOfWork } from '../../ports/unit-of-work.port';
import {
  PAYMENT_GATEWAY_TOKEN,
  UNIT_OF_WORK_TOKEN,
  VEHICLE_REPOSITORY_TOKEN,
} from '../../ports/tokens';

export interface SellVehicleInput {
  vehicleId: string;
  buyerCpf: string;
  /** Opcional: informe apenas para registrar uma venda ocorrida em data anterior. */
  saleDate?: Date;
}

export interface SellVehicleOutput {
  sale: Sale;
  paymentCode: string;
}

/**
 * Efetua a venda de um veículo. Não conclui a venda de imediato: cria uma Sale
 * em PENDING_PAYMENT, aciona o gateway de pagamento e move o veículo para
 * RESERVED (sai do catálogo de "à venda" mas ainda não entra em "vendidos").
 * A confirmação definitiva chega de forma assíncrona pelo webhook de pagamento
 * (ver ProcessPaymentWebhookUseCase), identificado pelo `paymentCode` gerado
 * aqui — é essa peça de modelagem que conecta os dois requisitos do enunciado
 * ("efetuar a venda" e "webhook de pagamento").
 *
 * Duas decisões importantes de ordem das operações:
 *  1. A chamada ao gateway acontece FORA da transação de banco: manter uma
 *     transação aberta durante I/O de rede seguraria conexões e locks por tempo
 *     indeterminado.
 *  2. A disponibilidade do veículo é revalidada DENTRO da transação, já que o
 *     estado pode ter mudado entre a leitura inicial e a escrita.
 *
 * A data da venda (`saleDate`) é, por padrão, o instante do registro — a venda é
 * um fato observado pelo sistema, não uma preferência do chamador. O campo pode
 * ser informado explicitamente para lançar uma venda ocorrida em data anterior
 * (ex.: negociação fechada na loja física e digitada depois); datas futuras são
 * rejeitadas pelo domínio.
 */
@Injectable()
export class SellVehicleUseCase {
  constructor(
    @Inject(VEHICLE_REPOSITORY_TOKEN)
    private readonly vehicleRepository: IVehicleRepository,
    @Inject(PAYMENT_GATEWAY_TOKEN)
    private readonly paymentGateway: IPaymentGateway,
    @Inject(UNIT_OF_WORK_TOKEN)
    private readonly unitOfWork: IUnitOfWork,
  ) {}

  async execute(input: SellVehicleInput): Promise<SellVehicleOutput> {
    const vehicle = await this.vehicleRepository.findById(input.vehicleId);
    if (!vehicle) {
      throw new VehicleNotFoundError(input.vehicleId);
    }
    if (!vehicle.isAvailable()) {
      throw new VehicleNotAvailableError(input.vehicleId);
    }

    // Falha cedo em CPF inválido: nada é gravado e nenhuma cobrança é criada.
    const buyerCpf = Cpf.create(input.buyerCpf);

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
        buyerCpf,
        price: current.price,
        paymentCode,
        saleDate: input.saleDate,
      });

      const savedSale = await sales.save(sale);
      await vehicles.update(current.reserve());

      return { sale: savedSale, paymentCode };
    });
  }
}
