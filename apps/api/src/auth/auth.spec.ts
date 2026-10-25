import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_FAILED_MESSAGE } from '@laporan-proyek/shared';
import { createUser, resetDatabase, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';
import { LoginRateLimiter } from './login-rate-limiter';
import { hashSessionToken } from './session-token';

let t: TestApp;
const client = () => new Client(t.baseUrl);

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  // Fresh limiter state per test.
  Object.assign(t.app.get(LoginRateLimiter), new LoginRateLimiter());
});

describe('login', () => {
  it('succeeds with correct credentials, sets a hardened cookie, and stores only the token hash', async () => {
    await createUser(t.prisma, { email: 'budi@example.com', name: 'Budi' });
    const c = client();
    const res = await c.login('  BUDI@Example.com ', TEST_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: expect.any(String), name: 'Budi', email: 'budi@example.com', isSystemAdmin: false, permissions: [] });
    const cookie = res.setCookie.find((v) => v.startsWith('lp_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // APP_URL is http in tests

    const token = c.cookie!.split('=')[1]!;
    const sessions = await t.prisma.authSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashSessionToken(decodeURIComponent(token)));
    expect(JSON.stringify(sessions)).not.toContain(token);

    expect((await c.get('/auth/me')).body.email).toBe('budi@example.com');
  });

  it('gives the same answer for wrong password, unknown email, and inactive user', async () => {
    await createUser(t.prisma, { email: 'aktif@example.com' });
    await createUser(t.prisma, { email: 'nonaktif@example.com', isActive: false });

    const results = await Promise.all([
      client().login('aktif@example.com', 'password-salah'),
      client().login('tidak-ada@example.com', TEST_PASSWORD),
      client().login('nonaktif@example.com', TEST_PASSWORD),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe(LOGIN_FAILED_MESSAGE);
      expect(res.setCookie).toHaveLength(0);
    }
    expect(await t.prisma.authSession.count()).toBe(0);
  });

  it('rate-limits repeated failures for an email, even with the right password afterwards', async () => {
    await createUser(t.prisma, { email: 'budi@example.com' });
    for (let i = 0; i < 5; i++) expect((await client().login('budi@example.com', 'salah-salah')).status).toBe(401);
    const blocked = await client().login('budi@example.com', TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.setCookie).toHaveLength(0);
  });

  it('rejects mutating requests without the app Origin (CSRF)', async () => {
    await createUser(t.prisma, { email: 'budi@example.com' });
    const noOrigin = await client().request('POST', '/auth/login', { email: 'budi@example.com', password: TEST_PASSWORD }, { origin: null });
    const evil = await client().request('POST', '/auth/login', { email: 'budi@example.com', password: TEST_PASSWORD }, { origin: 'https://evil.example' });
    expect(noOrigin.status).toBe(403);
    expect(evil.status).toBe(403);
    expect(await t.prisma.authSession.count()).toBe(0);
  });
});

describe('session', () => {
  it('requires a session for protected routes', async () => {
    expect((await client().get('/auth/me')).status).toBe(401);
    const forged = client();
    forged.cookie = 'lp_session=forged-token';
    expect((await forged.get('/auth/me')).status).toBe(401);
  });

  it('logout revokes the session and the old cookie stops working', async () => {
    await createUser(t.prisma, { email: 'budi@example.com' });
    const c = client();
    await c.login('budi@example.com', TEST_PASSWORD);
    const stolen = c.cookie;

    expect((await c.post('/auth/logout')).status).toBe(204);
    expect(c.cookie).toBeUndefined();

    const replay = client();
    replay.cookie = stolen;
    expect((await replay.get('/auth/me')).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    await createUser(t.prisma, { email: 'budi@example.com' });
    const c = client();
    await c.login('budi@example.com', TEST_PASSWORD);
    await t.prisma.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('rejects revoked sessions and sessions of users deactivated afterwards', async () => {
    const revokedUser = await createUser(t.prisma, { email: 'a@example.com' });
    const deactivatedUser = await createUser(t.prisma, { email: 'b@example.com' });
    const a = client();
    const b = client();
    await a.login('a@example.com', TEST_PASSWORD);
    await b.login('b@example.com', TEST_PASSWORD);

    await t.prisma.authSession.updateMany({ where: { userId: revokedUser.id }, data: { revokedAt: new Date() } });
    await t.prisma.user.update({ where: { id: deactivatedUser.id }, data: { isActive: false } });

    expect((await a.get('/auth/me')).status).toBe(401);
    expect((await b.get('/auth/me')).status).toBe(401);
  });
});

describe('change password', () => {
  it('requires the current password', async () => {
    await createUser(t.prisma, { email: 'budi@example.com' });
    const c = client();
    await c.login('budi@example.com', TEST_PASSWORD);
    const res = await c.post('/auth/change-password', { currentPassword: 'bukan-ini', newPassword: 'password-baru-123' });
    expect(res.status).toBe(400);
    expect((await c.get('/auth/me')).status).toBe(200);
  });

  it('validates the new password policy', async () => {
    await createUser(t.prisma, { email: 'budi@example.com' });
    const c = client();
    await c.login('budi@example.com', TEST_PASSWORD);
    const res = await c.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'pendek' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('newPassword');
  });

  it('revokes all sessions, rejects the old password, and accepts the new one', async () => {
    const user = await createUser(t.prisma, { email: 'budi@example.com' });
    const laptop = client();
    const phone = client();
    await laptop.login('budi@example.com', TEST_PASSWORD);
    await phone.login('budi@example.com', TEST_PASSWORD);

    const res = await laptop.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'password-baru-123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reloginRequired: true });
    expect(laptop.cookie).toBeUndefined();

    expect((await phone.get('/auth/me')).status).toBe(401);
    expect((await client().login('budi@example.com', TEST_PASSWORD)).status).toBe(401);
    expect((await client().login('budi@example.com', 'password-baru-123')).status).toBe(200);

    const audit = await t.prisma.auditLog.findMany({ where: { entityId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['CHANGE_PASSWORD', 'REVOKE_SESSIONS']);
    expect(audit[1]!.newValue).toEqual({ revokedCount: 2, cause: 'CHANGE_PASSWORD' });
    const dump = JSON.stringify(audit);
    expect(dump).not.toContain(TEST_PASSWORD);
    expect(dump).not.toContain('password-baru-123');
  });
});
