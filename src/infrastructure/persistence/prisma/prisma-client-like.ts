import { Prisma } from '@prisma/client';

/**
 * Superfície comum entre o PrismaClient completo e o client transacional
 * entregue por `prisma.$transaction` (este último é o primeiro sem os métodos
 * de controle de conexão/transação). Permite que o mesmo repositório funcione
 * dentro ou fora de uma transação — ver PrismaUnitOfWork.
 */
export type PrismaClientLike = Prisma.TransactionClient;
