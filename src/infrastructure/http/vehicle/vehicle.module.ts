import { Module } from '@nestjs/common';
import { VehicleController } from './vehicle.controller';
import { CreateVehicleUseCase } from '../../../application/use-cases/vehicle/create-vehicle.usecase';
import { UpdateVehicleUseCase } from '../../../application/use-cases/vehicle/update-vehicle.usecase';
import { GetVehicleUseCase } from '../../../application/use-cases/vehicle/get-vehicle.usecase';
import { ListAvailableVehiclesUseCase } from '../../../application/use-cases/vehicle/list-available-vehicles.usecase';
import { ListSoldVehiclesUseCase } from '../../../application/use-cases/vehicle/list-sold-vehicles.usecase';
import { SellVehicleUseCase } from '../../../application/use-cases/sale/sell-vehicle.usecase';
import { PersistenceModule } from '../../persistence/persistence.module';
import { PaymentGatewayModule } from '../../payment/payment-gateway.module';

/**
 * Módulo de composição (Composition Root) do contexto de veículos: liga os
 * use-cases (aplicação) às implementações concretas fornecidas pelos módulos
 * de infraestrutura. Nenhum use-case conhece Prisma ou o gateway de pagamento —
 * apenas as portas.
 */
@Module({
  imports: [PersistenceModule, PaymentGatewayModule],
  controllers: [VehicleController],
  providers: [
    CreateVehicleUseCase,
    UpdateVehicleUseCase,
    GetVehicleUseCase,
    ListAvailableVehiclesUseCase,
    ListSoldVehiclesUseCase,
    SellVehicleUseCase,
  ],
})
export class VehicleModule {}
