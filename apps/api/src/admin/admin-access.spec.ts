import { PERMISSIONS } from '@laporan-proyek/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
let adminId: string;
let project: { id: string };

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
}

/** Super admin creates a GLOBAL role with the given permissions and assigns it to a new user. */
async function delegate(email: string, permissionCodes: string[]) {
  const code = `DELEGATE_${email.split('@')[0]!.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const created = await admin.post('/admin/roles', { code, name: `Delegasi ${email}`, scope: 'GLOBAL' });
  expect(created.status).toBe(201);
  expect((await admin.request('PUT', `/admin/roles/${created.body.id}/permissions`, { permissionCodes })).status).toBe(200);
  const user = await createUser(t.prisma, { email });
  expect((await admin.post(`/admin/users/${user.id}/global-roles`, { roleId: created.body.id })).status).toBe(204);
  return { user, roleId: created.body.id as string, client: await loggedIn(email) };
}

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
  project = await createProject(t.prisma, 'A-001');
});

describe('permissions in /auth/me', () => {
  it('super admin has every global permission; regular users have none', async () => {
    const global = PERMISSIONS.filter((p) => p.scope === 'GLOBAL').map((p) => p.code).sort();
    expect((await admin.get('/auth/me')).body.permissions).toEqual(global);
    await createUser(t.prisma, { email: 'biasa@example.com' });
    expect((await (await loggedIn('biasa@example.com')).get('/auth/me')).body.permissions).toEqual([]);
  });
});

describe('roles', () => {
  it('seeds the four system project roles with their default permissions (D-039, D-041)', async () => {
    const res = await admin.get('/admin/roles?scope=PROJECT');
    expect(res.body.map((r: { code: string; isSystem: boolean; permissionCodes: string[] }) => [r.code, r.isSystem, r.permissionCodes])).toEqual(
      expect.arrayContaining([
        ['FILLER', true, ['project.read', 'rab.read']],
        ['REVIEWER', true, ['project.read', 'rab.read']],
        ['MANAGER', true, ['project.read', 'project.update', 'rab.approve', 'rab.edit', 'rab.read']],
        ['ADMIN', true, ['project.read', 'rab.edit', 'rab.read']],
      ]),
    );
  });

  it('creates custom roles with unique normalized codes', async () => {
    const res = await admin.post('/admin/roles', { code: 'pengawas_lapangan', name: 'Pengawas Lapangan', scope: 'PROJECT' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'PENGAWAS_LAPANGAN', scope: 'PROJECT', isSystem: false, isActive: true, permissionCodes: [] });
    expect((await admin.post('/admin/roles', { code: 'PENGAWAS_LAPANGAN', name: 'Lagi', scope: 'PROJECT' })).status).toBe(409);
    expect((await admin.post('/admin/roles', { code: '1x', name: 'Salah', scope: 'PROJECT' })).status).toBe(400);
  });

  it('locks code and status of system roles but allows name and permissions', async () => {
    const filler = await roleId(t.prisma, 'FILLER');
    expect((await admin.patch(`/admin/roles/${filler}`, { code: 'PENGISI' })).status).toBe(400);
    expect((await admin.patch(`/admin/roles/${filler}`, { isActive: false })).status).toBe(400);
    expect((await admin.patch(`/admin/roles/${filler}`, { name: 'Pengisi Progres' })).body.name).toBe('Pengisi Progres');
  });

  it('rejects unknown permissions and permissions of the wrong scope', async () => {
    const filler = await roleId(t.prisma, 'FILLER');
    expect((await admin.request('PUT', `/admin/roles/${filler}/permissions`, { permissionCodes: ['project.delete'] })).status).toBe(400);
    expect((await admin.request('PUT', `/admin/roles/${filler}/permissions`, { permissionCodes: ['users.manage'] })).status).toBe(400);
    expect((await t.prisma.rolePermission.findMany({ where: { roleId: filler } })).map((p) => p.permissionCode).sort()).toEqual(['project.read', 'rab.read']);
  });

  it('permission and role-status changes apply on the next request', async () => {
    const custom = await admin.post('/admin/roles', { code: 'PENGAMAT', name: 'Pengamat', scope: 'PROJECT' });
    await admin.request('PUT', `/admin/roles/${custom.body.id}/permissions`, { permissionCodes: ['project.read'] });
    const u = await createUser(t.prisma, { email: 'u@example.com' });
    expect((await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: custom.body.id })).status).toBe(204);
    const c = await loggedIn('u@example.com');
    expect((await c.get(`/projects/${project.id}`)).status).toBe(200);

    expect((await c.get('/projects')).body.items).toHaveLength(1);

    // The project list follows the same rule as the detail (regression): no project.read -> not listed.
    await admin.request('PUT', `/admin/roles/${custom.body.id}/permissions`, { permissionCodes: [] });
    expect((await c.get(`/projects/${project.id}`)).status).toBe(403);
    expect((await c.get('/projects')).body.items).toEqual([]);

    await admin.request('PUT', `/admin/roles/${custom.body.id}/permissions`, { permissionCodes: ['project.read'] });
    expect((await c.get(`/projects/${project.id}`)).status).toBe(200);
    expect((await c.get('/projects')).body.items).toHaveLength(1);

    await admin.patch(`/admin/roles/${custom.body.id}`, { isActive: false });
    expect((await c.get(`/projects/${project.id}`)).status).toBe(403);
    expect((await c.get('/projects')).body.items).toEqual([]);
    const other = await createUser(t.prisma, { email: 'v@example.com' });
    expect((await admin.post(`/admin/projects/${project.id}/members`, { userId: other.id, roleId: custom.body.id })).status).toBe(400);
  });

  it('keeps role scopes apart for assignments', async () => {
    const globalRole = await admin.post('/admin/roles', { code: 'AUDITOR', name: 'Auditor', scope: 'GLOBAL' });
    const u = await createUser(t.prisma, { email: 'u@example.com' });
    expect((await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: globalRole.body.id })).status).toBe(400);
    expect((await admin.post(`/admin/users/${u.id}/global-roles`, { roleId: await roleId(t.prisma, 'FILLER') })).status).toBe(400);
  });
});

describe('delegated administration', () => {
  it('users.read and users.manage delegate normal accounts but never super admins', async () => {
    const { client: d } = await delegate('ops@example.com', ['users.read', 'users.manage']);
    expect((await d.get('/admin/users')).status).toBe(200);

    const created = await d.post('/admin/users', { name: 'Baru', email: 'baru@example.com', password: 'password-123' });
    expect(created.status).toBe(201);
    expect((await d.post(`/admin/users/${created.body.id}/deactivate`)).status).toBe(200);

    expect((await d.post('/admin/users', { name: 'X', email: 'x@example.com', password: 'password-123', isSystemAdmin: true })).status).toBe(403);
    expect((await d.patch(`/admin/users/${adminId}`, { name: 'Diambil alih' })).status).toBe(403);
    expect((await d.post(`/admin/users/${adminId}/deactivate`)).status).toBe(403);
    expect((await d.post(`/admin/users/${created.body.id}/grant-system-admin`)).status).toBe(403);
    expect((await d.get('/admin/projects')).status).toBe(403);
    expect((await d.get('/admin/roles')).status).toBe(403);
  });

  it('read-only delegate cannot write', async () => {
    const { client: d } = await delegate('viewer@example.com', ['users.read']);
    expect((await d.get('/admin/users')).status).toBe(200);
    expect((await d.post('/admin/users', { name: 'X', email: 'x@example.com', password: 'password-123' })).status).toBe(403);
  });

  it('roles.manage delegate manages project roles only, and cannot assign administration roles', async () => {
    const { client: d, roleId: ownRole, user } = await delegate('roles@example.com', ['roles.read', 'roles.manage']);
    expect((await d.post('/admin/roles', { code: 'TIM_QC', name: 'Tim QC', scope: 'PROJECT' })).status).toBe(201);
    expect((await d.post('/admin/roles', { code: 'SUPER_OPS', name: 'Super Ops', scope: 'GLOBAL' })).status).toBe(403);
    expect((await d.request('PUT', `/admin/roles/${ownRole}/permissions`, { permissionCodes: ['users.manage'] })).status).toBe(403);
    expect((await d.patch(`/admin/roles/${ownRole}`, { name: 'Diubah' })).status).toBe(403);
    expect((await d.post(`/admin/users/${user.id}/global-roles`, { roleId: ownRole })).status).toBe(403);
  });

  it('assignments.manage delegate manages other members but not its own access, and gains no project data', async () => {
    const { client: d, user } = await delegate('akses@example.com', ['assignments.read', 'assignments.manage']);
    const other = await createUser(t.prisma, { email: 'other@example.com' });
    const filler = await roleId(t.prisma, 'FILLER');
    const manager = await roleId(t.prisma, 'MANAGER');

    expect((await d.get('/admin/projects')).body.items).toEqual([{ id: project.id, code: 'A-001', projectName: 'Proyek A-001' }]);
    expect((await d.post(`/admin/projects/${project.id}/members`, { userId: other.id, roleId: filler })).status).toBe(204);
    expect((await d.patch(`/admin/projects/${project.id}/members/${other.id}`, { roleId: manager })).status).toBe(204);

    expect((await d.post(`/admin/projects/${project.id}/members`, { userId: user.id, roleId: manager })).status).toBe(403);
    expect((await d.get(`/projects/${project.id}`)).status).toBe(404);

    // Even when added by the super admin, the delegate cannot change or revoke its own membership.
    await admin.post(`/admin/projects/${project.id}/members`, { userId: user.id, roleId: filler });
    expect((await d.patch(`/admin/projects/${project.id}/members/${user.id}`, { roleId: manager })).status).toBe(403);
    expect((await d.delete(`/admin/projects/${project.id}/members/${user.id}`)).status).toBe(403);
  });

  it('assignments.manage delegate searches member candidates without users.read (regression)', async () => {
    const { client: d } = await delegate('akses@example.com', ['assignments.read', 'assignments.manage']);
    const candidate = await createUser(t.prisma, { email: 'calon@example.com', name: 'Calon Anggota' });
    const member = await createUser(t.prisma, { email: 'anggota@example.com', name: 'Calon Sudah Anggota' });
    await createUser(t.prisma, { email: 'nonaktif@example.com', name: 'Calon Nonaktif', isActive: false });
    await admin.post(`/admin/projects/${project.id}/members`, { userId: member.id, roleId: await roleId(t.prisma, 'FILLER') });

    expect((await d.get('/admin/users')).status).toBe(403);
    const found = await d.get(`/admin/projects/${project.id}/member-candidates?search=calon`);
    expect(found.status).toBe(200);
    expect(found.body).toEqual([{ id: candidate.id, name: 'Calon Anggota', email: 'calon@example.com' }]);
    // The delegate itself is never offered (it may not add itself).
    expect((await d.get(`/admin/projects/${project.id}/member-candidates?search=akses`)).body).toEqual([]);
    expect((await d.get('/admin/projects/0192f0f0-0000-7000-8000-000000000000/member-candidates')).status).toBe(404);

    const { client: readOnly } = await delegate('baca@example.com', ['assignments.read']);
    expect((await readOnly.get(`/admin/projects/${project.id}/member-candidates`)).status).toBe(403);
  });

  it('revoking or deactivating the administration role removes the delegation on the next request', async () => {
    const { client: d, roleId: delegateRole, user } = await delegate('ops@example.com', ['users.read']);
    expect((await d.get('/admin/users')).status).toBe(200);

    await admin.patch(`/admin/roles/${delegateRole}`, { isActive: false });
    expect((await d.get('/admin/users')).status).toBe(403);
    await admin.patch(`/admin/roles/${delegateRole}`, { isActive: true });
    expect((await d.get('/admin/users')).status).toBe(200);

    expect((await admin.delete(`/admin/users/${user.id}/global-roles/${delegateRole}`)).status).toBe(204);
    expect((await d.get('/admin/users')).status).toBe(403);
    expect((await d.get('/auth/me')).body.permissions).toEqual([]);

    // Re-granting reuses the row; duplicate grants are rejected.
    expect((await admin.post(`/admin/users/${user.id}/global-roles`, { roleId: delegateRole })).status).toBe(204);
    expect((await admin.post(`/admin/users/${user.id}/global-roles`, { roleId: delegateRole })).status).toBe(409);
    expect(await t.prisma.userGlobalRole.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('user access overview and audit', () => {
  it('shows global roles and project access of a user, and audits role changes without secrets', async () => {
    const { user, roleId: delegateRole } = await delegate('ops@example.com', ['users.read']);
    const filler = await roleId(t.prisma, 'FILLER');
    await admin.post(`/admin/projects/${project.id}/members`, { userId: user.id, roleId: filler });

    const res = await admin.get(`/admin/users/${user.id}/access`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: user.id, email: 'ops@example.com', isSystemAdmin: false },
      globalRoles: [{ id: delegateRole, isActive: true }],
      projects: [{ project: { id: project.id, code: 'A-001' }, role: { id: filler, code: 'FILLER' } }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt|token/i);

    const actions = (await t.prisma.auditLog.findMany({ where: { userId: adminId }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['CREATE_ROLE', 'UPDATE_ROLE_PERMISSIONS', 'GRANT_GLOBAL_ROLE', 'ADD_PROJECT_MEMBER']);
    expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toContain(TEST_PASSWORD);
  });
});
