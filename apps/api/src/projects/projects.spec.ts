import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
let adminId: string;

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
}

/** Super admin hands a new user a GLOBAL role with the given permissions. */
async function delegate(email: string, permissionCodes: string[]) {
  const code = `DELEGATE_${email.split('@')[0]!.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const role = await admin.post('/admin/roles', { code, name: code, scope: 'GLOBAL' });
  await admin.request('PUT', `/admin/roles/${role.body.id}/permissions`, { permissionCodes });
  const user = await createUser(t.prisma, { email });
  await admin.post(`/admin/users/${user.id}/global-roles`, { roleId: role.body.id });
  return { user, client: await loggedIn(email) };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  code: 'PRJ-001',
  activityName: 'Kegiatan Jalan',
  subActivityName: 'Sub Kegiatan Jalan',
  projectName: 'Peningkatan Jalan Desa',
  location: 'Kabupaten Contoh',
  fiscalYear: 2026,
  contractorName: 'PT Kontraktor',
  consultantName: 'CV Konsultan',
  contractNumber: 'KTR/001',
  contractDate: '2026-05-20',
  contractValue: '1250000000.50',
  spmkNumber: 'SPMK/001',
  spmkDate: '2026-05-25',
  startDate: '2026-05-26',
  durationDays: 29,
  ...overrides,
});

async function createProject(c: Client = admin, overrides: Record<string, unknown> = {}) {
  const res = await c.post('/projects', input(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string };
}

const audits = (action: string) => t.prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
const weekIds = async (projectId: string) =>
  (await t.prisma.projectWeek.findMany({ where: { projectId }, orderBy: { weekNumber: 'asc' }, select: { id: true } })).map((w) => w.id);

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  Object.assign(t.app.get(LoginRateLimiter), new LoginRateLimiter());
  adminId = (await createUser(t.prisma, { email: 'admin@example.com', name: 'Super', isSystemAdmin: true })).id;
  admin = await loggedIn('admin@example.com');
});

describe('create project', () => {
  it('creates identity, MANAGER membership for the creator, weeks, periods, and audit together', async () => {
    const res = await admin.post('/projects', input());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'PRJ-001',
      contractValue: '1250000000.50',
      startDate: '2026-05-26',
      durationDays: 29,
      plannedFinishDate: '2026-06-23',
      status: 'ACTIVE',
    });

    const membership = await t.prisma.projectUser.findFirstOrThrow({ where: { projectId: res.body.id }, include: { role: true } });
    expect([membership.userId, membership.role.code, membership.revokedAt]).toEqual([adminId, 'MANAGER', null]);

    const weeks = await admin.get(`/projects/${res.body.id}/weeks`);
    expect(weeks.body.map((w: { weekNumber: number; periodNumber: number; startDate: string; endDate: string; days: number }) => [w.weekNumber, w.periodNumber, w.startDate, w.endDate, w.days])).toEqual([
      [1, 1, '2026-05-26', '2026-06-01', 7],
      [2, 1, '2026-06-02', '2026-06-08', 7],
      [3, 1, '2026-06-09', '2026-06-15', 7],
      [4, 1, '2026-06-16', '2026-06-22', 7],
      [5, 2, '2026-06-23', '2026-06-23', 1],
    ]);
    const periods = await admin.get(`/projects/${res.body.id}/report-periods`);
    expect(periods.body).toEqual([
      expect.objectContaining({ periodNumber: 1, startDate: '2026-05-26', endDate: '2026-06-22', firstWeekNumber: 1, lastWeekNumber: 4, days: 28 }),
      expect.objectContaining({ periodNumber: 2, startDate: '2026-06-23', endDate: '2026-06-23', firstWeekNumber: 5, lastWeekNumber: 5, days: 1 }),
    ]);

    const [audit] = await audits('CREATE_PROJECT');
    expect(audit).toMatchObject({ userId: adminId, projectId: res.body.id, entityType: 'PROJECT', entityId: res.body.id });
    expect(audit!.newValue).toMatchObject({ code: 'PRJ-001', plannedFinishDate: '2026-06-23', weeks: 5, periods: 2, managerUserId: adminId });
  });

  it('requires projects.create; a delegate creator becomes MANAGER and can then read and update it', async () => {
    const plain = await createUser(t.prisma, { email: 'biasa@example.com' });
    expect(plain).toBeTruthy();
    expect((await (await loggedIn('biasa@example.com')).post('/projects', input())).status).toBe(403);

    const { client: creator } = await delegate('pembuat@example.com', ['projects.create']);
    const project = await createProject(creator);
    expect((await creator.get(`/projects/${project.id}`)).status).toBe(200);
    expect((await creator.patch(`/projects/${project.id}`, { location: 'Lokasi Baru' })).status).toBe(200);
    expect((await creator.get('/projects')).body.items.map((p: { role: { code: string } }) => p.role.code)).toEqual(['MANAGER']);
  });

  it('validates fields without adding date-order rules', async () => {
    for (const bad of [
      { durationDays: 0 },
      { durationDays: 3651 },
      { durationDays: 1.5 },
      { startDate: '2026-02-30' },
      { contractDate: '2027-02-29' },
      { fiscalYear: 1999 },
      { fiscalYear: 2101 },
      { contractValue: '1.234' },
      { contractValue: '1.000.000' },
      { contractValue: -5 },
      { projectName: '  ' },
    ]) {
      expect((await admin.post('/projects', input(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    // Contract after SPMK after start is accepted: no ordering rule (D-039).
    await createProject(admin, { contractDate: '2026-07-01', spmkDate: '2026-06-15', startDate: '2026-06-01', durationDays: 3650, fiscalYear: 2100 });
    expect(await t.prisma.projectWeek.count()).toBe(522);
  });

  it('rejects a duplicate code without leaving partial rows', async () => {
    await createProject();
    expect((await admin.post('/projects', input({ projectName: 'Lain' }))).status).toBe(409);
    expect(await t.prisma.project.count()).toBe(1);
    expect(await t.prisma.projectUser.count()).toBe(1);
    expect(await t.prisma.reportPeriod.count()).toBe(2);
    expect(await audits('CREATE_PROJECT')).toHaveLength(1);
  });

  it('refuses creation with a clear message when MANAGER lacks project.read or project.update, without changing the role', async () => {
    const manager = await roleId(t.prisma, 'MANAGER');
    for (const permissionCodes of [['project.read'], ['project.update'], []]) {
      await admin.request('PUT', `/admin/roles/${manager}/permissions`, { permissionCodes });
      const res = await admin.post('/projects', input());
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Konfigurasi role MANAGER tidak lengkap');
      expect((await t.prisma.rolePermission.findMany({ where: { roleId: manager } })).map((p) => p.permissionCode).sort()).toEqual([...permissionCodes].sort());
    }
    expect(await t.prisma.project.count()).toBe(0);
    expect(await t.prisma.projectWeek.count()).toBe(0);
    expect(await audits('CREATE_PROJECT')).toHaveLength(0);
  });
});

describe('update identity', () => {
  it('requires project.update in that project and audits only changed fields', async () => {
    const project = await createProject();
    const u = await createUser(t.prisma, { email: 'filler@example.com' });
    await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: await roleId(t.prisma, 'FILLER') });
    const filler = await loggedIn('filler@example.com');
    expect((await filler.patch(`/projects/${project.id}`, { location: 'X' })).status).toBe(403);
    // UI hint only: the caller's project permissions in this project.
    expect((await filler.get(`/projects/${project.id}`)).body.permissions).toEqual(['project.read']);
    expect((await admin.get(`/projects/${project.id}`)).body.permissions).toEqual(['project.read', 'project.update']);
    const outsider = await createUser(t.prisma, { email: 'luar@example.com' });
    expect(outsider).toBeTruthy();
    expect((await (await loggedIn('luar@example.com')).patch(`/projects/${project.id}`, { location: 'X' })).status).toBe(404);

    const res = await admin.patch(`/projects/${project.id}`, { location: 'Lokasi Baru', contractValue: '1250000000.5', fiscalYear: 2026, reason: 'Koreksi lokasi' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ location: 'Lokasi Baru', contractValue: '1250000000.50' });
    const [audit] = await audits('UPDATE_PROJECT');
    expect(audit).toMatchObject({ oldValue: { location: 'Kabupaten Contoh' }, newValue: { location: 'Lokasi Baru' }, reason: 'Koreksi lokasi' });

    expect((await admin.patch(`/projects/${project.id}`, {})).status).toBe(400);
    expect((await admin.patch(`/projects/${project.id}`, { startDate: '2026-06-01' })).status).toBe(400);
  });

  it('rejects a code that is already used', async () => {
    const a = await createProject();
    await createProject(admin, { code: 'PRJ-002' });
    expect((await admin.patch(`/projects/${a.id}`, { code: 'PRJ-002' })).status).toBe(409);
  });
});

describe('change schedule', () => {
  it('requires a reason, keeps week/period ids by number, and audits old and new values', async () => {
    const project = await createProject(admin, { durationDays: 29 });
    const before = await weekIds(project.id);
    const periodBefore = await t.prisma.reportPeriod.findFirstOrThrow({ where: { projectId: project.id, periodNumber: 1 } });

    expect((await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-06-01', durationDays: 29 })).status).toBe(400);
    expect((await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-05-26', durationDays: 29, reason: 'Tidak berubah' })).status).toBe(400);

    // Shift start and extend: weeks 1..5 keep their ids, weeks 6..9 are added.
    const longer = await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-06-01', durationDays: 60, reason: 'SPMK revisi' });
    expect(longer.status).toBe(200);
    expect(longer.body).toMatchObject({ startDate: '2026-06-01', durationDays: 60, plannedFinishDate: '2026-07-30' });
    const extended = await weekIds(project.id);
    expect(extended).toHaveLength(9);
    expect(extended.slice(0, 5)).toEqual(before);
    const week1 = await t.prisma.projectWeek.findUniqueOrThrow({ where: { id: before[0]! } });
    expect(week1.startDate.toISOString().slice(0, 10)).toBe('2026-06-01');
    const periodAfter = await t.prisma.reportPeriod.findFirstOrThrow({ where: { projectId: project.id, periodNumber: 1 } });
    expect(periodAfter.id).toBe(periodBefore.id);
    expect(await t.prisma.reportPeriod.count({ where: { projectId: project.id } })).toBe(3);

    // Shorten: trailing rows without related data are removed, the rest keep their ids.
    const shorter = await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-06-01', durationDays: 8, reason: 'Koreksi durasi' });
    expect(shorter.status).toBe(200);
    expect(await weekIds(project.id)).toEqual(before.slice(0, 2));
    expect(await t.prisma.reportPeriod.count({ where: { projectId: project.id } })).toBe(1);

    const changes = await audits('CHANGE_PROJECT_SCHEDULE');
    expect(changes.map((a) => [a.oldValue, a.newValue, a.reason])).toEqual([
      [
        { startDate: '2026-05-26', durationDays: 29, plannedFinishDate: '2026-06-23', weeks: 5, periods: 2 },
        { startDate: '2026-06-01', durationDays: 60, plannedFinishDate: '2026-07-30', weeks: 9, periods: 3 },
        'SPMK revisi',
      ],
      [
        { startDate: '2026-06-01', durationDays: 60, plannedFinishDate: '2026-07-30', weeks: 9, periods: 3 },
        { startDate: '2026-06-01', durationDays: 8, plannedFinishDate: '2026-06-08', weeks: 2, periods: 1 },
        'Koreksi durasi',
      ],
    ]);
  });

  it('rolls everything back when a trailing week still has related data (RESTRICT)', async () => {
    const project = await createProject(admin, { durationDays: 29 });
    const lastWeek = await t.prisma.projectWeek.findFirstOrThrow({ where: { projectId: project.id, weekNumber: 5 } });
    // Stand-in for future tables (weekly progress, reports) that reference weeks with RESTRICT.
    await t.prisma.$executeRawUnsafe(
      'CREATE TABLE test_week_refs (week_id CHAR(36) NOT NULL, FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE RESTRICT) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
    try {
      await t.prisma.$executeRawUnsafe('INSERT INTO test_week_refs (week_id) VALUES (?)', lastWeek.id);
      const res = await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-06-01', durationDays: 28, reason: 'Persingkat' });
      expect(res.status).toBe(409);
      expect((await admin.get(`/projects/${project.id}`)).body).toMatchObject({ startDate: '2026-05-26', durationDays: 29 });
      const week1 = await t.prisma.projectWeek.findFirstOrThrow({ where: { projectId: project.id, weekNumber: 1 } });
      expect(week1.startDate.toISOString().slice(0, 10)).toBe('2026-05-26');
      expect(await t.prisma.projectWeek.count({ where: { projectId: project.id } })).toBe(5);
      expect(await audits('CHANGE_PROJECT_SCHEDULE')).toHaveLength(0);
    } finally {
      await t.prisma.$executeRawUnsafe('DROP TABLE test_week_refs');
    }
  });

  it('serializes concurrent changes so weeks always match the final schedule', async () => {
    const project = await createProject(admin, { durationDays: 29 });
    const results = await Promise.all(
      [10, 50, 100, 15].map((durationDays) =>
        admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-05-26', durationDays, reason: `durasi ${durationDays}` }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const final = (await admin.get(`/projects/${project.id}`)).body;
    const weeks = (await admin.get(`/projects/${project.id}/weeks`)).body;
    expect(weeks).toHaveLength(Math.ceil(final.durationDays / 7));
    expect(weeks.at(-1).endDate).toBe(final.plannedFinishDate);
    expect(await audits('CHANGE_PROJECT_SCHEDULE')).toHaveLength(4);
  });
});

describe('close and reopen', () => {
  it('requires a reason, blocks identity and schedule changes while CLOSED, and keeps reads working', async () => {
    const project = await createProject();
    expect((await admin.post(`/projects/${project.id}/close`, {})).status).toBe(400);
    const closed = await admin.post(`/projects/${project.id}/close`, { reason: 'Pekerjaan selesai' });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
    expect((await admin.post(`/projects/${project.id}/close`, { reason: 'Lagi' })).status).toBe(409);

    expect((await admin.patch(`/projects/${project.id}`, { location: 'X' })).status).toBe(409);
    expect((await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-06-01', durationDays: 10, reason: 'Ubah' })).status).toBe(409);
    expect((await admin.get(`/projects/${project.id}`)).status).toBe(200);
    expect((await admin.get(`/projects/${project.id}/weeks`)).body).toHaveLength(5);
    expect((await admin.get('/projects?status=CLOSED')).body.total).toBe(1);

    const reopened = await admin.post(`/projects/${project.id}/reopen`, { reason: 'Ada pekerjaan tambah' });
    expect(reopened.body.status).toBe('ACTIVE');
    expect((await admin.post(`/projects/${project.id}/reopen`, { reason: 'Lagi' })).status).toBe(409);
    expect((await admin.patch(`/projects/${project.id}`, { location: 'X' })).status).toBe(200);

    expect((await audits('CLOSE_PROJECT'))[0]).toMatchObject({ oldValue: { status: 'ACTIVE' }, newValue: { status: 'CLOSED' }, reason: 'Pekerjaan selesai' });
    expect((await audits('REOPEN_PROJECT'))[0]).toMatchObject({ oldValue: { status: 'CLOSED' }, newValue: { status: 'ACTIVE' }, reason: 'Ada pekerjaan tambah' });
  });

  it('requires project.update', async () => {
    const project = await createProject();
    const u = await createUser(t.prisma, { email: 'rev@example.com' });
    await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: await roleId(t.prisma, 'REVIEWER') });
    expect((await (await loggedIn('rev@example.com')).post(`/projects/${project.id}/close`, { reason: 'Tutup' })).status).toBe(403);
  });
});

describe('team and lists', () => {
  it('team shows active members of active users by name and role, never email, and needs project.read', async () => {
    const project = await createProject();
    const filler = await createUser(t.prisma, { email: 'filler@example.com', name: 'Budi' });
    const gone = await createUser(t.prisma, { email: 'gone@example.com', name: 'Dicabut' });
    const inactive = await createUser(t.prisma, { email: 'off@example.com', name: 'Nonaktif' });
    const fillerRole = await roleId(t.prisma, 'FILLER');
    for (const u of [filler, gone, inactive]) await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: fillerRole });
    await admin.delete(`/admin/projects/${project.id}/members/${gone.id}`);
    await admin.post(`/admin/users/${inactive.id}/deactivate`);

    const c = await loggedIn('filler@example.com');
    const team = await c.get(`/projects/${project.id}/team`);
    expect(team.status).toBe(200);
    expect(team.body).toEqual([
      { userId: filler.id, name: 'Budi', role: { id: fillerRole, code: 'FILLER', name: expect.any(String) } },
      { userId: adminId, name: 'Super', role: expect.objectContaining({ code: 'MANAGER' }) },
    ]);
    expect(JSON.stringify(team.body)).not.toContain('@');

    await admin.request('PUT', `/admin/roles/${fillerRole}/permissions`, { permissionCodes: [] });
    expect((await c.get(`/projects/${project.id}/team`)).status).toBe(403);
    expect((await c.get(`/projects/${project.id}/weeks`)).status).toBe(403);
  });

  it('paginates and searches the user and administration project lists', async () => {
    for (let i = 1; i <= 25; i++) await createProject(admin, { code: `PRJ-${String(i).padStart(3, '0')}`, projectName: i === 7 ? 'Jembatan Sungai' : `Jalan ${i}`, durationDays: 7 });

    const page2 = await admin.get('/projects?page=2&pageSize=10');
    expect(page2.body).toMatchObject({ total: 25, page: 2, pageSize: 10 });
    expect(page2.body.items.map((p: { code: string }) => p.code)).toEqual(Array.from({ length: 10 }, (_, i) => `PRJ-${String(i + 11).padStart(3, '0')}`));
    expect((await admin.get('/projects?search=jembatan')).body.items.map((p: { code: string }) => p.code)).toEqual(['PRJ-007']);
    expect((await admin.get('/projects?pageSize=101')).status).toBe(400);

    const adminList = await admin.get('/admin/projects?page=3&pageSize=10');
    expect(adminList.body).toMatchObject({ total: 25, page: 3 });
    expect(adminList.body.items).toHaveLength(5);
    expect(Object.keys(adminList.body.items[0]).sort()).toEqual(['code', 'id', 'projectName']);
    expect((await admin.get('/admin/projects?search=PRJ-02')).body.total).toBe(6);
  });
});
