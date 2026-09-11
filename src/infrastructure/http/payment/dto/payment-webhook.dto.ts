import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { PaymentWebhookStatus } from '../../../../application/use-cases/sale/process-payment-webhook.usecase';

export class PaymentWebhookDto {
  @ApiProperty({
    example: 'PAY-4b4c2a2c-2f9d-4a0f-9a6e-0d9a0c5e1f11',
    description: 'Código do pagamento devolvido ao efetuar a venda',
  })
  @IsString()
  @IsNotEmpty()
  paymentCode: string;

  @ApiProperty({
    enum: ['PAID', 'CANCELLED'],
    example: 'PAID',
    description: 'PAID = pagamento efetuado; CANCELLED = pagamento cancelado',
  })
  @IsIn(['PAID', 'CANCELLED'])
  status: PaymentWebhookStatus;
}
