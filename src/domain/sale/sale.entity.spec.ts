import { Decimal } from '@prisma/client/runtime/library';
import { Sale, SaleStatus } from './sale.entity';
import { Cpf } from '../shared/value-objects/cpf.vo';

const buildSale = () =>
  Sale.create({
    id: 's1',
    vehicleId: 'v1',
    buyerCpf: Cpf.create('529.982.247-25'),
    price: new Decimal('79990.00'),
    paymentCode: 'PAY-123',
  });

describe('Sale (entidade de domínio)', () => {
  it('nasce aguardando pagamento e registra a data da venda', () => {
    const before = Date.now();
    const sale = buildSale();

    expect(sale.status).toBe(SaleStatus.PENDING_PAYMENT);
    expect(sale.isPending()).toBe(true);
    expect(sale.saleDate.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('armazena o CPF do comprador apenas com dígitos', () => {
    expect(buildSale().buyerCpf).toBe('52998224725');
  });

  it('confirma o pagamento', () => {
    const paid = buildSale().confirmPayment();
    expect(paid.status).toBe(SaleStatus.PAID);
    expect(paid.isPending()).toBe(false);
  });

  it('cancela o pagamento', () => {
    const cancelled = buildSale().cancelPayment();
    expect(cancelled.status).toBe(SaleStatus.CANCELLED);
  });

  it('é imutável: transições retornam novas instâncias', () => {
    const sale = buildSale();
    sale.confirmPayment();
    expect(sale.status).toBe(SaleStatus.PENDING_PAYMENT);
  });
});
