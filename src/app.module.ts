import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { DomainExceptionFilter } from './infrastructure/http/filters/domain-exception.filter';
import { VehicleModule } from './infrastructure/http/vehicle/vehicle.module';
import { PaymentModule } from './infrastructure/http/payment/payment.module';
import { HealthModule } from './infrastructure/http/health/health.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), VehicleModule, PaymentModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
