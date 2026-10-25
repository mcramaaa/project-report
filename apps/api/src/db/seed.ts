import { loadRootEnv, requireEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { seedSystemAdmin } from './seeding';

async function main() {
  loadRootEnv();
  const prisma = new PrismaService(requireEnv('DATABASE_URL'));
  try {
    const { email, created } = await seedSystemAdmin(prisma, {
      email: process.env.SEED_ADMIN_EMAIL,
      name: process.env.SEED_ADMIN_NAME,
      password: process.env.SEED_ADMIN_PASSWORD,
    });
    console.log(created ? `System admin ${email} dibuat.` : `User ${email} sudah ada; tidak diubah (password tidak direset).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
