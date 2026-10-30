/**
 * Teste end-to-end do fluxo completo de negócio, exercitando a API real
 * (HTTP -> controller -> use case -> repositório Prisma -> PostgreSQL).
 *
 * A autenticação é exercitada de ponta a ponta: o teste sobe um emissor JWT
 * local (servidor HTTP publicando o JWKS) e assina tokens com a chave privada
 * correspondente. A API valida assinatura, emissor, audiência e expiração
 * exatamente como faz com o Keycloak — sem depender dele.
 *
 * Pré-requisito: um PostgreSQL acessível via DATABASE_URL com as migrations
 * aplicadas. O caminho mais simples é:
 *     docker compose up -d db
 *     npx prisma migrate deploy
 *     npm run test:e2e
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

const VALID_CPF = '529.982.247-25';

interface VehicleBody {
  id: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  price: number;
  status: 'AVAILABLE' | 'RESERVED' | 'SOLD';
}

interface SaleBody {
  saleId: string;
  vehicleId: string;
  buyerCpf: string;
  price: number;
  saleDate: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  paymentCode: string;
}

describe('Plataforma de revenda de veículos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;
  let emissor: Server;
  let chavePrivada: KeyLike;
  let admin: string;
  let cliente: string;

  const ISSUER = 'http://emissor-de-teste/realms/vehicle-sales';
  const AUDIENCE = 'vehicle-sales-api';

  const assinar = (roles: string[], sub: string, opcoes: { aud?: string; exp?: string } = {}) =>
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

    admin = `Bearer ${await assinar(['admin', 'default-roles-vehicle-sales'], 'operador-1')}`;
    cliente = `Bearer ${await assinar(['customer', 'default-roles-vehicle-sales'], 'cliente-1')}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  const createVehicle = async (overrides: Record<string, unknown> = {}): Promise<VehicleBody> => {
    const response = await request(server)
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
    return response.body as VehicleBody;
  };

  const sellVehicle = async (vehicleId: string, cpf = VALID_CPF): Promise<SaleBody> => {
    const response = await request(server)
      .post(`/vehicles/${vehicleId}/sale`)
      .set('Authorization', admin)
      .send({ buyerCpf: cpf })
      .expect(201);
    return response.body as SaleBody;
  };

  const listAvailable = async (): Promise<VehicleBody[]> => {
    const response = await request(server).get('/vehicles/available').expect(200);
    return response.body as VehicleBody[];
  };

  const listSold = async (): Promise<VehicleBody[]> => {
    const response = await request(server).get('/vehicles/sold').expect(200);
    return response.body as VehicleBody[];
  };

  describe('Cadastro e edição', () => {
    it('cadastra um veículo disponível para venda', async () => {
      const vehicle = await createVehicle();

      expect(vehicle).toMatchObject({
        brand: 'Volkswagen',
        model: 'Gol',
        year: 2022,
        color: 'Prata',
        price: 79990,
        status: 'AVAILABLE',
      });
      expect(vehicle.id).toBeDefined();
    });

    it('rejeita cadastro com dados inválidos', async () => {
      await request(server)
        .post('/vehicles')
        .set('Authorization', admin)
        .send({ brand: '', model: 'Gol', year: 2022, color: 'Prata', price: -1 })
        .expect(400);
    });

    it('edita os dados de um veículo', async () => {
      const vehicle = await createVehicle();

      const response = await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .set('Authorization', admin)
        .send({ price: 74990, color: 'Preto' })
        .expect(200);

      expect(response.body).toMatchObject({ price: 74990, color: 'Preto', model: 'Gol' });
    });

    it('retorna 404 ao editar veículo inexistente', async () => {
      await request(server)
        .put('/vehicles/nao-existe')
        .set('Authorization', admin)
        .send({ price: 1000 })
        .expect(404);
    });
  });

  describe('Listagens ordenadas por preço', () => {
    it('lista veículos à venda do mais barato para o mais caro', async () => {
      await createVehicle({ model: 'Caro', price: 250000 });
      await createVehicle({ model: 'Barato', price: 45000 });
      await createVehicle({ model: 'Medio', price: 79990 });

      const available = await listAvailable();

      expect(available.map((v) => v.model)).toEqual(['Barato', 'Medio', 'Caro']);
    });
  });

  describe('Venda + webhook de pagamento', () => {
    it('conclui a venda quando o pagamento é confirmado', async () => {
      const vehicle = await createVehicle();

      const sale = await sellVehicle(vehicle.id);

      expect(sale.status).toBe('PENDING_PAYMENT');
      expect(sale.paymentCode).toBeDefined();
      expect(sale.buyerCpf).toBe('52998224725');

      // Enquanto o pagamento não é confirmado, o veículo não aparece em nenhuma
      // das duas listagens: não está mais à venda, nem foi vendido.
      expect(await listAvailable()).toHaveLength(0);
      expect(await listSold()).toHaveLength(0);

      await request(server)
        .post('/payments/webhook')
        .send({ paymentCode: sale.paymentCode, status: 'PAID' })
        .expect(200)
        .expect((res) => expect((res.body as SaleBody).status).toBe('PAID'));

      const sold = await listSold();
      expect(sold).toHaveLength(1);
      expect(sold[0].id).toBe(vehicle.id);
      expect(sold[0].status).toBe('SOLD');
    });

    it('devolve o veículo ao catálogo quando o pagamento é cancelado', async () => {
      const vehicle = await createVehicle();
      const sale = await sellVehicle(vehicle.id);

      await request(server)
        .post('/payments/webhook')
        .send({ paymentCode: sale.paymentCode, status: 'CANCELLED' })
        .expect(200)
        .expect((res) => expect((res.body as SaleBody).status).toBe('CANCELLED'));

      const available = await listAvailable();
      expect(available.map((v) => v.id)).toContain(vehicle.id);
    });

    it('rejeita CPF inválido (400)', async () => {
      const vehicle = await createVehicle();

      await request(server)
        .post(`/vehicles/${vehicle.id}/sale`)
        .set('Authorization', admin)
        .send({ buyerCpf: '111.111.111-11' })
        .expect(400);
    });

    it('rejeita a venda de um veículo já reservado (409)', async () => {
      const vehicle = await createVehicle();
      await sellVehicle(vehicle.id);

      await request(server)
        .post(`/vehicles/${vehicle.id}/sale`)
        .set('Authorization', admin)
        .send({ buyerCpf: VALID_CPF })
        .expect(409);
    });

    it('rejeita webhook com código de pagamento desconhecido (404)', async () => {
      await request(server)
        .post('/payments/webhook')
        .send({ paymentCode: 'PAY-INEXISTENTE', status: 'PAID' })
        .expect(404);
    });

    it('rejeita reprocessamento do mesmo pagamento (409)', async () => {
      const vehicle = await createVehicle();
      const sale = await sellVehicle(vehicle.id);

      const payload = { paymentCode: sale.paymentCode, status: 'PAID' };
      await request(server).post('/payments/webhook').send(payload).expect(200);
      await request(server).post('/payments/webhook').send(payload).expect(409);
    });

    it('não permite editar um veículo já vendido (409)', async () => {
      const vehicle = await createVehicle();
      const sale = await sellVehicle(vehicle.id);
      await request(server)
        .post('/payments/webhook')
        .send({ paymentCode: sale.paymentCode, status: 'PAID' })
        .expect(200);

      await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .set('Authorization', admin)
        .send({ price: 1 })
        .expect(409);
    });
  });

  describe('Autenticação e autorização', () => {
    const corpo = { brand: 'Fiat', model: 'Argo', year: 2022, color: 'Branco', price: 70000 };

    it('listagens e consulta de veículo são públicas', async () => {
      const vehicle = await createVehicle();
      await request(server).get('/vehicles/available').expect(200);
      await request(server).get('/vehicles/sold').expect(200);
      await request(server).get(`/vehicles/${vehicle.id}`).expect(200);
    });

    it('cadastro sem token responde 401', async () => {
      await request(server).post('/vehicles').send(corpo).expect(401);
    });

    it('cliente autenticado não pode cadastrar veículo (403)', async () => {
      await request(server).post('/vehicles').set('Authorization', cliente).send(corpo).expect(403);
    });

    it('cliente autenticado não pode editar veículo (403)', async () => {
      const vehicle = await createVehicle();
      await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .set('Authorization', cliente)
        .send({ price: 1 })
        .expect(403);
    });

    it('operador com papel admin cadastra veículo (201)', async () => {
      await request(server).post('/vehicles').set('Authorization', admin).send(corpo).expect(201);
    });

    it('token expirado responde 401', async () => {
      const expirado = await assinar(['admin'], 'operador-1', { exp: '-1m' });
      await request(server)
        .post('/vehicles')
        .set('Authorization', `Bearer ${expirado}`)
        .send(corpo)
        .expect(401);
    });

    it('token emitido para outra aplicação (audiência errada) responde 401', async () => {
      const outraApp = await assinar(['admin'], 'operador-1', { aud: 'outra-aplicacao' });
      await request(server)
        .post('/vehicles')
        .set('Authorization', `Bearer ${outraApp}`)
        .send(corpo)
        .expect(401);
    });

    it('token adulterado responde 401', async () => {
      const [cabecalho, , assinatura] = admin.replace('Bearer ', '').split('.');
      const payloadForjado = Buffer.from(
        JSON.stringify({
          sub: 'x',
          realm_access: { roles: ['admin'] },
          iss: ISSUER,
          aud: AUDIENCE,
        }),
      ).toString('base64url');
      await request(server)
        .post('/vehicles')
        .set('Authorization', `Bearer ${cabecalho}.${payloadForjado}.${assinatura}`)
        .send(corpo)
        .expect(401);
    });

    it('erros de autenticação usam o mesmo envelope de erro da API', async () => {
      const resposta = await request(server).post('/vehicles').send(corpo).expect(401);
      expect(resposta.body).toMatchObject({ statusCode: 401, error: 'UnauthorizedException' });
    });
  });

  describe('Health checks', () => {
    it('responde ao liveness e ao readiness', async () => {
      await request(server).get('/health').expect(200);
      await request(server)
        .get('/health/ready')
        .expect(200)
        .expect((res) => expect((res.body as { database: string }).database).toBe('up'));
    });
  });
});
