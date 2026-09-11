/**
 * Teste end-to-end do fluxo completo de negócio, exercitando a API real
 * (HTTP -> controller -> use case -> repositório Prisma -> PostgreSQL).
 *
 * Pré-requisito: um PostgreSQL acessível via DATABASE_URL com as migrations
 * aplicadas. O caminho mais simples é:
 *     docker compose up -d db
 *     npx prisma migrate deploy
 *     npm run test:e2e
 */
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

  beforeAll(async () => {
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
  });

  const createVehicle = async (overrides: Record<string, unknown> = {}): Promise<VehicleBody> => {
    const response = await request(server)
      .post('/vehicles')
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
        .send({ brand: '', model: 'Gol', year: 2022, color: 'Prata', price: -1 })
        .expect(400);
    });

    it('edita os dados de um veículo', async () => {
      const vehicle = await createVehicle();

      const response = await request(server)
        .put(`/vehicles/${vehicle.id}`)
        .send({ price: 74990, color: 'Preto' })
        .expect(200);

      expect(response.body).toMatchObject({ price: 74990, color: 'Preto', model: 'Gol' });
    });

    it('retorna 404 ao editar veículo inexistente', async () => {
      await request(server).put('/vehicles/nao-existe').send({ price: 1000 }).expect(404);
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
        .send({ buyerCpf: '111.111.111-11' })
        .expect(400);
    });

    it('rejeita a venda de um veículo já reservado (409)', async () => {
      const vehicle = await createVehicle();
      await sellVehicle(vehicle.id);

      await request(server)
        .post(`/vehicles/${vehicle.id}/sale`)
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

      await request(server).put(`/vehicles/${vehicle.id}`).send({ price: 1 }).expect(409);
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
