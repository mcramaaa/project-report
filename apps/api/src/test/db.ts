import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password';
import { assertTestDatabase } from './test-database';

export function createTestPrisma(): PrismaService {
  const url = process.env.DATABASE_URL ?? '';
  assertTestDatabase(url);
  return new PrismaService(url);
}

const TABLES = ['audit_logs', 'project_users', 'auth_sessions', 'projects', 'users'];

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL ?? '');
  // Single connection so FOREIGN_KEY_CHECKS applies to every TRUNCATE.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
}

export const TEST_PASSWORD = 'rahasia-test-123';

export async function createUser(
  prisma: PrismaService,
  data: { email: string; name?: string; isSystemAdmin?: boolean; isActive?: boolean; password?: string },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email,
      isSystemAdmin: data.isSystemAdmin ?? false,
      isActive: data.isActive ?? true,
      passwordHash: await hashPassword(data.password ?? TEST_PASSWORD),
    },
  });
}

let projectSeq = 0;

export function createProject(prisma: PrismaService, code = `P-${++projectSeq}`) {
  return prisma.project.create({
    data: {
      code,
      activityName: 'Kegiatan',
      subActivityName: 'Sub',
      projectName: `Proyek ${code}`,
      location: 'Lokasi',
      fiscalYear: 2026,
      contractorName: 'Kontraktor',
      consultantName: 'Konsultan',
      contractNumber: 'K-1',
      contractDate: new Date('2026-01-01'),
      spmkNumber: 'S-1',
      spmkDate: new Date('2026-01-02'),
      startDate: new Date('2026-01-05'),
      durationDays: 120,
    },
  });
}
