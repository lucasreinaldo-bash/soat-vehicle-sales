import { Sale } from '../../domain/sale/sale.entity';

export interface ISaleRepository {
  save(sale: Sale): Promise<Sale>;
  update(sale: Sale): Promise<Sale>;
  findById(id: string): Promise<Sale | null>;
  findByPaymentCode(paymentCode: string): Promise<Sale | null>;
  findByVehicleId(vehicleId: string): Promise<Sale | null>;
}
