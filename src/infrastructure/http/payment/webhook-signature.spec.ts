import { assinar, TOLERANCIA_SEGUNDOS, verificarAssinatura } from './webhook-signature';
import { segredoWebhookDoAmbiente } from './webhook-signature.guard';

const SEGREDO = 'segredo-compartilhado-de-teste';
const AGORA = 1_800_000_000;
const corpo = Buffer.from('{"paymentCode":"PAY-1","status":"PAID"}');

const verificar = (sobrescrever: Partial<Parameters<typeof verificarAssinatura>[0]> = {}) =>
  verificarAssinatura({
    segredo: SEGREDO,
    timestamp: String(AGORA),
    assinatura: assinar(SEGREDO, String(AGORA), corpo),
    corpo,
    agoraSegundos: AGORA,
    ...sobrescrever,
  });

describe('Assinatura HMAC do webhook', () => {
  it('aceita a assinatura correta', () => {
    expect(verificar()).toBe('valida');
  });

  it('formata a assinatura como sha256=<hex>', () => {
    expect(assinar(SEGREDO, '1', 'x')).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('recusa requisição sem assinatura ou sem timestamp', () => {
    expect(verificar({ assinatura: undefined })).toBe('ausente');
    expect(verificar({ timestamp: undefined })).toBe('ausente');
  });

  it('recusa assinatura feita com outro segredo', () => {
    expect(verificar({ assinatura: assinar('outro-segredo-qualquer', String(AGORA), corpo) })).toBe(
      'invalida',
    );
  });

  it('recusa corpo adulterado (ex.: CANCELLED trocado por PAID)', () => {
    const original = Buffer.from('{"paymentCode":"PAY-1","status":"CANCELLED"}');
    expect(verificar({ assinatura: assinar(SEGREDO, String(AGORA), original), corpo })).toBe(
      'invalida',
    );
  });

  it('recusa reaproveitar a assinatura trocando só o timestamp', () => {
    const antiga = assinar(SEGREDO, String(AGORA - 60), corpo);
    expect(verificar({ assinatura: antiga })).toBe('invalida');
  });

  it('recusa requisição antiga demais (replay)', () => {
    const velho = String(AGORA - TOLERANCIA_SEGUNDOS - 1);
    expect(verificar({ timestamp: velho, assinatura: assinar(SEGREDO, velho, corpo) })).toBe(
      'expirada',
    );
  });

  it('recusa timestamp no futuro além da tolerância', () => {
    const futuro = String(AGORA + TOLERANCIA_SEGUNDOS + 1);
    expect(verificar({ timestamp: futuro, assinatura: assinar(SEGREDO, futuro, corpo) })).toBe(
      'expirada',
    );
  });

  it('aceita dentro da janela de tolerância', () => {
    const recente = String(AGORA - TOLERANCIA_SEGUNDOS + 5);
    expect(verificar({ timestamp: recente, assinatura: assinar(SEGREDO, recente, corpo) })).toBe(
      'valida',
    );
  });

  it('recusa timestamp que não é número e assinatura de tamanho errado', () => {
    expect(verificar({ timestamp: 'ontem' })).toBe('invalida');
    expect(verificar({ assinatura: 'sha256=abc' })).toBe('invalida');
  });

  it('exige um segredo configurado com pelo menos 16 caracteres', () => {
    expect(() => segredoWebhookDoAmbiente({})).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    expect(() => segredoWebhookDoAmbiente({ PAYMENT_WEBHOOK_SECRET: 'curto' })).toThrow();
    expect(segredoWebhookDoAmbiente({ PAYMENT_WEBHOOK_SECRET: SEGREDO })).toBe(SEGREDO);
  });
});
