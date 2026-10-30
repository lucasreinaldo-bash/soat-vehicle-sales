export interface AuthConfig {
  /** Emissor esperado no claim `iss` (o realm do serviço de identidade). */
  issuer: string;
  /** Audiência esperada no claim `aud`: tokens emitidos para outras aplicações são recusados. */
  audience: string;
  /** Onde buscar as chaves públicas (JWKS) para validar a assinatura. */
  jwksUri: string;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/**
 * Lê a configuração de autenticação do ambiente e falha cedo, na subida, se
 * algo faltar. Subir a API sem saber validar tokens deixaria todas as rotas
 * protegidas respondendo erro — melhor nem iniciar.
 */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const obrigatorias = ['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URI'] as const;
  const faltando = obrigatorias.filter((chave) => !env[chave]);
  if (faltando.length > 0) {
    throw new Error(
      `Configuração de autenticação ausente: ${faltando.join(', ')}. ` +
        'Consulte o .env.example e o README para os valores do serviço de identidade.',
    );
  }
  return {
    issuer: env.AUTH_ISSUER as string,
    audience: env.AUTH_AUDIENCE as string,
    jwksUri: env.AUTH_JWKS_URI as string,
  };
}
