import { ConflictError, NotFoundError } from '../common/errors';

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
