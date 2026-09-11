import { Decimal } from '@prisma/client/runtime/library';
import { InvalidVehicleDataError, VehicleAlreadySoldError } from './vehicle.errors';

export enum VehicleStatus {
  /** Publicado no catálogo, pode ser vendido. */
  AVAILABLE = 'AVAILABLE',
  /** Venda em andamento: pagamento aguardando confirmação do webhook. */
  RESERVED = 'RESERVED',
  /** Pagamento confirmado; venda concluída. */
  SOLD = 'SOLD',
}

export interface VehicleProps {
  id: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  price: Decimal;
  status: VehicleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewVehicleData {
  brand: string;
  model: string;
  year: number;
  color: string;
  price: number | Decimal;
}

export interface VehicleUpdateData {
  brand?: string;
  model?: string;
  year?: number;
  color?: string;
  price?: number | Decimal;
}

const MIN_MANUFACTURE_YEAR = 1900;

/**
 * Entidade de domínio Vehicle. Imutável: toda transição de estado retorna uma
 * nova instância, evitando mutação implícita e tornando o fluxo auditável.
 */
export class Vehicle {
  private constructor(private readonly props: VehicleProps) {}

  static create(id: string, data: NewVehicleData, now: Date = new Date()): Vehicle {
    Vehicle.validate(data);

    return new Vehicle({
      id,
      brand: data.brand.trim(),
      model: data.model.trim(),
      year: data.year,
      color: data.color.trim(),
      price: new Decimal(data.price),
      status: VehicleStatus.AVAILABLE,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: VehicleProps): Vehicle {
    return new Vehicle(props);
  }

  private static validate(data: NewVehicleData | VehicleUpdateData): void {
    if (data.brand !== undefined && data.brand.trim().length === 0) {
      throw new InvalidVehicleDataError('A marca do veículo é obrigatória');
    }
    if (data.model !== undefined && data.model.trim().length === 0) {
      throw new InvalidVehicleDataError('O modelo do veículo é obrigatório');
    }
    if (data.color !== undefined && data.color.trim().length === 0) {
      throw new InvalidVehicleDataError('A cor do veículo é obrigatória');
    }
    const currentYear = new Date().getFullYear();
    if (
      data.year !== undefined &&
      (data.year < MIN_MANUFACTURE_YEAR || data.year > currentYear + 1)
    ) {
      throw new InvalidVehicleDataError(
        `Ano inválido: ${data.year}. Deve estar entre ${MIN_MANUFACTURE_YEAR} e ${currentYear + 1}`,
      );
    }
    if (data.price !== undefined && new Decimal(data.price).lessThanOrEqualTo(0)) {
      throw new InvalidVehicleDataError('O preço do veículo deve ser maior que zero');
    }
  }

  update(data: VehicleUpdateData, now: Date = new Date()): Vehicle {
    if (this.props.status === VehicleStatus.SOLD) {
      throw new VehicleAlreadySoldError(this.props.id);
    }
    Vehicle.validate(data);

    return new Vehicle({
      ...this.props,
      brand: data.brand !== undefined ? data.brand.trim() : this.props.brand,
      model: data.model !== undefined ? data.model.trim() : this.props.model,
      year: data.year ?? this.props.year,
      color: data.color !== undefined ? data.color.trim() : this.props.color,
      price: data.price !== undefined ? new Decimal(data.price) : this.props.price,
      updatedAt: now,
    });
  }

  /** Reserva o veículo ao iniciar uma venda (aguardando confirmação de pagamento). */
  reserve(now: Date = new Date()): Vehicle {
    return new Vehicle({ ...this.props, status: VehicleStatus.RESERVED, updatedAt: now });
  }

  /** Confirma a venda após aprovação do pagamento. */
  markAsSold(now: Date = new Date()): Vehicle {
    return new Vehicle({ ...this.props, status: VehicleStatus.SOLD, updatedAt: now });
  }

  /** Devolve o veículo ao catálogo (pagamento cancelado). */
  releaseBackToCatalog(now: Date = new Date()): Vehicle {
    return new Vehicle({ ...this.props, status: VehicleStatus.AVAILABLE, updatedAt: now });
  }

  isAvailable(): boolean {
    return this.props.status === VehicleStatus.AVAILABLE;
  }

  get id(): string {
    return this.props.id;
  }
  get brand(): string {
    return this.props.brand;
  }
  get model(): string {
    return this.props.model;
  }
  get year(): number {
    return this.props.year;
  }
  get color(): string {
    return this.props.color;
  }
  get price(): Decimal {
    return this.props.price;
  }
  get status(): VehicleStatus {
    return this.props.status;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
