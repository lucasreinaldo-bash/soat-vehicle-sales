import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProcessPaymentWebhookUseCase } from '../../../application/use-cases/sale/process-payment-webhook.usecase';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { SaleResponseDto } from './dto/sale-response.dto';

@ApiTags('Pagamentos')
@Controller('payments')
export class PaymentController {
  constructor(private readonly processPaymentWebhook: ProcessPaymentWebhookUseCase) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de pagamento',
    description:
      'Endpoint consumido pela entidade que processa o pagamento. A partir do código do pagamento, ' +
      'informa se o pagamento foi efetuado (PAID) ou cancelado (CANCELLED). ' +
      'PAID confirma a venda e marca o veículo como vendido; CANCELLED cancela a venda e devolve o ' +
      'veículo ao catálogo de disponíveis.',
  })
  @ApiResponse({ status: 200, description: 'Notificação processada', type: SaleResponseDto })
  @ApiResponse({ status: 404, description: 'Código de pagamento não encontrado' })
  @ApiResponse({ status: 409, description: 'Pagamento já processado anteriormente' })
  async handleWebhook(@Body() dto: PaymentWebhookDto): Promise<SaleResponseDto> {
    const sale = await this.processPaymentWebhook.execute({
      paymentCode: dto.paymentCode,
      status: dto.status,
    });
    return SaleResponseDto.fromDomain(sale);
  }
}
