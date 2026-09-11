import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaVehicleRepository } from './repositories/prisma-vehicle.repository';
import { PrismaSaleRepository } from './repositories/prisma-sale.repository';
import { PrismaUnitOfWork } from './prisma/prisma-unit-of-work';
import {
  SALE_REPOSITORY_TOKEN,
  UNIT_OF_WORK_TOKEN,
  VEHICLE_REPOSITORY_TOKEN,
} from '../../application/ports/tokens';

/**
 * Amarra cada porta de repositório (interface da camada de aplicação) à sua
 * implementação Prisma. Trocar o mecanismo de persistência significa trocar
 * apenas estes bindings.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: VEHICLE_REPOSITORY_TOKEN, useClass: PrismaVehicleRepository },
    { provide: SALE_REPOSITORY_TOKEN, useClass: PrismaSaleRepository },
    { provide: UNIT_OF_WORK_TOKEN, useClass: PrismaUnitOfWork },
  ],
  exports: [VEHICLE_REPOSITORY_TOKEN, SALE_REPOSITORY_TOKEN, UNIT_OF_WORK_TOKEN],
})
export class PersistenceModule {}
