import { SaleStatus } from '../../../domain/sale/sale.entity';
import { SaleAlreadyProcessedError, SaleNotFoundError } from '../../../domain/sale/sale.errors';
import { Vehicle, VehicleStatus } from '../../../domain/vehicle/vehicle.entity';
import {
  VehicleNotAvailableError,
  VehicleNotFoundError,
} from '../../../domain/vehicle/vehicle.errors';
import {
  FakePaymentGateway,
  InMemorySaleRepository,
  InMemoryUnitOfWork,
  InMemoryVehicleRepository,
} from '../__mocks__/in-memory-repositories';
import { PurchaseVehicleUseCase } from './purchase-vehicle.usecase';
import { ListMyPurchasesUseCase } from './list-my-purchases.usecase';
import { ProcessPaymentWebhookUseCase } from './process-payment-webhook.usecase';

const CLIENTE = 'cliente-sub-123';
const OUTRO_CLIENTE = 'cliente-sub-456';

describe('Fluxo de compra e pagamento', () => {
  let vehicleRepository: InMemoryVehicleRepository;
  let saleRepository: InMemorySaleRepository;
  let purchase: PurchaseVehicleUseCase;
  let myPurchases: ListMyPurchasesUseCase;
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
    const unitOfWork = new InMemoryUnitOfWork(vehicleRepository, saleRepository);
    purchase = new PurchaseVehicleUseCase(vehicleRepository, new FakePaymentGateway(), unitOfWork);
    myPurchases = new ListMyPurchasesUseCase(saleRepository, vehicleRepository);
    processWebhook = new ProcessPaymentWebhookUseCase(unitOfWork);
  });

  describe('PurchaseVehicleUseCase', () => {
    it('registra a compra do cliente, reserva o veículo e devolve o código de pagamento', async () => {
      await givenAvailableVehicle();

      const { sale, paymentCode } = await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });

      expect(sale.status).toBe(SaleStatus.PENDING_PAYMENT);
      expect(sale.buyerId).toBe(CLIENTE);
      expect(Number(sale.price)).toBe(79990);
      expect(sale.saleDate).toBeInstanceOf(Date);
      expect(paymentCode).toBe('PAY-TEST-1');
      // O veículo sai do catálogo de disponíveis, mas ainda não é "vendido".
      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.RESERVED);
    });

    it('rejeita compra de veículo inexistente', async () => {
      await expect(purchase.execute({ vehicleId: 'nope', buyerId: CLIENTE })).rejects.toThrow(
        VehicleNotFoundError,
      );
    });

    it('impede que dois clientes comprem o mesmo veículo', async () => {
      await givenAvailableVehicle();
      await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });

      await expect(purchase.execute({ vehicleId: 'v1', buyerId: OUTRO_CLIENTE })).rejects.toThrow(
        VehicleNotAvailableError,
      );
    });
  });

  describe('ListMyPurchasesUseCase', () => {
    it('lista só as compras do próprio cliente, com os dados do veículo', async () => {
      await givenAvailableVehicle('v1', 50000);
      await givenAvailableVehicle('v2', 90000);
      await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });
      await purchase.execute({ vehicleId: 'v2', buyerId: OUTRO_CLIENTE });

      const minhas = await myPurchases.execute(CLIENTE);

      expect(minhas).toHaveLength(1);
      expect(minhas[0].sale.vehicleId).toBe('v1');
      expect(minhas[0].vehicle?.model).toBe('Gol');
    });

    it('cliente sem compras recebe lista vazia', async () => {
      expect(await myPurchases.execute('sem-compras')).toEqual([]);
    });
  });

  describe('ProcessPaymentWebhookUseCase', () => {
    it('PAID efetiva a compra e marca o veículo como vendido', async () => {
      await givenAvailableVehicle();
      const { paymentCode } = await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });

      const sale = await processWebhook.execute({ paymentCode, status: 'PAID' });

      expect(sale.status).toBe(SaleStatus.PAID);
      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.SOLD);
    });

    it('CANCELLED cancela a compra e devolve o veículo ao catálogo', async () => {
      await givenAvailableVehicle();
      const { paymentCode } = await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });

      const sale = await processWebhook.execute({ paymentCode, status: 'CANCELLED' });

      expect(sale.status).toBe(SaleStatus.CANCELLED);
      expect((await vehicleRepository.findById('v1'))!.status).toBe(VehicleStatus.AVAILABLE);
    });

    it('veículo devolvido ao catálogo pode ser comprado por outro cliente', async () => {
      await givenAvailableVehicle();
      const primeira = await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });
      await processWebhook.execute({ paymentCode: primeira.paymentCode, status: 'CANCELLED' });

      const segunda = await purchase.execute({ vehicleId: 'v1', buyerId: OUTRO_CLIENTE });
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
      const { paymentCode } = await purchase.execute({ vehicleId: 'v1', buyerId: CLIENTE });
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
