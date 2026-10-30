import { errors, jwtVerify, JWTVerifyGetKey } from 'jose';
import { AuthConfig } from './auth.config';
import { AuthenticatedUser } from './authenticated-user';

/** O token é inválido: assinatura, emissor, audiência, expiração ou formato. */
export class InvalidTokenError extends Error {}

/** Não foi possível consultar as chaves públicas do serviço de identidade. */
export class IdentityProviderUnavailableError extends Error {}

/**
 * Valida tokens JWT emitidos pelo serviço de identidade.
 *
 * Recebe o resolvedor de chaves por injeção: em produção, o JWKS remoto do
 * Keycloak; nos testes, um JWKS local. Assim a verificação é testável sem rede.
 */
export class JwtTokenVerifier {
  constructor(
    private readonly config: AuthConfig,
    private readonly keys: JWTVerifyGetKey,
  ) {}

  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['RS256'],
      });
      if (!payload.sub) {
        throw new InvalidTokenError('Token sem identificador do usuário (sub).');
      }
      return { id: payload.sub, roles: JwtTokenVerifier.realmRoles(payload) };
    } catch (erro) {
      if (erro instanceof InvalidTokenError) throw erro;
      // Falha ao buscar ou interpretar o JWKS é indisponibilidade do serviço de
      // identidade, não culpa de quem chamou: vira 503, não 401.
      if (erro instanceof errors.JWKSTimeout || erro instanceof errors.JWKSInvalid) {
        throw new IdentityProviderUnavailableError(erro.message);
      }
      if (erro instanceof errors.JOSEError) throw new InvalidTokenError(erro.message);
      throw new IdentityProviderUnavailableError(
        erro instanceof Error ? erro.message : 'Falha ao consultar o serviço de identidade.',
      );
    }
  }

  /** O Keycloak publica os papéis do realm em `realm_access.roles`. */
  private static realmRoles(payload: Record<string, unknown>): string[] {
    const acesso = payload.realm_access as { roles?: unknown } | undefined;
    return Array.isArray(acesso?.roles)
      ? acesso.roles.filter((papel): papel is string => typeof papel === 'string')
      : [];
  }
}
