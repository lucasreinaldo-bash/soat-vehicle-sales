import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './auth.decorators';
import { AuthenticatedUser, Role } from './authenticated-user';

/**
 * Autorização por papel. Roda depois do JwtAuthGuard: a esta altura o
 * usuário já está autenticado, então a falha aqui é 403 (sem permissão),
 * e não 401 (não autenticado).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const exigidos = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!exigidos || exigidos.length === 0) return true;

    const usuario = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!usuario) throw new UnauthorizedException('Usuário não autenticado.');
    if (exigidos.some((papel) => usuario.roles.includes(papel))) return true;

    throw new ForbiddenException(`Acesso restrito ao papel ${exigidos.join(' ou ')}.`);
  }
}
