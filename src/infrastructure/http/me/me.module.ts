import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { ListMyPurchasesUseCase } from '../../../application/use-cases/sale/list-my-purchases.usecase';
import { PersistenceModule } from '../../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  controllers: [MeController],
  providers: [ListMyPurchasesUseCase],
})
export class MeModule {}
