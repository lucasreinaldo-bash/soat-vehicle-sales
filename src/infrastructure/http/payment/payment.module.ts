import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { ProcessPaymentWebhookUseCase } from '../../../application/use-cases/sale/process-payment-webhook.usecase';
import { PersistenceModule } from '../../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  controllers: [PaymentController],
  providers: [ProcessPaymentWebhookUseCase],
})
export class PaymentModule {}
