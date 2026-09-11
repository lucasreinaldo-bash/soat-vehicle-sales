import { Decimal } from '@prisma/client/runtime/library';

export interface PaymentRequest {
  amount: Decimal;
  reference: string;
}

export interface PaymentRequestResult {
  /** Código único que a entidade de pagamento usará para notificar o webhook. */
  paymentCode: string;
}

/**
 * Porta para o gateway de pagamento externo. Em produção seria implementada
 * por um adapter que fala HTTP com o provedor real (Mercado Pago, Stripe, etc.);
 * neste desafio usamos um MockPaymentGatewayAdapter (ver infrastructure/payment)
 * que apenas gera um código de pagamento, simulando a criação de uma cobrança.
 * Trocar o provedor de pagamento não exige tocar em nenhuma regra de negócio.
 */
export interface IPaymentGateway {
  requestPayment(request: PaymentRequest): Promise<PaymentRequestResult>;
}
