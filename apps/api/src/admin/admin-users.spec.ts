import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createUser, resetDatabase, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
let adminId: string;

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
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
  adminId = (await createUser(t.prisma, { email: 'admin@example.com', name: 'Admin', isSystemAdmin: true })).id;
  admin = await loggedIn('admin@example.com');
});

describe('access control', () => {
  it('rejects non-system-admins and anonymous users on every admin endpoint', async () => {
    const target = await createUser(t.prisma, { email: 'biasa@example.com' });
    const user = await loggedIn('biasa@example.com');
    const anon = new Client(t.baseUrl);
    const calls: [string, string, unknown?][] = [
      ['GET', '/admin/users'],
      ['POST', '/admin/users', { name: 'X', email: 'x@example.com', password: 'password-123' }],
      ['GET', `/admin/users/${target.id}`],
      ['PATCH', `/admin/users/${target.id}`, { name: 'Y' }],
      ['POST', `/admin/users/${adminId}/deactivate`],
      ['POST', `/admin/users/${target.id}/grant-system-admin`],
      ['GET', '/admin/projects'],
    ];
    for (const [method, path, body] of calls) {
      expect((await user.request(method, path, body)).status, `${method} ${path}`).toBe(403);
      expect((await anon.request(method, path, body)).status, `${method} ${path}`).toBe(401);
    }
    expect(await t.prisma.user.count()).toBe(2);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isSystemAdmin).toBe(false);
  });

  it('applies a granted or revoked system admin flag on the next request of an existing session', async () => {
    const other = await createUser(t.prisma, { email: 'calon@example.com' });
    const c = await loggedIn('calon@example.com');
    expect((await c.get('/admin/users')).status).toBe(403);

    expect((await admin.post(`/admin/users/${other.id}/grant-system-admin`)).status).toBe(200);
    expect((await c.get('/admin/users')).status).toBe(200);

    expect((await admin.post(`/admin/users/${other.id}/revoke-system-admin`, { reason: 'rotasi' })).status).toBe(200);
    expect((await c.get('/admin/users')).status).toBe(403);
  });
});

