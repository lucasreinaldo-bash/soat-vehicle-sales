import { Decimal } from '@prisma/client/runtime/library';
import { Cpf } from '../shared/value-objects/cpf.vo';

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
  buyerCpf: string;
  price: Decimal;
  saleDate: Date;
  status: SaleStatus;
  paymentCode: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entidade de domínio Sale. Representa a intenção/registro de venda de um
 * veículo específico. É criada em PENDING_PAYMENT e só se torna definitiva
 * (PAID) quando o processador de pagamento confirma via webhook — o que também
 * é o gatilho para o Vehicle mudar para SOLD (ver SellVehicleUseCase e
 * ProcessPaymentWebhookUseCase).
 */
export class Sale {
  private constructor(private readonly props: SaleProps) {}

  static create(
    params: {
      id: string;
      vehicleId: string;
      buyerCpf: Cpf;
      price: Decimal;
      paymentCode: string;
    },
    now: Date = new Date(),
  ): Sale {
    return new Sale({
      id: params.id,
      vehicleId: params.vehicleId,
      buyerCpf: params.buyerCpf.value(),
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
  get buyerCpf(): string {
    return this.props.buyerCpf;
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
