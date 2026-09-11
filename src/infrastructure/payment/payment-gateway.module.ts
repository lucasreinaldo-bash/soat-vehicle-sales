import { Module } from '@nestjs/common';
import { MockPaymentGatewayAdapter } from './mock-payment-gateway.adapter';
import { PAYMENT_GATEWAY_TOKEN } from '../../application/ports/tokens';

/**
 * Binding da porta IPaymentGateway. Para integrar um provedor real basta
 * escrever outro adapter e trocar o `useClass` — nenhuma regra de negócio muda.
 */
@Module({
  providers: [{ provide: PAYMENT_GATEWAY_TOKEN, useClass: MockPaymentGatewayAdapter }],
  exports: [PAYMENT_GATEWAY_TOKEN],
})
export class PaymentGatewayModule {}
