import { Vehicle, VehicleStatus } from '../../../domain/vehicle/vehicle.entity';
import { Sale } from '../../../domain/sale/sale.entity';
import { IVehicleRepository } from '../../ports/vehicle.repository.port';
import { ISaleRepository } from '../../ports/sale.repository.port';
import { IPaymentGateway, PaymentRequestResult } from '../../ports/payment-gateway.port';
import { IUnitOfWork, RepositoryContext } from '../../ports/unit-of-work.port';

/**
 * Implementações em memória das portas. A existência destes fakes é a prova
 * prática da inversão de dependência: os use-cases são testáveis sem banco,
 * sem Nest e sem rede.
 */
export class InMemoryVehicleRepository implements IVehicleRepository {
  readonly items = new Map<string, Vehicle>();

  save(vehicle: Vehicle): Promise<Vehicle> {
    this.items.set(vehicle.id, vehicle);
    return Promise.resolve(vehicle);
  }

  update(vehicle: Vehicle): Promise<Vehicle> {
    this.items.set(vehicle.id, vehicle);
    return Promise.resolve(vehicle);
  }

  findById(id: string): Promise<Vehicle | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByStatus(status: VehicleStatus, orderBy: 'price_asc'): Promise<Vehicle[]> {
    const result = [...this.items.values()].filter((vehicle) => vehicle.status === status);
    if (orderBy === 'price_asc') {
      result.sort((a, b) => a.price.comparedTo(b.price));
    }
    return Promise.resolve(result);
  }
}

export class InMemorySaleRepository implements ISaleRepository {
  readonly items = new Map<string, Sale>();

  save(sale: Sale): Promise<Sale> {
    this.items.set(sale.id, sale);
    return Promise.resolve(sale);
  }

  update(sale: Sale): Promise<Sale> {
    this.items.set(sale.id, sale);
    return Promise.resolve(sale);
  }

  findById(id: string): Promise<Sale | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByPaymentCode(paymentCode: string): Promise<Sale | null> {
    const found = [...this.items.values()].find((sale) => sale.paymentCode === paymentCode);
    return Promise.resolve(found ?? null);
  }

  findByVehicleId(vehicleId: string): Promise<Sale | null> {
    const found = [...this.items.values()].find((sale) => sale.vehicleId === vehicleId);
    return Promise.resolve(found ?? null);
  }
}

export class FakePaymentGateway implements IPaymentGateway {
  private counter = 0;

  requestPayment(): Promise<PaymentRequestResult> {
    this.counter += 1;
    return Promise.resolve({ paymentCode: `PAY-TEST-${this.counter}` });
  }
}

/**
 * Unit of Work em memória: executa o trabalho direto sobre os repositórios
 * fake. Sem transação real — o objetivo aqui é testar a lógica do caso de uso,
 * não o comportamento transacional do PostgreSQL (isso é coberto pelos e2e).
 */
export class InMemoryUnitOfWork implements IUnitOfWork {
  constructor(
    private readonly vehicles: IVehicleRepository,
    private readonly sales: ISaleRepository,
  ) {}

  execute<T>(work: (repositories: RepositoryContext) => Promise<T>): Promise<T> {
    return work({ vehicles: this.vehicles, sales: this.sales });
  }
}
