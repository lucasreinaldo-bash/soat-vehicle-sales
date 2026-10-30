import { Decimal } from '@prisma/client/runtime/library';
import { Sale, SaleStatus } from './sale.entity';
import { InvalidBuyerError } from './sale.errors';

const criar = (buyerId = 'cliente-123') =>
  Sale.create({
    id: 's1',
    vehicleId: 'v1',
    buyerId,
    price: new Decimal('79990.00'),
    paymentCode: 'PAY-123',
  });

describe('Sale (entidade de domínio)', () => {
  it('nasce aguardando pagamento, com a data da compra definida pelo servidor', () => {
    const antes = Date.now();
    const sale = criar();

    expect(sale.status).toBe(SaleStatus.PENDING_PAYMENT);
    expect(sale.isPending()).toBe(true);
    expect(sale.saleDate.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('identifica o comprador apenas pelo id opaco do serviço de identidade', () => {
    const sale = criar('3f2a-sub-do-keycloak');
    expect(sale.buyerId).toBe('3f2a-sub-do-keycloak');
  });

  it('não guarda nenhum dado pessoal do comprador', () => {
    const campos = Object.getOwnPropertyNames(Object.getPrototypeOf(criar()));
    expect(campos.filter((c) => /cpf|email|nome|name/i.test(c))).toEqual([]);
  });

  it.each([[''], ['   ']])('rejeita compra sem comprador identificado (%j)', (buyerId) => {
    expect(() => criar(buyerId)).toThrow(InvalidBuyerError);
  });

  it('confirma o pagamento', () => {
    const paga = criar().confirmPayment();
    expect(paga.status).toBe(SaleStatus.PAID);
    expect(paga.isPending()).toBe(false);
  });

  it('cancela o pagamento', () => {
    expect(criar().cancelPayment().status).toBe(SaleStatus.CANCELLED);
  });

  it('é imutável: transições retornam novas instâncias', () => {
    const sale = criar();
    sale.confirmPayment();
    expect(sale.status).toBe(SaleStatus.PENDING_PAYMENT);
  });
});