describe('user management', () => {
  it('creates users with a normalized unique email and never returns secrets', async () => {
    const res = await admin.post('/admin/users', { name: ' Siti ', email: ' Siti@Example.COM ', password: 'password-awal-1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Siti', email: 'siti@example.com', isActive: true, isSystemAdmin: false });
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'isSystemAdmin', 'name', 'updatedAt']);

    const dup = await admin.post('/admin/users', { name: 'Lain', email: 'SITI@example.com', password: 'password-awal-2' });
    expect(dup.status).toBe(409);

    expect((await new Client(t.baseUrl).login('siti@example.com', 'password-awal-1')).status).toBe(200);
  });

  it('validates input', async () => {
    const res = await admin.post('/admin/users', { name: '', email: 'bukan-email', password: 'pendek' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('lists with search and pagination without password hashes', async () => {
    for (const name of ['Andi', 'Bayu', 'Citra', 'Dewi']) await createUser(t.prisma, { email: `${name.toLowerCase()}@proyek.id`, name });

    const page1 = await admin.get('/admin/users?search=proyek.id&page=1&pageSize=3');
    expect(page1.body.total).toBe(4);
    expect(page1.body.items.map((u: { name: string }) => u.name)).toEqual(['Andi', 'Bayu', 'Citra']);
    const page2 = await admin.get('/admin/users?search=proyek.id&page=2&pageSize=3');
    expect(page2.body.items.map((u: { name: string }) => u.name)).toEqual(['Dewi']);

    expect((await admin.get('/admin/users?search=CITRA')).body.total).toBe(1);
    expect(JSON.stringify(page1.body)).not.toMatch(/password|scrypt|token/i);
    expect((await admin.get('/admin/users?pageSize=500')).status).toBe(400);
  });

  it('updates name and email with an audit of old and new values', async () => {
    const u = await createUser(t.prisma, { email: 'lama@example.com', name: 'Lama' });
    const res = await admin.patch(`/admin/users/${u.id}`, { name: 'Baru', email: 'Baru@Example.com', reason: 'typo' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Baru', email: 'baru@example.com' });

    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE_USER' } });
    expect(audit).toMatchObject({
      userId: adminId,
      projectId: null,
      entityId: u.id,
      oldValue: { name: 'Lama', email: 'lama@example.com' },
      newValue: { name: 'Baru', email: 'baru@example.com' },
      reason: 'typo',
    });

    await createUser(t.prisma, { email: 'dipakai@example.com' });
    expect((await admin.patch(`/admin/users/${u.id}`, { email: 'dipakai@example.com' })).status).toBe(409);
  });

  it('deactivation revokes every session and blocks login; activation restores login', async () => {
    const u = await createUser(t.prisma, { email: 'budi@example.com' });
    const session = await loggedIn('budi@example.com');

    const res = await admin.post(`/admin/users/${u.id}/deactivate`, { reason: 'keluar proyek' });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect((await session.get('/auth/me')).status).toBe(401);
    expect(await t.prisma.authSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect((await new Client(t.baseUrl).login('budi@example.com', TEST_PASSWORD)).status).toBe(401);

    expect((await admin.post(`/admin/users/${u.id}/activate`)).status).toBe(200);
    expect((await new Client(t.baseUrl).login('budi@example.com', TEST_PASSWORD)).status).toBe(200);

    const actions = (await t.prisma.auditLog.findMany({ where: { entityId: u.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['DEACTIVATE_USER', 'REVOKE_SESSIONS', 'ACTIVATE_USER']);
  });
});

describe('last active system admin', () => {
  it('cannot deactivate or revoke the only active system admin', async () => {
    expect((await admin.post(`/admin/users/${adminId}/deactivate`)).status).toBe(409);
    expect((await admin.post(`/admin/users/${adminId}/revoke-system-admin`)).status).toBe(409);
    expect(await t.prisma.user.count({ where: { isSystemAdmin: true, isActive: true } })).toBe(1);
  });

  it('an inactive admin does not count as a remaining active admin', async () => {
    await createUser(t.prisma, { email: 'admin2@example.com', isSystemAdmin: true, isActive: false });
    expect((await admin.post(`/admin/users/${adminId}/revoke-system-admin`)).status).toBe(409);
  });

  it('allows removing one of two admins', async () => {
    const second = await createUser(t.prisma, { email: 'admin2@example.com', isSystemAdmin: true });
    expect((await admin.post(`/admin/users/${second.id}/revoke-system-admin`)).status).toBe(200);
    expect((await admin.post(`/admin/users/${adminId}/revoke-system-admin`)).status).toBe(409);
  });

  it.each([
    ['deactivate', 'deactivate'],
    ['revoke-system-admin', 'revoke-system-admin'],
    ['deactivate', 'revoke-system-admin'],
  ])('keeps one active admin when %s and %s race on the last two admins', async (first, second) => {
    const admin2 = await createUser(t.prisma, { email: 'admin2@example.com', isSystemAdmin: true });
    const other = await loggedIn('admin2@example.com');

    const results = await Promise.all([
      admin.post(`/admin/users/${admin2.id}/${first}`),
      other.post(`/admin/users/${adminId}/${second}`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await t.prisma.user.count({ where: { isSystemAdmin: true, isActive: true } })).toBe(1);
  });
});

describe('audit', () => {
  it('records user lifecycle actions with actor and without secrets', async () => {
    const created = await admin.post('/admin/users', { name: 'Rahasia', email: 'r@example.com', password: 'super-rahasia-99' });
    const id = created.body.id as string;
    const userSession = await new Client(t.baseUrl).login('r@example.com', 'super-rahasia-99');
    await admin.patch(`/admin/users/${id}`, { name: 'Rahasia 2' });
    await admin.post(`/admin/users/${id}/grant-system-admin`);
    await admin.post(`/admin/users/${id}/revoke-system-admin`);
    await admin.post(`/admin/users/${id}/deactivate`);

    const audit = await t.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual([
      'CREATE_USER',
      'UPDATE_USER',
      'GRANT_SYSTEM_ADMIN',
      'REVOKE_SYSTEM_ADMIN',
      'DEACTIVATE_USER',
      'REVOKE_SESSIONS',
    ]);
    expect(audit.every((a) => a.userId === adminId && a.projectId === null)).toBe(true);

    const hash = (await t.prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash;
    const token = userSession.setCookie[0]!.split(';')[0]!.split('=')[1]!;
    const dump = JSON.stringify(await t.prisma.auditLog.findMany());
    for (const secret of ['super-rahasia-99', TEST_PASSWORD, hash, token, 'scrypt$']) expect(dump).not.toContain(secret);
  });
});
