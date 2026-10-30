import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedUser, Role } from './authenticated-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marca a rota (ou o controller) como acessível sem token. Tudo o mais exige autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige que o usuário autenticado tenha ao menos um dos papéis informados. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injeta no handler o usuário autenticado pelo JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_dados: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
