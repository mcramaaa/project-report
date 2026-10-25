import { emailSchema, passwordSchema } from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import { hashPassword } from '../auth/password';
import type { PrismaClient } from '../generated/prisma/client';
import { syncProjectCalendar } from '../projects/project-calendar';

export interface SeedAdminInput {
  email?: string;
  name?: string;
  password?: string;
}

/**
 * Production-safe seed: creates the first system admin only if the email does not exist.
 * An existing account is left untouched (password, status, and admin flag are never reset).
 */
export async function seedSystemAdmin(prisma: PrismaClient, input: SeedAdminInput): Promise<{ email: string; created: boolean }> {
  if (!input.email) throw new Error('SEED_ADMIN_EMAIL wajib di-set.');
  const email = emailSchema.parse(input.email);

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return { email, created: false };

  const parsedPassword = passwordSchema.safeParse(input.password ?? '');
  if (!parsedPassword.success) throw new Error(`SEED_ADMIN_PASSWORD tidak valid: ${parsedPassword.error.issues[0]?.message}`);
  const name = input.name?.trim() || 'Administrator';
  const passwordHash = await hashPassword(parsedPassword.data);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash, isSystemAdmin: true } });
    await writeAudit(tx, {
      actorId: null,
      action: 'CREATE_USER',
      entityType: 'USER',
      entityId: user.id,
      newValue: { name, email, isActive: true, isSystemAdmin: true },
      reason: 'seed system admin',
    });
  });
  return { email, created: true };
}

export const DEV_PROJECT_CODE = 'DEV-001';

/** Development/test sample data only; never run in production. */
export async function seedDevData(prisma: PrismaClient): Promise<{ projectCode: string; created: boolean }> {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed data development tidak boleh dijalankan di production.');
  const existing = await prisma.project.findUnique({ where: { code: DEV_PROJECT_CODE }, select: { id: true } });
  if (existing) return { projectCode: DEV_PROJECT_CODE, created: false };

  await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        code: DEV_PROJECT_CODE,
        activityName: 'Kegiatan Contoh',
        subActivityName: 'Sub Kegiatan Contoh',
        projectName: 'Proyek Development (data contoh)',
        location: 'Lokasi Contoh',
        fiscalYear: 2026,
        contractorName: 'PT Kontraktor Contoh',
        consultantName: 'CV Konsultan Contoh',
        contractNumber: 'DEV/KONTRAK/001',
        contractDate: new Date('2026-05-20'),
        contractValue: '1250000000.00',
        spmkNumber: 'DEV/SPMK/001',
        spmkDate: new Date('2026-05-25'),
        startDate: new Date('2026-05-26'),
        durationDays: 180,
      },
    });
    await syncProjectCalendar(tx, project.id, '2026-05-26', 180);
  });
  return { projectCode: DEV_PROJECT_CODE, created: true };
}
