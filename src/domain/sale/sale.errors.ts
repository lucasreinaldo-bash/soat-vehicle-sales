import { ConflictError, NotFoundError, ValidationError } from '../common/errors';

export class SaleNotFoundError extends NotFoundError {
  constructor(identifier: string) {
    super(`Venda não encontrada: ${identifier}`);
  }
}

export class SaleAlreadyProcessedError extends ConflictError {
  constructor(paymentCode: string, currentStatus: string) {
    super(
      `Pagamento ${paymentCode} já foi processado anteriormente (status atual: ${currentStatus})`,
    );
  }
}

export class InvalidSaleDateError extends ValidationError {
  constructor(saleDate: Date) {
    super(`Data da venda inválida: ${saleDate.toISOString()} (não pode estar no futuro)`);
  }
}
