import { ISaleRepository } from './sale.repository.port';
import { IVehicleRepository } from './vehicle.repository.port';

/** Repositórios ligados a uma mesma transação. */
export interface RepositoryContext {
  vehicles: IVehicleRepository;
  sales: ISaleRepository;
}

/**
 * Unit of Work: permite que um caso de uso escreva em mais de um agregado de
 * forma atômica, sem conhecer o mecanismo de transação subjacente.
 *
 * É necessário porque tanto a venda quanto o webhook alteram Sale **e** Vehicle
 * na mesma operação de negócio: sem atomicidade, uma falha entre as duas
 * escritas deixaria o sistema inconsistente (ex.: venda registrada com o
 * veículo ainda aparecendo como disponível no catálogo).
 */
export interface IUnitOfWork {
  execute<T>(work: (repositories: RepositoryContext) => Promise<T>): Promise<T>;
}
