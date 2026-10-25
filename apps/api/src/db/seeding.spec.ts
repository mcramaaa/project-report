import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../auth/password';
import { createTestPrisma, resetDatabase } from '../test/db';
import { DEV_PROJECT_CODE, seedDevData, seedSystemAdmin } from './seeding';

const prisma = createTestPrisma();

describe('seed', () => {
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => prisma.$disconnect());

  it('creates the system admin with a normalized email and an audit entry without secrets', async () => {
    const result = await seedSystemAdmin(prisma, { email: '  Admin@Example.COM ', password: 'first-password-1' });
    expect(result).toEqual({ email: 'admin@example.com', created: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
    expect(user.isSystemAdmin).toBe(true);
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('first-password-1', user.passwordHash)).toBe(true);

    const audit = await prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'CREATE_USER', userId: null, projectId: null, entityId: user.id });
    const dump = JSON.stringify(audit);
    expect(dump).not.toContain('first-password-1');
    expect(dump).not.toContain(user.passwordHash);
  });

  it('re-running does not reset the password or the account', async () => {
    await seedSystemAdmin(prisma, { email: 'admin@example.com', password: 'first-password-1' });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });

    const again = await seedSystemAdmin(prisma, { email: 'ADMIN@example.com', password: 'other-password-2' });
    expect(again.created).toBe(false);

    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await verifyPassword('first-password-1', after.passwordHash)).toBe(true);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('rejects a missing or weak initial password', async () => {
    await expect(seedSystemAdmin(prisma, { email: 'admin@example.com' })).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    await expect(seedSystemAdmin(prisma, { email: 'admin@example.com', password: 'short' })).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    expect(await prisma.user.count()).toBe(0);
  });

  it('dev seed is idempotent', async () => {
    expect((await seedDevData(prisma)).created).toBe(true);
    expect((await seedDevData(prisma)).created).toBe(false);
    expect(await prisma.project.count({ where: { code: DEV_PROJECT_CODE } })).toBe(1);
  });

  it('database enforces unique normalized email', async () => {
    await seedSystemAdmin(prisma, { email: 'admin@example.com', password: 'first-password-1' });
    await expect(
      prisma.user.create({ data: { email: 'admin@example.com', name: 'x', passwordHash: 'x' } }),
    ).rejects.toThrow();
  });
});
