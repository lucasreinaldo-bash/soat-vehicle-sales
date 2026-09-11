import { Vehicle, VehicleStatus } from '../../domain/vehicle/vehicle.entity';

/**
 * Porta (interface) que a camada de aplicação depende para persistir/consultar
 * veículos. A infraestrutura (Prisma) implementa esta interface — Dependency
 * Inversion Principle: o domínio/aplicação não conhece detalhes de persistência.
 */
export interface IVehicleRepository {
  save(vehicle: Vehicle): Promise<Vehicle>;
  update(vehicle: Vehicle): Promise<Vehicle>;
  findById(id: string): Promise<Vehicle | null>;
  findByStatus(status: VehicleStatus, orderBy: 'price_asc'): Promise<Vehicle[]>;
}
