import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProcessPaymentWebhookUseCase } from '../../../application/use-cases/sale/process-payment-webhook.usecase';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { SaleResponseDto } from './dto/sale-response.dto';
import { Public } from '../auth/auth.decorators';
import {
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
  WebhookSignatureGuard,
} from './webhook-signature.guard';

@ApiTags('Pagamentos')
@Controller('payments')
export class PaymentController {
  constructor(private readonly processPaymentWebhook: ProcessPaymentWebhookUseCase) {}

  @Public()
  @UseGuards(WebhookSignatureGuard)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de pagamento',
    description:
      'Endpoint consumido pela entidade que processa o pagamento. A partir do código do pagamento, ' +
      'informa se o pagamento foi efetuado (PAID) ou cancelado (CANCELLED). ' +
      'PAID confirma a venda e marca o veículo como vendido; CANCELLED cancela a venda e devolve o ' +
      'veículo ao catálogo de disponíveis. A requisição precisa ser assinada com HMAC-SHA256 ' +
      'pelo processador de pagamento (veja os cabeçalhos).',
  })
  @ApiHeader({
    name: CABECALHO_TIMESTAMP,
    required: true,
    description:
      'Horário da notificação em segundos Unix. Aceito dentro de uma janela de 5 minutos.',
  })
  @ApiHeader({
    name: CABECALHO_ASSINATURA,
    required: true,
    description:
      'sha256=<HMAC-SHA256 em hexadecimal de "<timestamp>.<corpo bruto>", com o segredo compartilhado>',
  })
  @ApiResponse({ status: 200, description: 'Notificação processada', type: SaleResponseDto })
  @ApiResponse({ status: 401, description: 'Assinatura ausente, inválida ou expirada' })
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
