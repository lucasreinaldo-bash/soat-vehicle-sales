import { Decimal } from '@prisma/client/runtime/library';
import { Vehicle, VehicleStatus } from './vehicle.entity';
import { InvalidVehicleDataError, VehicleAlreadySoldError } from './vehicle.errors';

const validData = {
  brand: 'Volkswagen',
  model: 'Gol',
  year: 2022,
  color: 'Prata',
  price: 79990,
};

describe('Vehicle (entidade de domínio)', () => {
  it('nasce disponível para venda', () => {
    const vehicle = Vehicle.create('v1', validData);
    expect(vehicle.status).toBe(VehicleStatus.AVAILABLE);
    expect(vehicle.isAvailable()).toBe(true);
    expect(vehicle.price.toString()).toBe('79990');
  });

  it('remove espaços em branco dos campos textuais', () => {
    const vehicle = Vehicle.create('v1', { ...validData, brand: '  Fiat  ' });
    expect(vehicle.brand).toBe('Fiat');
  });

  it.each([
    ['marca vazia', { ...validData, brand: '   ' }],
    ['modelo vazio', { ...validData, model: '' }],
    ['cor vazia', { ...validData, color: '' }],
    ['preço zero', { ...validData, price: 0 }],
    ['preço negativo', { ...validData, price: -1 }],
    ['ano anterior a 1900', { ...validData, year: 1899 }],
    ['ano muito no futuro', { ...validData, year: new Date().getFullYear() + 5 }],
  ])('rejeita cadastro com %s', (_label, data) => {
    expect(() => Vehicle.create('v1', data)).toThrow(InvalidVehicleDataError);
  });

  it('atualiza somente os campos informados', () => {
    const vehicle = Vehicle.create('v1', validData);
    const updated = vehicle.update({ price: 74990, color: 'Preto' });

    expect(updated.price.toString()).toBe('74990');
    expect(updated.color).toBe('Preto');
    expect(updated.brand).toBe('Volkswagen');
    // Imutabilidade: a instância original não é alterada.
    expect(vehicle.price.toString()).toBe('79990');
  });

  it('não permite editar um veículo já vendido', () => {
    const sold = Vehicle.create('v1', validData).reserve().markAsSold();
    expect(() => sold.update({ price: 1000 })).toThrow(VehicleAlreadySoldError);
  });

  it('percorre o ciclo de vida AVAILABLE -> RESERVED -> SOLD', () => {
    const vehicle = Vehicle.create('v1', validData);
    const reserved = vehicle.reserve();
    expect(reserved.status).toBe(VehicleStatus.RESERVED);
    expect(reserved.isAvailable()).toBe(false);

    const sold = reserved.markAsSold();
    expect(sold.status).toBe(VehicleStatus.SOLD);
  });

  it('volta ao catálogo quando o pagamento é cancelado', () => {
    const released = Vehicle.create('v1', validData).reserve().releaseBackToCatalog();
    expect(released.status).toBe(VehicleStatus.AVAILABLE);
  });

  it('restaura uma instância a partir dos dados persistidos', () => {
    const now = new Date();
    const vehicle = Vehicle.restore({
      id: 'v1',
      brand: 'Fiat',
      model: 'Argo',
      year: 2021,
      color: 'Branco',
      price: new Decimal('69990.00'),
      status: VehicleStatus.SOLD,
      createdAt: now,
      updatedAt: now,
    });

    expect(vehicle.status).toBe(VehicleStatus.SOLD);
    expect(vehicle.model).toBe('Argo');
  });
});
