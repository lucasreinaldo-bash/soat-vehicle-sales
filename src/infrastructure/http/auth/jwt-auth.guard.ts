import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { AuthenticatedUser } from './authenticated-user';
import { IdentityProviderUnavailableError, JwtTokenVerifier } from './jwt-token-verifier';

/**
 * Guard GLOBAL: toda rota exige token, exceto as marcadas com @Public().
 * Seguro por padrão — esquecer o decorator numa rota nova a deixa fechada,
 * nunca aberta.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtTokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publica) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: AuthenticatedUser }>();
    const [esquema, token] = (req.headers.authorization ?? '').split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException(
        'Token de acesso ausente. Envie o cabeçalho Authorization: Bearer <token>.',
      );
    }

    try {
      req.user = await this.verifier.verify(token);
      return true;
    } catch (erro) {
      if (erro instanceof IdentityProviderUnavailableError) {
        throw new ServiceUnavailableException(
          'Serviço de identidade indisponível para validar o token. Tente novamente.',
        );
      }
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
  }
}
