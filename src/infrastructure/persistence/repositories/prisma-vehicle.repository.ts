import { Injectable } from '@nestjs/common';
import { Vehicle as PrismaVehicle } from '@prisma/client';
import { Vehicle, VehicleStatus } from '../../../domain/vehicle/vehicle.entity';
import { IVehicleRepository } from '../../../application/ports/vehicle.repository.port';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClientLike } from '../prisma/prisma-client-like';

@Injectable()
export class PrismaVehicleRepository implements IVehicleRepository {
  /**
   * Recebe o PrismaService (uso normal, via DI) ou o client transacional
   * fornecido pelo Unit of Work — ambos expõem a mesma API de escrita/leitura.
   */
  constructor(private readonly prisma: PrismaClientLike | PrismaService) {}

  async save(vehicle: Vehicle): Promise<Vehicle> {
    const created = await this.prisma.vehicle.create({
      data: {
        id: vehicle.id,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        price: vehicle.price,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      },
    });
    return this.toDomain(created);
  }

  async update(vehicle: Vehicle): Promise<Vehicle> {
    const updated = await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        price: vehicle.price,
        status: vehicle.status,
      },
    });
    return this.toDomain(updated);
  }

  async findById(id: string): Promise<Vehicle | null> {
    const found = await this.prisma.vehicle.findUnique({ where: { id } });
    return found ? this.toDomain(found) : null;
  }

  async findByStatus(status: VehicleStatus, orderBy: 'price_asc'): Promise<Vehicle[]> {
    const found = await this.prisma.vehicle.findMany({
      where: { status },
      orderBy: orderBy === 'price_asc' ? { price: 'asc' } : undefined,
    });
    return found.map((vehicle) => this.toDomain(vehicle));
  }

  private toDomain(raw: PrismaVehicle): Vehicle {
    return Vehicle.restore({
      id: raw.id,
      brand: raw.brand,
      model: raw.model,
      year: raw.year,
      color: raw.color,
      price: raw.price,
      status: raw.status as VehicleStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
