import { createHmac, timingSafeEqual } from 'crypto';

/** Janela de validade do timestamp: protege contra reenvio (replay) de uma requisição capturada. */
export const TOLERANCIA_SEGUNDOS = 300;

export type ResultadoVerificacao = 'valida' | 'ausente' | 'expirada' | 'invalida';

/**
 * Assina `timestamp.corpo` com HMAC-SHA256. Incluir o timestamp na assinatura
 * impede que um atacante reaproveite uma assinatura antiga trocando só o horário.
 */
export function assinar(segredo: string, timestamp: string, corpo: Buffer | string): string {
  const hmac = createHmac('sha256', segredo);
  hmac.update(`${timestamp}.`);
  hmac.update(corpo);
  return `sha256=${hmac.digest('hex')}`;
}

export function verificarAssinatura(params: {
  segredo: string;
  assinatura?: string;
  timestamp?: string;
  corpo?: Buffer;
  agoraSegundos?: number;
}): ResultadoVerificacao {
  const { segredo, assinatura, timestamp, corpo } = params;
  if (!assinatura || !timestamp || !corpo) return 'ausente';
  if (!/^\d+$/.test(timestamp)) return 'invalida';

  const agora = params.agoraSegundos ?? Math.floor(Date.now() / 1000);
  // Valor absoluto: rejeita também timestamps no futuro (relógio adulterado).
  if (Math.abs(agora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) return 'expirada';

  const esperada = Buffer.from(assinar(segredo, timestamp, corpo));
  const recebida = Buffer.from(assinatura);
  // Comparação em tempo constante: não vaza, pelo tempo de resposta, quantos
  // caracteres da assinatura estavam certos.
  if (esperada.length !== recebida.length) return 'invalida';
  return timingSafeEqual(esperada, recebida) ? 'valida' : 'invalida';
}
