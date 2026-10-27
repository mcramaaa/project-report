import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { normalizeEmail } from '@laporan-proyek/shared';
import { AppModule } from '../app.module';
import { loadRootEnv } from '../config/env';
import { DocumentsService } from '../documents/documents.service';
import { RabImportsService } from '../imports/rab-imports.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RabService } from '../rab/rab.service';
import { AHSP_SAMPLE_CODE, seedAhspSample } from './sample-ahsp';

// Same depth from src/db and dist/db: <root>/apps/api/{src,dist}/db.
const TEMP = resolve(__dirname, '../../../../storage/temp');
const DEFAULTS = {
  penawaran: resolve(TEMP, '00. RAB PENAWARAN SDN 2 SERANGAN.xlsx'),
  mingguan: resolve(TEMP, '04. LAPORAN MINGGUAN SDN 2 SERANGAN (MC 0).xlsx'),
};

async function main() {
  loadRootEnv();
  // The seed decides as a reviewer; the AI is not needed (all chains/candidates are deterministic).
  process.env.NINEROUTER_API_KEY = '';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const email = process.env.SEED_ADMIN_EMAIL ? normalizeEmail(process.env.SEED_ADMIN_EMAIL) : undefined;
    const admin =
      (email && (await prisma.user.findFirst({ where: { email, isActive: true, isSystemAdmin: true } }))) ||
      (await prisma.user.findFirst({ where: { isActive: true, isSystemAdmin: true }, orderBy: { createdAt: 'asc' } }));
    if (!admin) throw new Error('Belum ada super admin aktif. Jalankan "npm run db:seed" lebih dahulu.');
    const report = await seedAhspSample(
      { prisma, projects: app.get(ProjectsService), rab: app.get(RabService), documents: app.get(DocumentsService), imports: app.get(RabImportsService) },
      { id: admin.id, name: admin.name, email: admin.email, isSystemAdmin: true },
      DEFAULTS,
    );
    console.log(`Proyek ${AHSP_SAMPLE_CODE} (${report.projectId}) — ${report.steps.join('; ')}`);
    for (const [label, v] of [['Kontrak', report.contract], ['MC-0', report.mc0]] as const) {
      console.log(
        `${label}: real cost ${v.realCost}, dibulatkan ${v.rounded} (workbook ${v.workbookRealCost ?? '–'} / ${v.workbookRounded ?? '–'}); ${v.items} item; ` +
          `analisa ${v.analysesImported} diimpor dari ${v.analysesInWorkbook} di workbook (${v.analysesDirect} langsung dipakai item, ${v.subAnalyses} subanalisa); ` +
          `${v.components} komponen; ${v.prices} harga; ${v.reconciliationEntries} rekonsiliasi; keputusan ${JSON.stringify(v.decisions)}; ` +
          `item dicocokkan ${v.rowsChecked} (berbeda ${v.rowsMismatched}), total ${v.totalStatus ?? '–'}; overhead tidak dipakai: ${v.overheadUnused.join(', ') || '–'}`,
      );
    }
    for (const [label, p] of [['Kontrak', report.contract], ['MC-0', report.mc0], ['MC-1', report.mc1]] as const) {
      console.log(
        `Paket ${label} (${p.status}): ${p.packageAnalyses} analisa, ${p.packageComponents} komponen, ${p.packagePrices} harga; ` +
          `salinan ${JSON.stringify(p.copiedFrom)}; relasi keluar paket ${JSON.stringify(p.isolation)}; real cost ${p.realCost}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
