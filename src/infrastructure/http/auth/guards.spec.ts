import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';
import { authConfigFromEnv } from './auth.config';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  IdentityProviderUnavailableError,
  InvalidTokenError,
  JwtTokenVerifier,
} from './jwt-token-verifier';
import { RolesGuard } from './roles.guard';

const contexto = (req: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const reflectorCom = (meta: Record<string, unknown>) =>
  ({ getAllAndOverride: (chave: string) => meta[chave] }) as unknown as Reflector;

describe('JwtAuthGuard', () => {
  const verifierQue = (resultado: () => Promise<unknown>) =>
    ({ verify: resultado }) as unknown as JwtTokenVerifier;

  it('libera rota pública sem token', async () => {
    const guard = new JwtAuthGuard(
      reflectorCom({ [IS_PUBLIC_KEY]: true }),
      verifierQue(() => Promise.reject(new Error('não deveria chamar'))),
    );
    await expect(guard.canActivate(contexto({ headers: {} }))).resolves.toBe(true);
  });

  it('exige token em rota não marcada como pública (seguro por padrão)', async () => {
    const guard = new JwtAuthGuard(
      reflectorCom({}),
      verifierQue(() => Promise.resolve({})),
    );
    await expect(guard.canActivate(contexto({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita esquema diferente de Bearer', async () => {
    const guard = new JwtAuthGuard(
      reflectorCom({}),
      verifierQue(() => Promise.resolve({})),
    );
    await expect(
      guard.canActivate(contexto({ headers: { authorization: 'Basic dXNlcjpzZW5oYQ==' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('anexa o usuário à requisição quando o token é válido', async () => {
    const usuario = { id: 'u1', roles: ['customer'] };
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer abc' } };
    const guard = new JwtAuthGuard(
      reflectorCom({}),
      verifierQue(() => Promise.resolve(usuario)),
    );
    await expect(guard.canActivate(contexto(req))).resolves.toBe(true);
    expect(req.user).toEqual(usuario);
  });

  it('token inválido vira 401', async () => {
    const guard = new JwtAuthGuard(
      reflectorCom({}),
      verifierQue(() => Promise.reject(new InvalidTokenError('x'))),
    );
    await expect(
      guard.canActivate(contexto({ headers: { authorization: 'Bearer abc' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('serviço de identidade fora do ar vira 503, não 401', async () => {
    const guard = new JwtAuthGuard(
      reflectorCom({}),
      verifierQue(() => Promise.reject(new IdentityProviderUnavailableError('x'))),
    );
    await expect(
      guard.canActivate(contexto({ headers: { authorization: 'Bearer abc' } })),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('RolesGuard', () => {
  it('libera rota sem papel exigido', () => {
    expect(
      new RolesGuard(reflectorCom({})).canActivate(contexto({ user: { id: 'u', roles: [] } })),
    ).toBe(true);
  });

  it('libera quem tem o papel exigido', () => {
    const guard = new RolesGuard(reflectorCom({ [ROLES_KEY]: ['admin'] }));
    expect(guard.canActivate(contexto({ user: { id: 'u', roles: ['admin'] } }))).toBe(true);
  });

  it('recusa com 403 quem está autenticado mas não tem o papel', () => {
    const guard = new RolesGuard(reflectorCom({ [ROLES_KEY]: ['admin'] }));
    expect(() => guard.canActivate(contexto({ user: { id: 'u', roles: ['customer'] } }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('authConfigFromEnv', () => {
  it('falha na subida informando exatamente o que falta', () => {
    expect(() => authConfigFromEnv({ AUTH_ISSUER: 'x' })).toThrow(/AUTH_AUDIENCE, AUTH_JWKS_URI/);
  });

  it('lê a configuração completa', () => {
    expect(
      authConfigFromEnv({ AUTH_ISSUER: 'i', AUTH_AUDIENCE: 'a', AUTH_JWKS_URI: 'http://j' }),
    ).toEqual({ issuer: 'i', audience: 'a', jwksUri: 'http://j' });
  });
});
