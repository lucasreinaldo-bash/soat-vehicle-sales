/**
 * Popula o catálogo com alguns veículos disponíveis, útil para demonstração.
 * Execute com: npm run prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const vehicles = [
  { brand: 'Fiat', model: 'Mobi Like', year: 2021, color: 'Vermelho', price: 45900.0 },
  { brand: 'Renault', model: 'Kwid Zen', year: 2022, color: 'Branco', price: 52900.0 },
  { brand: 'Volkswagen', model: 'Gol 1.0', year: 2022, color: 'Prata', price: 68990.0 },
  { brand: 'Chevrolet', model: 'Onix LT', year: 2023, color: 'Preto', price: 84990.0 },
  { brand: 'Toyota', model: 'Corolla XEi', year: 2023, color: 'Cinza', price: 168900.0 },
  { brand: 'BMW', model: '320i M Sport', year: 2023, color: 'Azul', price: 289900.0 },
];

async function main() {
  const existing = await prisma.vehicle.count();
  if (existing > 0) {
    console.log(`Seed ignorado: já existem ${existing} veículos cadastrados.`);
    return;
  }

  const now = new Date();
  await prisma.vehicle.createMany({
    data: vehicles.map((vehicle) => ({
      id: randomUUID(),
      ...vehicle,
      status: 'AVAILABLE',
      createdAt: now,
      updatedAt: now,
    })),
  });

  console.log(`${vehicles.length} veículos cadastrados com sucesso.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
