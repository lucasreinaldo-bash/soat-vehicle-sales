import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: o webhook verifica a assinatura HMAC sobre os bytes EXATOS recebidos,
  // antes de qualquer parse do JSON.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Plataforma de Revenda de Veículos')
    .setDescription(
      'API da plataforma de revenda de veículos automotores. ' +
        'Permite cadastrar e editar veículos, efetuar vendas e receber notificações de pagamento ' +
        'via webhook. Rotas de escrita exigem um token JWT emitido pelo serviço de identidade ' +
        '(botão Authorize). Tech Challenge Fase 3 — SOAT PósTech.',
    )
    .setVersion('3.0.4')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('Veículos', 'Cadastro, edição, listagens e compra de veículos')
    .addTag('Cliente', 'Área do cliente autenticado')
    .addTag('Pagamentos', 'Webhook de notificação de pagamento (assinado com HMAC)')
    .addTag('Health', 'Probes de liveness e readiness (Kubernetes)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`API disponível em http://localhost:${port}`);
  console.log(`Swagger disponível em http://localhost:${port}/docs`);
}

void bootstrap();
