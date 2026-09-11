import { Vehicle, VehicleStatus } from '../../../domain/vehicle/vehicle.entity';
import {
  VehicleAlreadySoldError,
  VehicleNotFoundError,
} from '../../../domain/vehicle/vehicle.errors';
import { InMemoryVehicleRepository } from '../__mocks__/in-memory-repositories';
import { CreateVehicleUseCase } from './create-vehicle.usecase';
import { UpdateVehicleUseCase } from './update-vehicle.usecase';
import { GetVehicleUseCase } from './get-vehicle.usecase';
import { ListAvailableVehiclesUseCase } from './list-available-vehicles.usecase';
import { ListSoldVehiclesUseCase } from './list-sold-vehicles.usecase';

describe('Use cases de veículo', () => {
  let repository: InMemoryVehicleRepository;

  beforeEach(() => {
    repository = new InMemoryVehicleRepository();
  });

  describe('CreateVehicleUseCase', () => {
    it('cadastra um veículo disponível e o persiste', async () => {
      const useCase = new CreateVehicleUseCase(repository);

      const vehicle = await useCase.execute({
        brand: 'Volkswagen',
        model: 'Gol',
        year: 2022,
        color: 'Prata',
        price: 79990,
      });

      expect(vehicle.id).toBeDefined();
      expect(vehicle.status).toBe(VehicleStatus.AVAILABLE);
      expect(repository.items.size).toBe(1);
    });
  });

  describe('UpdateVehicleUseCase', () => {
    it('atualiza os dados de um veículo existente', async () => {
      const existing = Vehicle.create('v1', {
        brand: 'Fiat',
        model: 'Argo',
        year: 2021,
        color: 'Branco',
        price: 69990,
      });
      await repository.save(existing);

      const updated = await new UpdateVehicleUseCase(repository).execute({
        id: 'v1',
        price: 64990,
      });

      expect(Number(updated.price)).toBe(64990);
      expect(Number((await repository.findById('v1'))!.price)).toBe(64990);
    });

    it('falha quando o veículo não existe', async () => {
      await expect(
        new UpdateVehicleUseCase(repository).execute({ id: 'inexistente', price: 1 }),
      ).rejects.toThrow(VehicleNotFoundError);
    });

    it('falha ao tentar editar um veículo vendido', async () => {
      const sold = Vehicle.create('v1', {
        brand: 'Fiat',
        model: 'Argo',
        year: 2021,
        color: 'Branco',
        price: 69990,
      })
        .reserve()
        .markAsSold();
      await repository.save(sold);

      await expect(
        new UpdateVehicleUseCase(repository).execute({ id: 'v1', price: 1000 }),
      ).rejects.toThrow(VehicleAlreadySoldError);
    });
  });

  describe('GetVehicleUseCase', () => {
    it('lança VehicleNotFoundError para id inexistente', async () => {
      await expect(new GetVehicleUseCase(repository).execute('nope')).rejects.toThrow(
        VehicleNotFoundError,
      );
    });
  });

  describe('Listagens', () => {
    beforeEach(async () => {
      const caro = Vehicle.create('caro', {
        brand: 'BMW',
        model: '320i',
        year: 2023,
        color: 'Preto',
        price: 250000,
      });
      const barato = Vehicle.create('barato', {
        brand: 'Fiat',
        model: 'Mobi',
        year: 2020,
        color: 'Vermelho',
        price: 45000,
      });
      const medio = Vehicle.create('medio', {
        brand: 'Volkswagen',
        model: 'Gol',
        year: 2022,
        color: 'Prata',
        price: 79990,
      });

      await repository.save(caro);
      await repository.save(barato);
      await repository.save(medio);
      // Um veículo vendido e um reservado não podem aparecer na lista "à venda".
      await repository.save(
        Vehicle.create('vendido', {
          brand: 'Honda',
          model: 'Civic',
          year: 2021,
          color: 'Cinza',
          price: 120000,
        })
          .reserve()
          .markAsSold(),
      );
      await repository.save(
        Vehicle.create('reservado', {
          brand: 'Toyota',
          model: 'Corolla',
          year: 2022,
          color: 'Prata',
          price: 140000,
        }).reserve(),
      );
    });

    it('lista veículos à venda ordenados do mais barato para o mais caro', async () => {
      const result = await new ListAvailableVehiclesUseCase(repository).execute();

      expect(result.map((v) => v.id)).toEqual(['barato', 'medio', 'caro']);
    });

    it('lista apenas veículos vendidos, ordenados por preço', async () => {
      await repository.save(
        Vehicle.create('vendido2', {
          brand: 'Renault',
          model: 'Kwid',
          year: 2020,
          color: 'Azul',
          price: 48000,
        })
          .reserve()
          .markAsSold(),
      );

      const result = await new ListSoldVehiclesUseCase(repository).execute();

      expect(result.map((v) => v.id)).toEqual(['vendido2', 'vendido']);
      expect(result.every((v) => v.status === VehicleStatus.SOLD)).toBe(true);
    });
  });
});
