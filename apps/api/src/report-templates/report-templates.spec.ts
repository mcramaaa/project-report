import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultReportTemplate } from '@laporan-proyek/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { storageRoot } from '../documents/documents.service';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
}
async function ok(res: Promise<ApiResponse>, status = 200) {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
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

describe('report templates (D-082)', () => {
  it('starts from the office defaults, saves a custom layout, keeps unknown keys out and new ones in', async () => {
    const p = await createProject(t.prisma, 'TPL-001');
    const base = `/projects/${p.id}/report-templates`;
    const first = await ok(admin.get(base));
    expect(first.templates.map((x: { reportType: string; updatedAt: string | null }) => [x.reportType, x.updatedAt])).toEqual([
      ['DAILY', null],
      ['WEEKLY', null],
      ['MONTHLY', null],
    ]);
    expect(first.templates[0].config).toMatchObject({ title: 'LAPORAN HARIAN', layout: 'columns' }); // D-084 office format

    const config = defaultReportTemplate('DAILY');
    config.header.lines = ['PEMERINTAH KOTA DENPASAR', 'DINAS PENDIDIKAN KEPEMUDAAN DAN OLAHRAGA'];
    config.sections = [{ ...config.sections[4]!, title: 'KEADAAN CUACA' }, { key: 'bogus', title: 'X', visible: true, columns: [] }, ...config.sections.slice(0, 2)];
    config.signatures[0]!.name = 'I Nyoman Suriawan, ST.';
    const saved = await ok(admin.request('PUT', `${base}/DAILY`, config));
    const daily = saved.templates[0].config;
    expect(daily.header.lines).toHaveLength(2);
    // Saved order first, unknown dropped, missing sections appended.
    expect(daily.sections.map((s: { key: string }) => s.key)).toEqual(['weather', 'labor', 'equipment', 'materials', 'work', 'note']);
    expect(daily.sections[0].title).toBe('KEADAAN CUACA');
    expect(saved.templates[0].updatedBy.name).toBe('Super');

    expect((await admin.request('PUT', `${base}/YEARLY`, config)).status).toBe(404);
    expect((await admin.request('PUT', `${base}/DAILY`, { ...config, page: { ...config.page, size: 'A0' } })).status).toBe(400);

    const filler = await createUser(t.prisma, { email: 'filler@example.com' });
    await t.prisma.projectUser.create({ data: { projectId: p.id, userId: filler.id, roleId: await roleId(t.prisma, 'FILLER') } });
    const f = await loggedIn('filler@example.com');
    expect((await f.get(base)).status).toBe(200);
    expect((await f.request('PUT', `${base}/DAILY`, config)).status).toBe(403);
  });

  it('stores logos privately, replaces files, and imports templates and logos from a readable project', async () => {
    const src = await createProject(t.prisma, 'TPL-SRC');
    const dst = await createProject(t.prisma, 'TPL-DST');
    const sbase = `/projects/${src.id}/report-templates`;
    const dbase = `/projects/${dst.id}/report-templates`;
    expect((await admin.upload(`${sbase}/logos/AGENCY`, [{ name: 'x.png', data: Buffer.from('nope') }])).status).toBe(400);
    expect((await admin.upload(`${sbase}/logos/OTHER`, [{ name: 'x.png', data: PNG }])).status).toBe(404);
    await ok(admin.upload(`${sbase}/logos/AGENCY`, [{ name: 'a.png', data: PNG }]), 201);
    await ok(admin.upload(`${sbase}/logos/AGENCY`, [{ name: 'b.png', data: PNG }]), 201);
    expect(readdirSync(join(storageRoot(), 'projects', src.id, 'logos'))).toHaveLength(1);
    const img = await fetch(`${t.baseUrl}${sbase}/logos/AGENCY`, { headers: { cookie: admin.cookie! } });
    expect(img.headers.get('content-type')).toBe('image/png');

    const weekly = defaultReportTemplate('WEEKLY');
    weekly.title = 'LAPORAN MINGGUAN PROYEK';
    await ok(admin.request('PUT', `${sbase}/WEEKLY`, weekly));

    expect((await admin.post(`${dbase}/import`, { sourceProjectId: dst.id })).status).toBe(400);
    const imported = await ok(admin.post(`${dbase}/import`, { sourceProjectId: src.id, includeLogos: true }), 201);
    expect(imported.templates[1].config.title).toBe('LAPORAN MINGGUAN PROYEK');
    expect(imported.templates[0].updatedAt).toBeNull(); // the source has no saved daily template
    expect(imported.logos.map((l: { kind: string }) => l.kind)).toEqual(['AGENCY']);
    expect(readdirSync(join(storageRoot(), 'projects', dst.id, 'logos'))).toHaveLength(1);

    // A user who cannot read the source project gets "not found".
    const m = await createUser(t.prisma, { email: 'manager@example.com' });
    await t.prisma.projectUser.create({ data: { projectId: dst.id, userId: m.id, roleId: await roleId(t.prisma, 'MANAGER') } });
    expect((await (await loggedIn('manager@example.com')).post(`${dbase}/import`, { sourceProjectId: src.id })).status).toBe(404);

    await ok(admin.request('DELETE', `${dbase}/logos/AGENCY`));
    expect(readdirSync(join(storageRoot(), 'projects', dst.id, 'logos'))).toHaveLength(0);
    const audit = await t.prisma.auditLog.findMany({ where: { entityType: 'REPORT_TEMPLATE' }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(['UPLOAD_REPORT_LOGO', 'UPLOAD_REPORT_LOGO', 'UPDATE_REPORT_TEMPLATE', 'IMPORT_REPORT_TEMPLATES', 'REMOVE_REPORT_LOGO']);
  });
});
