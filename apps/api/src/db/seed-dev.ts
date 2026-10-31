import { loadRootEnv, requireEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { seedDevData, seedDevWorkers } from './seeding';

async function main() {
  loadRootEnv();
  const prisma = new PrismaService(requireEnv('DATABASE_URL'));
  try {
    const { projectCode, created } = await seedDevData(prisma);
    console.log(created ? `Proyek development ${projectCode} dibuat.` : `Proyek development ${projectCode} sudah ada; tidak diubah.`);
    console.log(`${await seedDevWorkers(prisma)} pekerja contoh ditambahkan.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
