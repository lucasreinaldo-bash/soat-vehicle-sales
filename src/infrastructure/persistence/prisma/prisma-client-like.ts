import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Menor denominador comum entre o PrismaClient completo e o client transacional
 * entregue por `prisma.$transaction`. Permite que o mesmo repositório funcione
 * dentro ou fora de uma transação (ver PrismaUnitOfWork).
 */
export type PrismaClientLike = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
> &
  Prisma.TransactionClient;
