import { createLocalJWKSet, exportJWK, generateKeyPair, JWK, KeyLike, SignJWT } from 'jose';
import {
  IdentityProviderUnavailableError,
  InvalidTokenError,
  JwtTokenVerifier,
} from './jwt-token-verifier';

const config = {
  issuer: 'http://localhost:8180/realms/vehicle-sales',
  audience: 'vehicle-sales-api',
  jwksUri: 'http://nao-usado/certs',
};

describe('JwtTokenVerifier', () => {
  let privada: KeyLike;
  let outraPrivada: KeyLike;
  let verifier: JwtTokenVerifier;

  beforeAll(async () => {
    const par = await generateKeyPair('RS256');
    privada = par.privateKey;
    outraPrivada = (await generateKeyPair('RS256')).privateKey;
    const jwk: JWK = { ...(await exportJWK(par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    verifier = new JwtTokenVerifier(config, createLocalJWKSet({ keys: [jwk] }));
  });

  const assinar = (
    claims: Record<string, unknown> = { realm_access: { roles: ['customer'] } },
    opcoes: { iss?: string; aud?: string; sub?: string | null; exp?: string; chave?: KeyLike } = {},
  ) => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setIssuer(opcoes.iss ?? config.issuer)
      .setAudience(opcoes.aud ?? config.audience)
      .setExpirationTime(opcoes.exp ?? '5m');
    if (opcoes.sub !== null) jwt.setSubject(opcoes.sub ?? 'usuario-123');
    return jwt.sign(opcoes.chave ?? privada);
  };

  it('aceita um token válido e devolve o id (sub) e os papéis do realm', async () => {
    const usuario = await verifier.verify(
      await assinar({ realm_access: { roles: ['admin', 'offline_access'] } }),
    );
    expect(usuario).toEqual({ id: 'usuario-123', roles: ['admin', 'offline_access'] });
  });

  it('devolve lista vazia de papéis quando o token não traz realm_access', async () => {
    expect((await verifier.verify(await assinar({}))).roles).toEqual([]);
  });

  it('não expõe nenhum outro claim além de id e papéis', async () => {
    const usuario = await verifier.verify(
      await assinar({
        realm_access: { roles: ['customer'] },
        email: 'a@b.com',
        cpf: '52998224725',
      }),
    );
    expect(Object.keys(usuario).sort()).toEqual(['id', 'roles']);
  });

  it.each([
    ['expirado', { exp: '-1m' }],
    ['de outro emissor', { iss: 'http://atacante/realms/vehicle-sales' }],
    ['para outra audiência', { aud: 'outra-aplicacao' }],
    ['sem sub', { sub: null }],
  ])('rejeita token %s', async (_caso, opcoes) => {
    await expect(verifier.verify(await assinar(undefined, opcoes))).rejects.toThrow(
      InvalidTokenError,
    );
  });

  it('rejeita token assinado por outra chave', async () => {
    await expect(
      verifier.verify(await assinar(undefined, { chave: outraPrivada })),
    ).rejects.toThrow(InvalidTokenError);
  });

  it('rejeita token com algoritmo simétrico (ataque de confusão de algoritmo)', async () => {
    const hs = await new SignJWT({ realm_access: { roles: ['admin'] } })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('atacante')
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('segredo-qualquer-com-32-bytes-ok!'));
    await expect(verifier.verify(hs)).rejects.toThrow(InvalidTokenError);
  });

  it('rejeita texto que não é JWT', async () => {
    await expect(verifier.verify('nao-sou-um-token')).rejects.toThrow(InvalidTokenError);
  });

  it('trata falha ao buscar o JWKS como indisponibilidade, não como token inválido', async () => {
    const semRede = new JwtTokenVerifier(config, () => {
      throw new Error('connect ECONNREFUSED keycloak:8080');
    });
    await expect(semRede.verify(await assinar())).rejects.toThrow(IdentityProviderUnavailableError);
  });
});
