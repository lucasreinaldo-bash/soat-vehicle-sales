import { SaleStatus } from '../../../domain/sale/sale.entity';
import {
  InvalidSaleDateError,
  SaleAlreadyProcessedError,
  SaleNotFoundError,
} from '../../../domain/sale/sale.errors';
import { Vehicle, VehicleStatus } from '../../../domain/vehicle/vehicle.entity';
import {
  VehicleNotAvailableError,
  VehicleNotFoundError,
} from '../../../domain/vehicle/vehicle.errors';
import { InvalidCpfError } from '../../../domain/shared/value-objects/cpf.vo';
import {
  FakePaymentGateway,
  InMemorySaleRepository,
  InMemoryUnitOfWork,
  InMemoryVehicleRepository,
} from '../__mocks__/in-memory-repositories';
import { SellVehicleUseCase } from './sell-vehicle.usecase';
import { ProcessPaymentWebhookUseCase } from './process-payment-webhook.usecase';

const VALID_CPF = '529.982.247-25';

describe('Fluxo de venda e pagamento', () => {
  let vehicleRepository: InMemoryVehicleRepository;
  let saleRepository: InMemorySaleRepository;
  let paymentGateway: FakePaymentGateway;
  let sellVehicle: SellVehicleUseCase;
  let processWebhook: ProcessPaymentWebhookUseCase;

  const givenAvailableVehicle = async (id = 'v1', price = 79990) => {
    const vehicle = Vehicle.create(id, {
      brand: 'Volkswagen',
      model: 'Gol',
      year: 2022,
      color: 'Prata',
      price,
    });
    await vehicleRepository.save(vehicle);
    return vehicle;
  };

  beforeEach(() => {
    vehicleRepository = new InMemoryVehicleRepository();
    saleRepository = new InMemorySaleRepository();
    paymentGateway = new FakePaymentGateway();
    const unitOfWork = new InMemoryUnitOfWork(vehicleRepository, saleRepository);
    sellVehicle = new SellVehicleUseCase(vehicleRepository, paymentGateway, unitOfWork);
    processWebhook = new ProcessPaymentWebhookUseCase(unitOfWork);
  });

  describe('SellVehicleUseCase', () => {
    it('registra a venda, reserva o veículo e devolve o código de pagamento', async () => {
      await givenAvailableVehicle();

      const { sale, paymentCode } = await sellVehicle.execute({
        vehicleId: 'v1',
        buyerCpf: VALID_CPF,
      });

      expect(sale.status).toBe(SaleStatus.PENDING_PAYMENT);
      expect(sale.buyerCpf).toBe('52998224725');
      expect(Number(sale.price)).toBe(79990);
      expect(sale.saleDate).toBeInstanceOf(Date);
      expect(paymentCode).toBe('PAY-TEST-1');

      // O veículo sai do catálogo de disponíveis, mas ainda não é "vendido".
      const vehicle = await vehicleRepository.findById('v1');
      expect(vehicle!.status).toBe(VehicleStatus.RESERVED);
    });

    it('rejeita venda de veículo inexistente', async () => {
      await expect(sellVehicle.execute({ vehicleId: 'nope', buyerCpf: VALID_CPF })).rejects.toThrow(
        VehicleNotFoundError,
      );
    });

    it('rejeita CPF inválido e não cria venda alguma', async () => {
      await givenAvailableVehicle();

      await expect(
        sellVehicle.execute({ vehicleId: 'v1', buyerCpf: '111.111.111-11' }),
      ).rejects.toThrow(InvalidCpfError);

      expect(saleRepository.items.size).toBe(0);
      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.AVAILABLE);
    });

    it('registra a venda com data anterior quando informada', async () => {
      await givenAvailableVehicle();
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const { sale } = await sellVehicle.execute({
        vehicleId: 'v1',
        buyerCpf: VALID_CPF,
        saleDate: ontem,
      });

      expect(sale.saleDate).toEqual(ontem);
    });

    it('rejeita data de venda no futuro', async () => {
      await givenAvailableVehicle();

      await expect(
        sellVehicle.execute({
          vehicleId: 'v1',
          buyerCpf: VALID_CPF,
          saleDate: new Date(Date.now() + 86400000),
        }),
      ).rejects.toThrow(InvalidSaleDateError);
    });

    it('impede a venda em duplicidade do mesmo veículo', async () => {
      await givenAvailableVehicle();
      await sellVehicle.execute({ vehicleId: 'v1', buyerCpf: VALID_CPF });

      await expect(sellVehicle.execute({ vehicleId: 'v1', buyerCpf: VALID_CPF })).rejects.toThrow(
        VehicleNotAvailableError,
      );
    });
  });

  describe('ProcessPaymentWebhookUseCase', () => {
    it('PAID confirma a venda e marca o veículo como vendido', async () => {
      await givenAvailableVehicle();
      const { paymentCode } = await sellVehicle.execute({
        vehicleId: 'v1',
        buyerCpf: VALID_CPF,
      });

      const sale = await processWebhook.execute({ paymentCode, status: 'PAID' });

      expect(sale.status).toBe(SaleStatus.PAID);
      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.SOLD);
    });

    it('CANCELLED cancela a venda e devolve o veículo ao catálogo', async () => {
      await givenAvailableVehicle();
      const { paymentCode } = await sellVehicle.execute({
        vehicleId: 'v1',
        buyerCpf: VALID_CPF,
      });

      const sale = await processWebhook.execute({ paymentCode, status: 'CANCELLED' });

      expect(sale.status).toBe(SaleStatus.CANCELLED);
      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.AVAILABLE);
    });

    it('permite revender um veículo cujo pagamento foi cancelado', async () => {
      await givenAvailableVehicle();
      const primeira = await sellVehicle.execute({ vehicleId: 'v1', buyerCpf: VALID_CPF });
      await processWebhook.execute({ paymentCode: primeira.paymentCode, status: 'CANCELLED' });

      const segunda = await sellVehicle.execute({ vehicleId: 'v1', buyerCpf: VALID_CPF });
      await processWebhook.execute({ paymentCode: segunda.paymentCode, status: 'PAID' });

      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.SOLD);
    });

    it('rejeita código de pagamento desconhecido', async () => {
      await expect(
        processWebhook.execute({ paymentCode: 'PAY-INEXISTENTE', status: 'PAID' }),
      ).rejects.toThrow(SaleNotFoundError);
    });

    it('é protegido contra reprocessamento do mesmo pagamento', async () => {
      await givenAvailableVehicle();
      const { paymentCode } = await sellVehicle.execute({
        vehicleId: 'v1',
        buyerCpf: VALID_CPF,
      });
      await processWebhook.execute({ paymentCode, status: 'PAID' });

      await expect(processWebhook.execute({ paymentCode, status: 'PAID' })).rejects.toThrow(
        SaleAlreadyProcessedError,
      );
      await expect(processWebhook.execute({ paymentCode, status: 'CANCELLED' })).rejects.toThrow(
        SaleAlreadyProcessedError,
      );
    });
  });
});
