import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

// Project from Monday 2026-01-05, 120 days, all in the past. Kontrak: Galian 100 m3; week 1 progress 70 m3 by the admin.
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
async function member(email: string, role: string) {
  const u = await createUser(t.prisma, { email });
  await t.prisma.projectUser.create({ data: { projectId: project.id, userId: u.id, roleId: await roleId(t.prisma, role) } });
  return loggedIn(email);
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
  project = await createProject(t.prisma, 'WKL-001');
  await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 120));
  const rab = `/projects/${project.id}/rab-versions`;
  const id = (await ok(admin.post(rab, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
  const rows = (await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Galian', volume: '100', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201)).rows as { description: string; workItemId: string }[];
  galian = rows.find((r) => r.description === 'Galian')!.workItemId;
  await ok(admin.post(`${rab}/${id}/approve`, { acknowledgeWarnings: true }));
  await ok(admin.post(`/projects/${project.id}/baselines`, { rabVersionId: id, activationMode: 'EXACT_DATE' }), 201);
  await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '70' }] }));
  base = `/projects/${project.id}/weekly-reports`;
});

describe('weekly reports (D-081)', () => {
  it('submit → review by someone else → final snapshot; final locks the week and earlier ones until reopened', async () => {
    const live = await ok(admin.get(`${base}/1`));
    expect(live).toMatchObject({ report: null, fromSnapshot: false, summary: { status: null, ended: true } });
    expect(live.content.totals).toMatchObject({ actualCumulative: '70', usedDays: 7, durationDays: 120, remainingDays: 113 });
    expect(live.content.items.find((r: { workItemId: string }) => r.workItemId === galian).thisWeek.volume).toBe('70');
    expect(live.enteredBy).toEqual([expect.objectContaining({ name: 'Super' })]);
    expect(live.issues.errors).toEqual([]);
    expect(live.issues.warnings[0]).toMatch(/Jadwal versi baseline belum approved/);

    expect((await admin.post(`${base}/1/review`, {})).status).toBe(404); // not submitted
    await ok(admin.post(`${base}/1/submit`, {}));
    expect((await admin.post(`${base}/1/submit`, {})).status).toBe(409);
    // The admin entered week 1, so even a super admin may not review it.
    expect((await admin.post(`${base}/1/review`, { acknowledgeWarnings: true })).status).toBe(403);

    const reviewer = await member('reviewer@example.com', 'REVIEWER');
    expect((await reviewer.post(`${base}/1/review`, {})).status).toBe(409); // warnings need acknowledging
    const reviewed = await ok(reviewer.post(`${base}/1/review`, { note: 'Sesuai lapangan', acknowledgeWarnings: true }));
    expect(reviewed.report).toMatchObject({ status: 'REVIEWED', reviewedBy: { name: expect.any(String) }, reviewNote: 'Sesuai lapangan' });
    expect((await reviewer.post(`${base}/1/finalize`, { acknowledgeWarnings: true })).status).toBe(403); // REVIEWER cannot finalize

    const final = await ok(admin.post(`${base}/1/finalize`, { acknowledgeWarnings: true }));
    expect(final).toMatchObject({ fromSnapshot: true, report: { status: 'FINAL' }, content: { totals: { actualCumulative: '70' } } });

    // Locked: week 1 progress, its daily allocation and daily reports.
    const progress = `/projects/${project.id}/progress/weeks/1`;
    expect((await admin.request('PUT', progress, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '60' }] })).status).toBe(409);
    expect((await ok(admin.get(progress))).week).toMatchObject({ locked: true, open: false });
    expect((await admin.request('PUT', `/projects/${project.id}/daily-reports/2026-01-06`, { baseUpdatedAt: null, resources: [], weather: [] })).status).toBe(409);
    expect(await ok(admin.get(`/projects/${project.id}/daily-reports/2026-01-06`))).toMatchObject({ locked: true, open: false });
    // Changing the baseline of a final week is refused too.
    const assignment = (await ok(admin.get(`/projects/${project.id}/baselines`))).assignments[0].id;
    expect((await admin.post(`/projects/${project.id}/baselines/${assignment}/revoke`, { reason: 'uji' })).status).toBe(409);
    // Week 2 is not covered.
    await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/2`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '10' }] }));
    // The snapshot does not follow later data.
    expect((await ok(admin.get(`${base}/1`))).content.items.find((r: { workItemId: string }) => r.workItemId === galian).cumulative).toBe('70');

    expect((await reviewer.post(`${base}/1/reopen`, { reason: 'x' })).status).toBe(403);
    expect((await admin.post(`${base}/1/reopen`, {})).status).toBe(400);
    const reopened = await ok(admin.post(`${base}/1/reopen`, { reason: 'Volume galian dikoreksi' }));
    expect(reopened).toMatchObject({ fromSnapshot: false, report: { status: 'REOPENED' } });
    await ok(admin.request('PUT', progress, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '60' }] }));
    expect(await t.prisma.weeklyReportSnapshot.count()).toBe(1); // kept after reopen

    const audit = await t.prisma.auditLog.findMany({ where: { entityType: 'WEEKLY_REPORT' }, orderBy: { createdAt: 'asc' }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(['SUBMIT_WEEKLY_REPORT', 'REVIEW_WEEKLY_REPORT', 'FINALIZE_WEEKLY_REPORT', 'REOPEN_WEEKLY_REPORT']);
  });

  it('a later final week locks earlier weeks and must be reopened first; filler can submit but not review', async () => {
    const filler = await member('filler@example.com', 'FILLER');
    const reviewer = await member('reviewer@example.com', 'REVIEWER');
    for (const n of [1, 2]) {
      await ok(filler.post(`${base}/${n}/submit`, {}));
      expect((await filler.post(`${base}/${n}/review`, { acknowledgeWarnings: true })).status).toBe(403);
      await ok(reviewer.post(`${base}/${n}/review`, { acknowledgeWarnings: true }));
    }
    await ok(admin.post(`${base}/2/finalize`, { acknowledgeWarnings: true }));
    // Week 1 is not final itself but sits under week 2's cumulative.
    expect((await admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '50' }] })).status).toBe(409);
    await ok(admin.post(`${base}/1/finalize`, { acknowledgeWarnings: true }));
    expect((await admin.post(`${base}/1/reopen`, { reason: 'koreksi' })).status).toBe(409);
    await ok(admin.post(`${base}/2/reopen`, { reason: 'koreksi' }));
    await ok(admin.post(`${base}/1/reopen`, { reason: 'koreksi' }));
    const list = await ok(admin.get(base));
    expect(list.slice(0, 3).map((w: { status: string | null }) => w.status)).toEqual(['REOPENED', 'REOPENED', null]);
  });

  it('monthly B.n sums its four weeks (D-087)', async () => {
    const progress = (n: number, volume: string) =>
      ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/${n}`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume }] }));
    await progress(3, '5');
    await progress(5, '10'); // B2, so outside B1
    const m = await ok(admin.get(`/projects/${project.id}/monthly-reports/1`));
    expect(m.weeks.map((w: { weekNumber: number }) => w.weekNumber)).toEqual([1, 2, 3, 4]);
    expect(m.content.week).toEqual({ weekNumber: 1, startDate: '2026-01-05', endDate: '2026-02-01' });
    const item = m.content.items.find((r: { workItemId: string }) => r.workItemId === galian);
    expect(item).toMatchObject({ previousCumulative: '0', cumulative: '75', thisWeek: { volume: '75' } });
    expect(m.content.daily.days).toHaveLength(28);
    const b2 = await ok(admin.get(`/projects/${project.id}/monthly-reports/2`));
    expect(b2.content.items.find((r: { workItemId: string }) => r.workItemId === galian)).toMatchObject({ previousCumulative: '75', cumulative: '85', thisWeek: { volume: '10' } });
    expect((await admin.get(`/projects/${project.id}/monthly-reports/99`)).status).toBe(404);
    const xlsx = await fetch(`${t.baseUrl}/projects/${project.id}/exports/monthly/1`, { headers: { cookie: admin.cookie! } });
    expect(xlsx.status).toBe(200);
    expect(decodeURIComponent(xlsx.headers.get('content-disposition')!)).toContain('B.1.xlsx');
  });
});
