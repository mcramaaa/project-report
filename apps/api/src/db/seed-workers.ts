import { loadRootEnv, requireEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { seedDevWorkers } from './seeding';

async function main() {
  loadRootEnv();
  const prisma = new PrismaService(requireEnv('DATABASE_URL'));
  try {
    console.log(`${await seedDevWorkers(prisma)} pekerja contoh ditambahkan.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
