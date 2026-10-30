import { Decimal } from '@prisma/client/runtime/library';
import { InvalidBuyerError } from './sale.errors';

export enum SaleStatus {
  /** Venda criada, aguardando confirmação do gateway de pagamento via webhook. */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  /** Pagamento aprovado pelo webhook. */
  PAID = 'PAID',
  /** Pagamento cancelado/recusado pelo webhook. */
  CANCELLED = 'CANCELLED',
}

export interface SaleProps {
  id: string;
  vehicleId: string;
  /**
   * Identificador opaco do comprador no serviço de identidade (o `sub` do token).
   * Nenhum dado pessoal — nome, e-mail e CPF ficam apartados, no serviço de
   * identidade, separados dos dados transacionais das vendas.
   */
  buyerId: string;
  price: Decimal;
  saleDate: Date;
  status: SaleStatus;
  paymentCode: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entidade de domínio Sale. Representa a compra de um veículo por um cliente
 * cadastrado. É criada em PENDING_PAYMENT e só se torna definitiva (PAID)
 * quando o processador de pagamento confirma via webhook — o que também é o
 * gatilho para o Vehicle mudar para SOLD (ver PurchaseVehicleUseCase e
 * ProcessPaymentWebhookUseCase).
 */
export class Sale {
  private constructor(private readonly props: SaleProps) {}

  static create(
    params: {
      id: string;
      vehicleId: string;
      buyerId: string;
      price: Decimal;
      paymentCode: string;
    },
    now: Date = new Date(),
  ): Sale {
    if (!params.buyerId || params.buyerId.trim().length === 0) {
      throw new InvalidBuyerError();
    }

    // A data da venda é o instante da compra: o cliente compra pela internet,
    // então não há lançamento retroativo — a data é um fato do servidor.
    return new Sale({
      id: params.id,
      vehicleId: params.vehicleId,
      buyerId: params.buyerId,
      price: params.price,
      saleDate: now,
      status: SaleStatus.PENDING_PAYMENT,
      paymentCode: params.paymentCode,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: SaleProps): Sale {
    return new Sale(props);
  }

  isPending(): boolean {
    return this.props.status === SaleStatus.PENDING_PAYMENT;
  }

  confirmPayment(now: Date = new Date()): Sale {
    return new Sale({ ...this.props, status: SaleStatus.PAID, updatedAt: now });
  }

  cancelPayment(now: Date = new Date()): Sale {
    return new Sale({ ...this.props, status: SaleStatus.CANCELLED, updatedAt: now });
  }

  get id(): string {
    return this.props.id;
  }
  get vehicleId(): string {
    return this.props.vehicleId;
  }
  get buyerId(): string {
    return this.props.buyerId;
  }
  get price(): Decimal {
    return this.props.price;
  }
  get saleDate(): Date {
    return this.props.saleDate;
  }
  get status(): SaleStatus {
    return this.props.status;
  }
  get paymentCode(): string {
    return this.props.paymentCode;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
