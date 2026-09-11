import { Injectable } from '@nestjs/common';
import { IUnitOfWork, RepositoryContext } from '../../../application/ports/unit-of-work.port';
import { PrismaSaleRepository } from '../repositories/prisma-sale.repository';
import { PrismaVehicleRepository } from '../repositories/prisma-vehicle.repository';
import { PrismaService } from './prisma.service';

/**
 * Implementação do Unit of Work sobre `prisma.$transaction`: monta repositórios
 * ligados ao client transacional, de modo que todas as escritas feitas dentro do
 * callback façam commit (ou rollback) juntas.
 */
@Injectable()
export class PrismaUnitOfWork implements IUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  execute<T>(work: (repositories: RepositoryContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work({
        vehicles: new PrismaVehicleRepository(tx),
        sales: new PrismaSaleRepository(tx),
      }),
    );
  }
}
