/**
 * Teste end-to-end da API de vendas da Fase 3, exercitando o caminho real:
 * HTTP -> guards -> controller -> caso de uso -> Prisma -> PostgreSQL.
 *
 * - Autenticação: um emissor JWT local publica o JWKS por HTTP e assina tokens
 *   com a chave privada correspondente. A API os valida como faz com o Keycloak
 *   (assinatura, emissor, audiência, expiração) — sem depender dele.
 * - Webhook: as notificações são assinadas com HMAC, como faria o processador de
 *   pagamento.
 *
 * Pré-requisito: PostgreSQL acessível via DATABASE_URL com as migrations
 * aplicadas (docker compose up -d db; npx prisma migrate deploy).
 */
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/infrastructure/http/filters/domain-exception.filter';
import { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service';
import { assinar as assinarWebhook } from '../../src/infrastructure/http/payment/webhook-signature';

interface VehicleBody {
  id: string;
  model: string;
  price: number;
  status: 'AVAILABLE' | 'RESERVED' | 'SOLD';
}

interface PurchaseBody {
  saleId: string;
  vehicleId: string;
  price: number;
  saleDate: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  paymentCode: string;
}

const ISSUER = 'http://emissor-de-teste/realms/vehicle-sales';
const AUDIENCE = 'vehicle-sales-api';
const SEGREDO_WEBHOOK = 'segredo-webhook-dos-testes-e2e';

describe('Plataforma de revenda de veículos — Fase 3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;
  let emissor: Server;
  let chavePrivada: KeyLike;
  let admin: string;
  let cliente: string;
  let outroCliente: string;

  const token = (roles: string[], sub: string, opcoes: { aud?: string; exp?: string } = {}) =>
    new SignJWT({ realm_access: { roles } })
      .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(opcoes.aud ?? AUDIENCE)
      .setSubject(sub)
      .setExpirationTime(opcoes.exp ?? '5m')
      .sign(chavePrivada);

  beforeAll(async () => {
    const par = await generateKeyPair('RS256');
    chavePrivada = par.privateKey;
    const jwk = { ...(await exportJWK(par.publicKey)), kid: 'e2e', alg: 'RS256', use: 'sig' };
    emissor = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((pronto) => emissor.listen(0, '127.0.0.1', pronto));
    const porta = (emissor.address() as AddressInfo).port;

    process.env.AUTH_ISSUER = ISSUER;
    process.env.AUTH_AUDIENCE = AUDIENCE;
    process.env.AUTH_JWKS_URI = `http://127.0.0.1:${porta}/certs`;
    process.env.PAYMENT_WEBHOOK_SECRET = SEGREDO_WEBHOOK;

    admin = `Bearer ${await token(['admin'], 'operador-1')}`;
    cliente = `Bearer ${await token(['customer', 'default-roles-vehicle-sales'], 'cliente-1')}`;
    outroCliente = `Bearer ${await token(['customer'], 'cliente-2')}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    server = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await prisma.sale.deleteMany();
    await prisma.vehicle.deleteMany();
  });

  afterAll(async () => {
    await prisma.sale.deleteMany();
    await prisma.vehicle.deleteMany();
    await app.close();
    await new Promise((fechado) => emissor.close(fechado));
  });

  // ------------------------------------------------------------------ helpers
  const createVehicle = async (overrides: Record<string, unknown> = {}): Promise<VehicleBody> => {
    const resposta = await request(server)
      .post('/vehicles')
      .set('Authorization', admin)
      .send({
        brand: 'Volkswagen',
        model: 'Gol',
        year: 2022,
        color: 'Prata',
        price: 79990,
        ...overrides,
      })
      .expect(201);
    return resposta.body as VehicleBody;
  };

  const purchase = async (vehicleId: string, quem = cliente): Promise<PurchaseBody> => {
    const resposta = await request(server)
      .post(`/vehicles/${vehicleId}/purchase`)
      .set('Authorization', quem)
      .expect(201);
    return resposta.body as PurchaseBody;
  };

  const webhook = (
    paymentCode: string,
    status: 'PAID' | 'CANCELLED',
    opcoes: {
      segredo?: string;
      timestamp?: number;
      corpoAssinado?: string;
      semAssinatura?: boolean;
    } = {},
  ) => {
    const corpo = JSON.stringify({ paymentCode, status });
    const ts = String(opcoes.timestamp ?? Math.floor(Date.now() / 1000));
    const req = request(server).post('/payments/webhook').set('Content-Type', 'application/json');
    if (!opcoes.semAssinatura) {
      req
        .set('X-Webhook-Timestamp', ts)
        .set(
          'X-Webhook-Signature',
          assinarWebhook(opcoes.segredo ?? SEGREDO_WEBHOOK, ts, opcoes.corpoAssinado ?? corpo),
        );
    }
    return req.send(corpo);
  };

  const listAvailable = async () =>
    (await request(server).get('/vehicles/available').expect(200)).body as VehicleBody[];
  const listSold = async () =>
    (await request(server).get('/vehicles/sold').expect(200)).body as VehicleBody[];
  const statusDoVeiculo = async (id: string) =>
    ((await request(server).get(`/vehicles/${id}`).expect(200)).body as VehicleBody).status;

  // ------------------------------------------------------------------ cadastro
  describe('Cadastro e edição de veículos (admin)', () => {
    it('admin cadastra um veículo disponível para venda', async () => {
      const vehicle = await createVehicle();
      expect(vehicle).toMatchObject({ model: 'Gol', price: 79990, status: 'AVAILABLE' });
    });

    it('rejeita cadastro com dados inválidos (400)', async () => {
      await request(server)
        .post('/vehicles')
        .set('Authorization', admin)
        .send({ brand: '', model: 'Gol', year: 2022, color: 'Prata', price: -1 })
        .expect(400);
    });

    it('admin edita os dados de um veículo', async () => {
      const vehicle = await createVehicle();
      const resposta = await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .set('Authorization', admin)
        .send({ price: 74990, color: 'Preto' })
        .expect(200);
      expect(resposta.body).toMatchObject({ price: 74990, color: 'Preto' });
    });

    it('edição de veículo inexistente responde 404', async () => {
      await request(server)
        .put('/vehicles/nao-existe')
        .set('Authorization', admin)
        .send({ price: 1000 })
        .expect(404);
    });
  });

  // ------------------------------------------------------------------ listagens
  describe('Listagens públicas, ordenadas por preço', () => {
    it('lista veículos à venda do mais barato para o mais caro, sem token', async () => {
      await createVehicle({ model: 'Caro', price: 250000 });
      await createVehicle({ model: 'Barato', price: 45000 });
      await createVehicle({ model: 'Medio', price: 79990 });
      expect((await listAvailable()).map((v) => v.model)).toEqual(['Barato', 'Medio', 'Caro']);
    });

    it('lista vendidos do mais barato para o mais caro', async () => {
      for (const [model, price] of [
        ['Caro', 200000],
        ['Barato', 40000],
      ] as const) {
        const v = await createVehicle({ model, price });
        const compra = await purchase(v.id);
        await webhook(compra.paymentCode, 'PAID').expect(200);
      }
      expect((await listSold()).map((v) => v.model)).toEqual(['Barato', 'Caro']);
    });
  });

  // ------------------------------------------------------------------ autenticação
  describe('Autenticação e autorização', () => {
    const corpo = { brand: 'Fiat', model: 'Argo', year: 2022, color: 'Branco', price: 70000 };

    it('cadastro sem token responde 401', async () => {
      await request(server).post('/vehicles').send(corpo).expect(401);
    });

    it('cliente não pode cadastrar nem editar veículo (403)', async () => {
      await request(server).post('/vehicles').set('Authorization', cliente).send(corpo).expect(403);
      const vehicle = await createVehicle();
      await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .set('Authorization', cliente)
        .send({ price: 1 })
        .expect(403);
    });

    it.each([
      ['expirado', { exp: '-1m' }],
      ['emitido para outra aplicação', { aud: 'outra-aplicacao' }],
    ])('token %s responde 401', async (_caso, opcoes) => {
      const t = await token(['admin'], 'operador-1', opcoes);
      await request(server)
        .post('/vehicles')
        .set('Authorization', `Bearer ${t}`)
        .send(corpo)
        .expect(401);
    });

    it('token adulterado (papel trocado no payload) responde 401', async () => {
      const [cabecalho, , assinatura] = cliente.replace('Bearer ', '').split('.');
      const forjado = Buffer.from(
        JSON.stringify({
          sub: 'cliente-1',
          realm_access: { roles: ['admin'] },
          iss: ISSUER,
          aud: AUDIENCE,
        }),
      ).toString('base64url');
      await request(server)
        .post('/vehicles')
        .set('Authorization', `Bearer ${cabecalho}.${forjado}.${assinatura}`)
        .send(corpo)
        .expect(401);
    });

    it('erros de autenticação usam o envelope de erro da API', async () => {
      const resposta = await request(server).post('/vehicles').send(corpo).expect(401);
      expect(resposta.body).toMatchObject({ statusCode: 401, error: 'UnauthorizedException' });
    });
  });

  // ------------------------------------------------------------------ compra
  describe('Compra por cliente cadastrado', () => {
    it('cliente compra: a compra nasce aguardando pagamento e reserva o veículo', async () => {
      const vehicle = await createVehicle();
      const compra = await purchase(vehicle.id);

      expect(compra).toMatchObject({
        vehicleId: vehicle.id,
        status: 'PENDING_PAYMENT',
        price: 79990,
      });
      expect(compra.paymentCode).toMatch(/^PAY-/);
      expect(await statusDoVeiculo(vehicle.id)).toBe('RESERVED');
      // Durante o pagamento, o veículo não está à venda nem vendido.
      expect(await listAvailable()).toHaveLength(0);
      expect(await listSold()).toHaveLength(0);
    });

    it('a resposta da compra não carrega dado pessoal do comprador', async () => {
      const compra = await purchase((await createVehicle()).id);
      expect(Object.keys(compra).filter((c) => /cpf|buyer|email|nome/i.test(c))).toEqual([]);
    });

    it('compra sem token responde 401 — só pessoas cadastradas compram', async () => {
      const vehicle = await createVehicle();
      await request(server).post(`/vehicles/${vehicle.id}/purchase`).expect(401);
      expect(await statusDoVeiculo(vehicle.id)).toBe('AVAILABLE');
    });

    it('operador sem o papel customer não compra (403)', async () => {
      const vehicle = await createVehicle();
      await request(server)
        .post(`/vehicles/${vehicle.id}/purchase`)
        .set('Authorization', admin)
        .expect(403);
    });

    it('dois clientes não compram o mesmo veículo (409)', async () => {
      const vehicle = await createVehicle();
      await purchase(vehicle.id);
      await request(server)
        .post(`/vehicles/${vehicle.id}/purchase`)
        .set('Authorization', outroCliente)
        .expect(409);
    });

    it('compra de veículo inexistente responde 404', async () => {
      await request(server)
        .post('/vehicles/nao-existe/purchase')
        .set('Authorization', cliente)
        .expect(404);
    });
  });

  // ------------------------------------------------------------------ efetivação
  describe('Efetivação da compra pelo webhook assinado', () => {
    it('PAID efetiva a compra e o veículo vai para a lista de vendidos', async () => {
      const vehicle = await createVehicle();
      const compra = await purchase(vehicle.id);

      const resposta = await webhook(compra.paymentCode, 'PAID').expect(200);
      expect(resposta.body).toMatchObject({ status: 'PAID' });
      expect((await listSold()).map((v) => v.id)).toEqual([vehicle.id]);
    });

    it('CANCELLED devolve o veículo ao catálogo', async () => {
      const vehicle = await createVehicle();
      const compra = await purchase(vehicle.id);
      await webhook(compra.paymentCode, 'CANCELLED').expect(200);
      expect(await statusDoVeiculo(vehicle.id)).toBe('AVAILABLE');
    });

    it('notificação sem assinatura é recusada (401) e não altera nada', async () => {
      const vehicle = await createVehicle();
      const compra = await purchase(vehicle.id);
      await webhook(compra.paymentCode, 'PAID', { semAssinatura: true }).expect(401);
      expect(await statusDoVeiculo(vehicle.id)).toBe('RESERVED');
    });

    it('assinatura com outro segredo é recusada (401)', async () => {
      const compra = await purchase((await createVehicle()).id);
      await webhook(compra.paymentCode, 'PAID', { segredo: 'segredo-de-um-atacante-123' }).expect(
        401,
      );
    });

    it('corpo adulterado é recusado: assinou CANCELLED, enviou PAID (401)', async () => {
      const vehicle = await createVehicle();
      const compra = await purchase(vehicle.id);
      const assinado = JSON.stringify({ paymentCode: compra.paymentCode, status: 'CANCELLED' });
      await webhook(compra.paymentCode, 'PAID', { corpoAssinado: assinado }).expect(401);
      expect(await statusDoVeiculo(vehicle.id)).toBe('RESERVED');
    });

    it('notificação antiga é recusada — proteção contra replay (401)', async () => {
      const compra = await purchase((await createVehicle()).id);
      const dezMinutosAtras = Math.floor(Date.now() / 1000) - 600;
      await webhook(compra.paymentCode, 'PAID', { timestamp: dezMinutosAtras }).expect(401);
    });

    it('reprocessar o mesmo pagamento responde 409', async () => {
      const compra = await purchase((await createVehicle()).id);
      await webhook(compra.paymentCode, 'PAID').expect(200);
      await webhook(compra.paymentCode, 'PAID').expect(409);
    });

    it('código de pagamento desconhecido responde 404', async () => {
      await webhook('PAY-INEXISTENTE', 'PAID').expect(404);
    });

    it('veículo vendido não pode mais ser editado (409)', async () => {
      const vehicle = await createVehicle();
      const compra = await purchase(vehicle.id);
      await webhook(compra.paymentCode, 'PAID').expect(200);
      await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .set('Authorization', admin)
        .send({ price: 1 })
        .expect(409);
    });
  });

  // ------------------------------------------------------------------ minhas compras
  describe('Minhas compras', () => {
    it('cada cliente vê apenas as próprias compras, com o status do pagamento', async () => {
      const meu = await createVehicle({ model: 'Meu' });
      const dele = await createVehicle({ model: 'Dele' });
      const minha = await purchase(meu.id, cliente);
      await purchase(dele.id, outroCliente);
      await webhook(minha.paymentCode, 'PAID').expect(200);

      const resposta = await request(server)
        .get('/me/purchases')
        .set('Authorization', cliente)
        .expect(200);
      const compras = resposta.body as Array<{ status: string; vehicle: { model: string } }>;

      expect(compras).toHaveLength(1);
      expect(compras[0]).toMatchObject({ status: 'PAID', vehicle: { model: 'Meu' } });
    });

    it('sem token responde 401; operador sem o papel customer, 403', async () => {
      await request(server).get('/me/purchases').expect(401);
      await request(server).get('/me/purchases').set('Authorization', admin).expect(403);
    });
  });

  // ------------------------------------------------------------------ separação de dados
  describe('Separação entre dados de cliente e dados transacionais', () => {
    it('a venda guarda só o identificador opaco do token, e a tabela não tem coluna de CPF', async () => {
      const compra = await purchase((await createVehicle()).id);

      const [linha] = await prisma.$queryRaw<Array<{ buyer_id: string }>>`
        SELECT buyer_id FROM sales WHERE id = ${compra.saleId}`;
      expect(linha.buyer_id).toBe('cliente-1');

      const colunas = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'sales'`;
      expect(colunas.map((c) => c.column_name).filter((c) => /cpf|email|name/i.test(c))).toEqual(
        [],
      );
    });
  });

  // ------------------------------------------------------------------ health
  describe('Health checks', () => {
    it('liveness e readiness respondem sem token', async () => {
      await request(server).get('/health').expect(200);
      await request(server)
        .get('/health/ready')
        .expect(200)
        .expect((res) => expect((res.body as { database: string }).database).toBe('up'));
    });
  });
});
