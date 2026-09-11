import { Inject, Injectable } from '@nestjs/common';
import { Sale as PrismaSale } from '@prisma/client';
import { Sale, SaleStatus } from '../../../domain/sale/sale.entity';
import { ISaleRepository } from '../../../application/ports/sale.repository.port';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClientLike } from '../prisma/prisma-client-like';

@Injectable()
export class PrismaSaleRepository implements ISaleRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaClientLike) {}

  async save(sale: Sale): Promise<Sale> {
    const created = await this.prisma.sale.create({
      data: {
        id: sale.id,
        vehicleId: sale.vehicleId,
        buyerCpf: sale.buyerCpf,
        price: sale.price,
        saleDate: sale.saleDate,
        status: sale.status,
        paymentCode: sale.paymentCode,
        createdAt: sale.createdAt,
        updatedAt: sale.updatedAt,
      },
    });
    return this.toDomain(created);
  }

  async update(sale: Sale): Promise<Sale> {
    const updated = await this.prisma.sale.update({
      where: { id: sale.id },
      data: { status: sale.status },
    });
    return this.toDomain(updated);
  }

  async findById(id: string): Promise<Sale | null> {
    const found = await this.prisma.sale.findUnique({ where: { id } });
    return found ? this.toDomain(found) : null;
  }

  async findByPaymentCode(paymentCode: string): Promise<Sale | null> {
    const found = await this.prisma.sale.findUnique({ where: { paymentCode } });
    return found ? this.toDomain(found) : null;
  }

  async findByVehicleId(vehicleId: string): Promise<Sale | null> {
    const found = await this.prisma.sale.findFirst({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });
    return found ? this.toDomain(found) : null;
  }

  private toDomain(raw: PrismaSale): Sale {
    return Sale.restore({
      id: raw.id,
      vehicleId: raw.vehicleId,
      buyerCpf: raw.buyerCpf,
      price: raw.price,
      saleDate: raw.saleDate,
      status: raw.status as SaleStatus,
      paymentCode: raw.paymentCode,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
