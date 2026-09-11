import { Inject, Injectable } from '@nestjs/common';
import { Sale } from '../../../domain/sale/sale.entity';
import { SaleAlreadyProcessedError, SaleNotFoundError } from '../../../domain/sale/sale.errors';
import { VehicleNotFoundError } from '../../../domain/vehicle/vehicle.errors';
import { IUnitOfWork } from '../../ports/unit-of-work.port';
import { UNIT_OF_WORK_TOKEN } from '../../ports/tokens';

export type PaymentWebhookStatus = 'PAID' | 'CANCELLED';

export interface ProcessPaymentWebhookInput {
  paymentCode: string;
  status: PaymentWebhookStatus;
}

/**
 * Processa a notificação da entidade que processa o pagamento. A partir do
 * `paymentCode` (gerado em SellVehicleUseCase), confirma ou cancela a venda:
 *  - PAID      -> Sale.PAID       + Vehicle.SOLD      (venda concluída)
 *  - CANCELLED -> Sale.CANCELLED  + Vehicle.AVAILABLE (volta ao catálogo)
 *
 * As duas escritas ocorrem na mesma transação: é inaceitável uma venda marcada
 * como paga com o veículo ainda anunciado como disponível, ou vice-versa.
 *
 * Idempotente por rejeição: uma Sale que não esteja mais PENDING_PAYMENT recusa
 * nova notificação com ConflictError, protegendo contra reentrega do webhook.
 */
@Injectable()
export class ProcessPaymentWebhookUseCase {
  constructor(
    @Inject(UNIT_OF_WORK_TOKEN)
    private readonly unitOfWork: IUnitOfWork,
  ) {}

  execute(input: ProcessPaymentWebhookInput): Promise<Sale> {
    return this.unitOfWork.execute(async ({ sales, vehicles }) => {
      const sale = await sales.findByPaymentCode(input.paymentCode);
      if (!sale) {
        throw new SaleNotFoundError(input.paymentCode);
      }
      if (!sale.isPending()) {
        throw new SaleAlreadyProcessedError(input.paymentCode, sale.status);
      }

      const vehicle = await vehicles.findById(sale.vehicleId);
      if (!vehicle) {
        throw new VehicleNotFoundError(sale.vehicleId);
      }

      if (input.status === 'PAID') {
        const confirmedSale = sale.confirmPayment();
        await sales.update(confirmedSale);
        await vehicles.update(vehicle.markAsSold());
        return confirmedSale;
      }

      const cancelledSale = sale.cancelPayment();
      await sales.update(cancelledSale);
      await vehicles.update(vehicle.releaseBackToCatalog());
      return cancelledSale;
    });
  }
}
