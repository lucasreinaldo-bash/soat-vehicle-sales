import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '../../../domain/common/errors';

/**
 * Traduz erros de domínio para respostas HTTP, mantendo o domínio livre de
 * qualquer conhecimento sobre HTTP (Clean Architecture: dependências apontam
 * para dentro; a borda é quem conhece o mundo externo).
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno do servidor';
    let error = 'InternalServerError';

    if (exception instanceof NotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = exception.message;
      error = exception.name;
    } else if (exception instanceof ConflictError) {
      status = HttpStatus.CONFLICT;
      message = exception.message;
      error = exception.name;
    } else if (exception instanceof ValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = exception.message;
      error = exception.name;
    } else if (exception instanceof DomainError) {
      status = HttpStatus.BAD_REQUEST;
      message = exception.message;
      error = exception.name;
    } else if (
      exception &&
      typeof exception === 'object' &&
      'getStatus' in exception &&
      typeof exception.getStatus === 'function'
    ) {
      // Exceções nativas do Nest (ex.: ValidationPipe/class-validator, 404 de rota).
      const httpException = exception as {
        getStatus: () => number;
        getResponse: () => unknown;
      };
      status = httpException.getStatus();
      const body = httpException.getResponse();
      message =
        typeof body === 'object' && body && 'message' in body
          ? (body.message as string)
          : String(body);
      error = 'BadRequest';
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.constructor.name;
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
