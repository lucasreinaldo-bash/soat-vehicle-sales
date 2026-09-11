/**
 * Hierarquia de erros de domínio. Cada subtipo carrega semântica própria e é
 * traduzido para um HTTP status específico na borda (ver DomainExceptionFilter),
 * mantendo o domínio 100% livre de qualquer conceito de HTTP.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Uma entidade referenciada não existe. */
export class NotFoundError extends DomainError {}

/** Os dados fornecidos violam uma invariante de domínio (ex.: CPF inválido, preço negativo). */
export class ValidationError extends DomainError {}

/** A operação não pode ser concluída dado o estado atual da entidade (ex.: vender veículo já vendido). */
export class ConflictError extends DomainError {}
