import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IPaymentGateway,
  PaymentRequestResult,
} from '../../application/ports/payment-gateway.port';

/**
 * Adapter mock do gateway de pagamento: simula a criação de uma cobrança em um
 * processador externo (ex.: Mercado Pago), gerando um código de pagamento que
 * será usado depois pelo webhook (POST /payments/webhook) para confirmar ou
 * cancelar a venda. Não faz nenhuma chamada de rede — é o suficiente para o
 * propósito do desafio, e pode ser substituído por um adapter real sem tocar
 * em nenhuma camada de domínio/aplicação (Dependency Inversion Principle).
 */
@Injectable()
export class MockPaymentGatewayAdapter implements IPaymentGateway {
  // O mock não usa os dados da cobrança; a assinatura da porta permite omiti-los.
  requestPayment(): Promise<PaymentRequestResult> {
    return Promise.resolve({ paymentCode: `PAY-${randomUUID()}` });
  }
}
