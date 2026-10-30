import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verificarAssinatura } from './webhook-signature';

export const CABECALHO_ASSINATURA = 'x-webhook-signature';
export const CABECALHO_TIMESTAMP = 'x-webhook-timestamp';

/**
 * Lê o segredo compartilhado com o processador de pagamento e falha cedo, na
 * subida, se ele faltar ou for curto demais para resistir a força bruta.
 */
export function segredoWebhookDoAmbiente(env: NodeJS.ProcessEnv = process.env): string {
  const segredo = env.PAYMENT_WEBHOOK_SECRET;
  if (!segredo || segredo.length < 16) {
    throw new Error(
      'PAYMENT_WEBHOOK_SECRET ausente ou curto demais (mínimo de 16 caracteres). ' +
        'Ele é o segredo compartilhado com o processador de pagamento.',
    );
  }
  return segredo;
}

/**
 * O webhook não usa o token do serviço de identidade — quem chama é o
 * processador de pagamento, não um usuário. A autenticação dele é a assinatura
 * HMAC do corpo da requisição.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly segredo = segredoWebhookDoAmbiente();

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; rawBody?: Buffer }>();

    const resultado = verificarAssinatura({
      segredo: this.segredo,
      assinatura: req.headers[CABECALHO_ASSINATURA],
      timestamp: req.headers[CABECALHO_TIMESTAMP],
      corpo: req.rawBody,
    });

    if (resultado === 'valida') return true;
    const motivo = {
      ausente: `Assinatura ausente. Envie os cabeçalhos ${CABECALHO_ASSINATURA} e ${CABECALHO_TIMESTAMP}.`,
      expirada: 'Assinatura expirada: o timestamp está fora da janela de 5 minutos.',
      invalida: 'Assinatura do webhook inválida.',
    }[resultado];
    throw new UnauthorizedException(motivo);
  }
}
