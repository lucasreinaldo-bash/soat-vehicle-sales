import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { AUTH_CONFIG, AuthConfig, authConfigFromEnv } from './auth.config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtTokenVerifier } from './jwt-token-verifier';
import { RolesGuard } from './roles.guard';

/**
 * Autenticação e autorização na borda HTTP. Os guards são globais e executam
 * na ordem em que são registrados: primeiro autentica (JWT), depois autoriza
 * (papel). Os casos de uso não conhecem nada disto — recebem só o id do usuário.
 */
@Module({
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => authConfigFromEnv() },
    {
      provide: JwtTokenVerifier,
      inject: [AUTH_CONFIG],
      // O JWKS remoto faz cache das chaves e só refaz a busca quando aparece
      // um "kid" desconhecido — suporta a rotação de chaves do Keycloak.
      useFactory: (config: AuthConfig) =>
        new JwtTokenVerifier(config, createRemoteJWKSet(new URL(config.jwksUri))),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
