import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

// Project from Monday 2026-01-05, 120 days, all dates in the past. Kontrak: Galian 100 m3 (no AHSP).
let t: TestApp;
let admin: Client;
let project: { id: string };
let base: string;
let galian: string;

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
  project = await createProject(t.prisma, 'DLY-001');
  await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 120));
  const rab = `/projects/${project.id}/rab-versions`;
  const id = (await ok(admin.post(rab, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
  const rows = (await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Galian', volume: '100', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201)).rows as { description: string; workItemId: string }[];
  galian = rows.find((r) => r.description === 'Galian')!.workItemId;
  await ok(admin.post(`${rab}/${id}/approve`, { acknowledgeWarnings: true }));
  await ok(admin.post(`/projects/${project.id}/baselines`, { rabVersionId: id, activationMode: 'EXACT_DATE' }), 201);
  await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '70' }] }));
  base = `/projects/${project.id}/daily-reports`;
});

describe('daily reports (D-079)', () => {
  it('shows the day work from the allocation, saves lines, finalizes with warnings acknowledged, freezes, and reopens with a reason', async () => {
    const empty = await ok(admin.get(`${base}/2026-01-06`));
    expect(empty).toMatchObject({ day: 2, report: null, open: true, week: { weekNumber: 1 } });
    expect(empty.work).toEqual([expect.objectContaining({ workItemId: galian, volume: '12', method: 'DAILY_FACTOR' })]); // 70 × 1.20 / 7
    expect(empty.issues.warnings).toEqual(['Tenaga kerja belum diisi.', 'Cuaca belum diisi.']);
    expect((await admin.post(`${base}/2026-01-06/finalize`, {})).status).toBe(409); // not saved yet

    const body = {
      note: 'Galian zona A',
      resources: [
        { category: 'LABOR', name: 'Mandor', unit: 'Org', actual: '1' },
        { category: 'LABOR', name: 'Pekerja', unit: 'Org', actual: '8' },
        { category: 'EQUIPMENT', name: 'Cangkul', unit: 'bh', actual: '3' },
      ],
      weather: [{ condition: 'CLEAR', fromTime: '08:00', toTime: '17:00' }],
    };
    expect((await admin.request('PUT', `${base}/2026-01-06`, { ...body, weather: [{ condition: 'RAIN', fromTime: '14:00', toTime: '13:00' }] })).status).toBe(400);
    const saved = await ok(admin.request('PUT', `${base}/2026-01-06`, body));
    expect(saved.report).toMatchObject({ status: 'DRAFT', createdBy: { name: 'Super' } });
    expect(saved.resources.map((r: { name: string; actual: string }) => [r.name, r.actual])).toEqual([
      ['Mandor', '1'],
      ['Pekerja', '8'],
      ['Cangkul', '3'],
    ]);
    expect(saved.issues.warnings).toEqual([]);

    const final = await ok(admin.post(`${base}/2026-01-06/finalize`, {}));
    expect(final.report).toMatchObject({ status: 'FINAL', finalizedBy: { name: 'Super' } });
    expect(final.work).toEqual([expect.objectContaining({ volume: '12', method: 'FINAL' })]);
    expect((await admin.request('PUT', `${base}/2026-01-06`, body)).status).toBe(409);

    // Frozen: a later change of the weekly progress does not change the final report.
    await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '35' }] }));
    expect((await ok(admin.get(`${base}/2026-01-06`))).work[0].volume).toBe('12');

    expect((await admin.post(`${base}/2026-01-06/reopen`, {})).status).toBe(400); // reason required
    const reopened = await ok(admin.post(`${base}/2026-01-06/reopen`, { reason: 'Volume galian dikoreksi' }));
    expect(reopened.report.status).toBe('REOPENED');
    expect(reopened.work[0].volume).toBe('6'); // live again: 35 × 1.20 / 7
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'REOPEN_DAILY_REPORT' } });
    expect(audit.reason).toBe('Volume galian dikoreksi');

    // The next day starts from the labor and hand-typed equipment of the previous report.
    const next = await ok(admin.get(`${base}/2026-01-07`));
    expect(next.prefilledFrom).toBe('2026-01-06');
    expect(next.resources.map((r: { name: string; id: string | null }) => [r.name, r.id])).toEqual([
      ['Mandor', null],
      ['Pekerja', null],
      ['Cangkul', null],
    ]);
    expect(next.laborOptions).toEqual(['Mandor', 'Pekerja']);

    const days = await ok(admin.get(`${base}/weeks/1`));
    expect(days.map((d: { status: string | null }) => d.status)).toEqual([null, 'REOPENED', null, null, null, null, null]);
  });

  it('needs progress.input to write and report.reopen to reopen; dates outside the project are 404', async () => {
    const u = await createUser(t.prisma, { email: 'filler@example.com' });
    await t.prisma.projectUser.create({ data: { projectId: project.id, userId: u.id, roleId: await roleId(t.prisma, 'FILLER') } });
    const filler = await loggedIn('filler@example.com');
    const body = { resources: [{ category: 'LABOR', name: 'Pekerja', actual: '2' }], weather: [{ condition: 'CLOUDY' }] };
    await ok(filler.request('PUT', `${base}/2026-01-05`, body));
    await ok(filler.post(`${base}/2026-01-05/finalize`, {}));
    expect((await filler.post(`${base}/2026-01-05/reopen`, { reason: 'x' })).status).toBe(403);
    expect((await admin.get(`${base}/2025-12-31`)).status).toBe(404);
    expect((await admin.get(`${base}/bukan-tanggal`)).status).toBe(404);
  });
});
