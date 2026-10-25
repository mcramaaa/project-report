import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
let adminId: string;
let projectA: { id: string; code: string };
let projectB: { id: string; code: string };
const roles: Record<string, string> = {};

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
}

const members = (projectId: string) => `/admin/projects/${projectId}/members`;
const role = (code: string) => ({ id: roles[code], code, name: expect.any(String) });

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  Object.assign(t.app.get(LoginRateLimiter), new LoginRateLimiter());
  for (const code of ['FILLER', 'REVIEWER', 'MANAGER', 'ADMIN']) roles[code] = await roleId(t.prisma, code);
  adminId = (await createUser(t.prisma, { email: 'admin@example.com', name: 'Admin', isSystemAdmin: true })).id;
  admin = await loggedIn('admin@example.com');
  projectA = await createProject(t.prisma, 'A-001');
  projectB = await createProject(t.prisma, 'B-001');
});

describe('project data access', () => {
  it('super admin reads every project without a membership (D-035)', async () => {
    expect((await admin.get('/projects')).body.items).toEqual([
      expect.objectContaining({ id: projectA.id, code: 'A-001', projectName: 'Proyek A-001', role: null }),
      expect.objectContaining({ id: projectB.id, code: 'B-001', projectName: 'Proyek B-001', role: null }),
    ]);
    expect((await admin.get(`/projects/${projectA.id}`)).status).toBe(200);
    expect((await admin.get('/projects/0192f0f0-0000-7000-8000-000000000000')).status).toBe(404);
  });

  it('isolates projects for regular users: a member of A cannot read B', async () => {
    const u = await createUser(t.prisma, { email: 'filler@example.com' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.FILLER });
    const c = await loggedIn('filler@example.com');

    expect((await c.get('/projects')).body.items).toEqual([
      { id: projectA.id, code: 'A-001', projectName: 'Proyek A-001', fiscalYear: 2026, status: 'ACTIVE', startDate: '2026-01-05', plannedFinishDate: '2026-05-04', role: role('FILLER') },
    ]);
    const read = await c.get(`/projects/${projectA.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ code: 'A-001', startDate: '2026-01-05', durationDays: 120 });
    expect((await c.get(`/projects/${projectB.id}`)).status).toBe(404);
    expect((await c.get('/projects/bukan-uuid')).status).toBe(404);
  });

  it('every system role can read its own project by default', async () => {
    for (const code of ['FILLER', 'REVIEWER', 'MANAGER', 'ADMIN']) {
      const u = await createUser(t.prisma, { email: `role-${code.toLowerCase()}@example.com` });
      await admin.post(members(projectA.id), { userId: u.id, roleId: roles[code] });
      const c = await loggedIn(`role-${code.toLowerCase()}@example.com`);
      expect((await c.get(`/projects/${projectA.id}`)).status, code).toBe(200);
    }
  });

  it('a deactivated member loses access even though the membership remains', async () => {
    const u = await createUser(t.prisma, { email: 'm@example.com' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.MANAGER });
    const c = await loggedIn('m@example.com');
    await admin.post(`/admin/users/${u.id}/deactivate`);
    expect((await c.get(`/projects/${projectA.id}`)).status).toBe(401);
  });
});

describe('membership management', () => {
  it('project roles alone do not allow managing members', async () => {
    const u = await createUser(t.prisma, { email: 'manager@example.com' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.MANAGER });
    const manager = await loggedIn('manager@example.com');

    expect((await manager.get(members(projectA.id))).status).toBe(403);
    expect((await manager.post(members(projectA.id), { userId: adminId, roleId: roles.ADMIN })).status).toBe(403);
    expect((await manager.patch(`${members(projectA.id)}/${u.id}`, { roleId: roles.ADMIN })).status).toBe(403);
    expect((await manager.delete(`${members(projectA.id)}/${u.id}`)).status).toBe(403);
  });

  it('lists members with minimum metadata only', async () => {
    const u = await createUser(t.prisma, { email: 'siti@example.com', name: 'Siti' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.REVIEWER });
    const res = await admin.get(members(projectA.id));
    expect(res.body.project).toEqual({ id: projectA.id, code: 'A-001', projectName: 'Proyek A-001' });
    expect(res.body.members).toEqual([
      { userId: u.id, name: 'Siti', email: 'siti@example.com', isActive: true, role: { ...role('REVIEWER'), isActive: true }, createdAt: expect.any(String) },
    ]);
  });

  it('prevents duplicate memberships at API and database level', async () => {
    const u = await createUser(t.prisma, { email: 'u@example.com' });
    expect((await admin.post(members(projectA.id), { userId: u.id, roleId: roles.FILLER })).status).toBe(204);
    expect((await admin.post(members(projectA.id), { userId: u.id, roleId: roles.MANAGER })).status).toBe(409);

    const concurrent = await createUser(t.prisma, { email: 'c@example.com' });
    const results = await Promise.all([
      admin.post(members(projectA.id), { userId: concurrent.id, roleId: roles.FILLER }),
      admin.post(members(projectA.id), { userId: concurrent.id, roleId: roles.REVIEWER }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);

    await expect(t.prisma.projectUser.create({ data: { projectId: projectA.id, userId: u.id, roleId: roles.ADMIN! } })).rejects.toThrow();
    expect(await t.prisma.projectUser.count({ where: { projectId: projectA.id } })).toBe(2);
  });

  it('rejects inactive or unknown users and invalid roles', async () => {
    const inactive = await createUser(t.prisma, { email: 'off@example.com', isActive: false });
    const active = await createUser(t.prisma, { email: 'on@example.com' });
    const missing = '0192f0f0-0000-7000-8000-000000000000';
    expect((await admin.post(members(projectA.id), { userId: inactive.id, roleId: roles.FILLER })).status).toBe(400);
    expect((await admin.post(members(projectA.id), { userId: missing, roleId: roles.FILLER })).status).toBe(404);
    expect((await admin.post(members(missing), { userId: active.id, roleId: roles.FILLER })).status).toBe(404);
    expect((await admin.post(members(projectA.id), { userId: active.id, roleId: missing })).status).toBe(400);
    expect((await admin.post(members(projectA.id), { userId: active.id, roleId: 'OWNER' })).status).toBe(400);
  });

  it('role changes apply on the next request', async () => {
    const u = await createUser(t.prisma, { email: 'u@example.com' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.FILLER });
    const c = await loggedIn('u@example.com');
    expect((await c.get('/projects')).body.items[0].role.code).toBe('FILLER');

    expect((await admin.patch(`${members(projectA.id)}/${u.id}`, { roleId: roles.REVIEWER })).status).toBe(204);
    expect((await c.get('/projects')).body.items[0].role.code).toBe('REVIEWER');
  });

  it('revocation removes access immediately, keeps the user and history, and re-adding reuses the row', async () => {
    const u = await createUser(t.prisma, { email: 'u@example.com' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.FILLER });
    const c = await loggedIn('u@example.com');
    expect((await c.get(`/projects/${projectA.id}`)).status).toBe(200);

    expect((await admin.delete(`${members(projectA.id)}/${u.id}`, { reason: 'pindah tugas' })).status).toBe(204);
    expect((await c.get(`/projects/${projectA.id}`)).status).toBe(404);
    expect((await c.get('/projects')).body.items).toEqual([]);
    expect((await c.get('/auth/me')).status).toBe(200); // global account untouched
    expect((await admin.get(members(projectA.id))).body.members).toEqual([]);
    expect((await admin.delete(`${members(projectA.id)}/${u.id}`)).status).toBe(404);

    expect((await admin.post(members(projectA.id), { userId: u.id, roleId: roles.MANAGER })).status).toBe(204);
    expect((await c.get('/projects')).body.items[0].role.code).toBe('MANAGER');
    expect(await t.prisma.projectUser.count({ where: { projectId: projectA.id, userId: u.id } })).toBe(1);

    const audit = await t.prisma.auditLog.findMany({ where: { projectId: projectA.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => [a.action, a.reason])).toEqual([
      ['ADD_PROJECT_MEMBER', null],
      ['REVOKE_PROJECT_MEMBER', 'pindah tugas'],
      ['ADD_PROJECT_MEMBER', null],
    ]);
    expect(audit.every((a) => a.userId === adminId && a.entityType === 'PROJECT_MEMBER' && a.entityId === u.id)).toBe(true);
    expect(audit[2]!.newValue).toEqual({ userId: u.id, roleId: roles.MANAGER, roleCode: 'MANAGER', reactivated: true });
  });

  it('same user can hold different roles in different projects', async () => {
    const u = await createUser(t.prisma, { email: 'u@example.com' });
    await admin.post(members(projectA.id), { userId: u.id, roleId: roles.FILLER });
    await admin.post(members(projectB.id), { userId: u.id, roleId: roles.MANAGER });
    const c = await loggedIn('u@example.com');
    expect((await c.get('/projects')).body.items.map((p: { code: string; role: { code: string } }) => [p.code, p.role.code])).toEqual([
      ['A-001', 'FILLER'],
      ['B-001', 'MANAGER'],
    ]);
  });
});
