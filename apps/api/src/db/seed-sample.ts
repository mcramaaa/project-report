import { resolve } from 'node:path';
import { normalizeEmail } from '@laporan-proyek/shared';
import { loadRootEnv, requireEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SAMPLE_PROJECT_CODE, seedSampleRab } from './sample-rab';

// Same depth from src/db and dist/db: <root>/apps/api/{src,dist}/db.
const DEFAULT_WORKBOOK = resolve(__dirname, '../../../../storage/temp/04. LAPORAN MINGGUAN SDN 2 SERANGAN (MC 0).xlsx');

async function main() {
  loadRootEnv();
  const fileArg = process.argv.indexOf('--file');
  const workbookPath = fileArg > 0 && process.argv[fileArg + 1] ? resolve(process.argv[fileArg + 1]!) : DEFAULT_WORKBOOK;
  const prisma = new PrismaService(requireEnv('DATABASE_URL'));
  try {
    // The seeded super admin creates and approves the sample, so audit shows a real actor.
    const email = process.env.SEED_ADMIN_EMAIL ? normalizeEmail(process.env.SEED_ADMIN_EMAIL) : undefined;
    const admin =
      (email && (await prisma.user.findFirst({ where: { email, isActive: true, isSystemAdmin: true } }))) ||
      (await prisma.user.findFirst({ where: { isActive: true, isSystemAdmin: true }, orderBy: { createdAt: 'asc' } }));
    if (!admin) throw new Error('Belum ada super admin aktif. Jalankan "npm run db:seed" lebih dahulu.');

    const result = await seedSampleRab(prisma, { id: admin.id, name: admin.name, email: admin.email, isSystemAdmin: true }, workbookPath);
    if (!result.created) return console.log(`Proyek contoh ${SAMPLE_PROJECT_CODE} sudah ada; tidak diubah.`);
    console.log(`Proyek contoh ${SAMPLE_PROJECT_CODE} dibuat oleh ${admin.email} (MANAGER).`);
    console.log(`RAB Kontrak approved: real cost ${result.contract!.realCost}, dibulatkan ${result.contract!.rounded} (sama dengan workbook).`);
    console.log(`RAB MC-0 approved: real cost ${result.mc0!.realCost}, dibulatkan ${result.mc0!.rounded} (sama dengan workbook).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
