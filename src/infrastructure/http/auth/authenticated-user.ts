/** Papéis do realm `vehicle-sales` no serviço de identidade. */
export type Role = 'admin' | 'customer';

/**
 * O que a API sabe sobre quem fez a requisição: um identificador opaco e os
 * papéis. Nenhum dado pessoal (nome, e-mail, CPF) — esses vivem apenas no
 * serviço de identidade, que é apartado desta API.
 */
export interface AuthenticatedUser {
  id: string;
  roles: string[];
}
