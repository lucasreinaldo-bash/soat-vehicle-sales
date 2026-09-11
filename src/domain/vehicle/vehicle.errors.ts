import { ConflictError, NotFoundError, ValidationError } from '../common/errors';

export class VehicleNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Veículo não encontrado: ${id}`);
  }
}

export class VehicleNotAvailableError extends ConflictError {
  constructor(id: string) {
    super(`Veículo ${id} não está disponível para venda`);
  }
}

export class VehicleAlreadySoldError extends ConflictError {
  constructor(id: string) {
    super(`Veículo ${id} já foi vendido e não pode ser editado`);
  }
}

export class InvalidVehicleDataError extends ValidationError {}
