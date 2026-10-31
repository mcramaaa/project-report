import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { storageRoot } from '../documents/documents.service';
import { createUser, resetDatabase, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

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
  await createUser(t.prisma, { email: 'admin@example.com', name: 'Super', isSystemAdmin: true });
  admin = await loggedIn('admin@example.com');
});

describe('workers (D-080)', () => {
  it('creates with a unique 16-digit NIK, masks it for plain users, and keeps KTP files private', async () => {
    expect((await admin.post('/workers', { name: 'Budi', position: 'Tukang Batu', nik: '1234' })).status).toBe(400);
    const created = await admin.post('/workers', { name: 'Budi', position: 'Tukang Batu', nik: '3578 0101 0101 0001' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ nik: '3578010101010001', hasKtp: false, isActive: true });
    const dup = await admin.post('/workers', { name: 'Lain', position: 'Mandor', nik: '3578010101010001' });
    expect(dup.status).toBe(409);
    const id = created.body.id as string;

    expect((await admin.upload(`/workers/${id}/ktp`, [{ name: 'ktp.png', data: Buffer.from('not an image') }])).status).toBe(400);
    expect((await admin.upload(`/workers/${id}/ktp`, [{ name: 'ktp.png', data: PNG }])).body).toMatchObject({ hasKtp: true });
    expect((await admin.upload(`/workers/${id}/ktp`, [{ name: 'ktp2.png', data: PNG }])).status).toBe(201);
    expect(readdirSync(join(storageRoot(), 'workers'))).toHaveLength(1); // replaced file removed
    const ktp = await fetch(`${t.baseUrl}/workers/${id}/ktp`, { headers: { cookie: admin.cookie! } });
    expect(ktp.status).toBe(200);
    expect(ktp.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await ktp.arrayBuffer())).toEqual(PNG);

    await createUser(t.prisma, { email: 'biasa@example.com' });
    const plain = await loggedIn('biasa@example.com');
    const list = await plain.get('/workers');
    expect(list.body.items).toEqual([expect.objectContaining({ name: 'Budi', nik: '3578••••••••0001', hasKtp: true })]);
    expect((await plain.get('/workers?search=0101')).body.items).toHaveLength(0); // no NIK search without the permission
    expect((await plain.get(`/workers/${id}/ktp`)).status).toBe(403);
    expect((await plain.post('/workers', { name: 'X', position: 'Y', nik: '3578010101010002' })).status).toBe(403);
    expect((await plain.request('PATCH', `/workers/${id}`, { isActive: false })).status).toBe(403);

    expect((await admin.request('PATCH', `/workers/${id}`, { isActive: false })).body).toMatchObject({ isActive: false });
    expect((await admin.get('/workers')).body.items).toHaveLength(0);
    expect((await admin.get('/workers?active=all&search=0101')).body.items).toHaveLength(1);
    expect((await admin.request('DELETE', `/workers/${id}/ktp`)).body).toMatchObject({ hasKtp: false });
    expect(readdirSync(join(storageRoot(), 'workers'))).toHaveLength(0);

    const audit = await t.prisma.auditLog.findMany({ where: { entityType: 'WORKER' }, select: { action: true, newValue: true } });
    expect(audit.map((a) => a.action)).toEqual(['CREATE_WORKER', 'UPLOAD_WORKER_KTP', 'UPLOAD_WORKER_KTP', 'UPDATE_WORKER', 'REMOVE_WORKER_KTP']);
    expect(JSON.stringify(audit)).not.toContain('3578010101010001');
  });
});
