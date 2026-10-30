import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

// Project: start Monday 2026-01-05, 120 days → 18 weeks, all started. Kontrak: Galian 100 m3, Urugan 50 m3.
let t: TestApp;
let admin: Client;
let project: { id: string };
let rab: string;
let base: string;
let galian: string;
let urugan: string;

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

type Row = { id: string; description: string; workItemId: string | null };
const workItemOf = (rows: Row[], description: string) => rows.find((r) => r.description === description)!.workItemId!;
const save = (week: number, entries: Record<string, unknown>[], c: Client = admin) => c.request('PUT', `${base}/${week}`, { entries });

/** Approved Kontrak activated from the project start. */
async function contractBaseline() {
  const id = (await ok(admin.post(rab, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
  await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Galian', volume: '100', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201);
  const rows = (await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Urugan', volume: '50', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201)).rows as Row[];
  await ok(admin.post(`${rab}/${id}/approve`, { acknowledgeWarnings: true }));
  await ok(admin.post(`/projects/${project.id}/baselines`, { rabVersionId: id, activationMode: 'EXACT_DATE' }), 201);
  galian = workItemOf(rows, 'Galian');
  urugan = workItemOf(rows, 'Urugan');
  return id;
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
  project = await createProject(t.prisma, 'PRG-001');
  await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 120));
  rab = `/projects/${project.id}/rab-versions`;
  base = `/projects/${project.id}/progress/weeks`;
});

describe('weekly progress (D-073)', () => {
  it('stores volume as the fact in both input modes and computes cumulative, percent and remaining', async () => {
    expect((await save(1, [{ workItemId: '01a00000-0000-7000-8000-000000000000', mode: 'VOLUME_WEEK', volume: '1' }])).status).toBe(409); // no baseline yet
    await contractBaseline();
    await ok(save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '30', note: 'Galian zona A' }]));
    const week2 = await ok(save(2, [{ workItemId: galian, mode: 'PERCENT_CUMULATIVE', percentage: '45' }]));
    const row = week2.rows.find((r: Row) => r.workItemId === galian);
    expect(row).toMatchObject({
      baselineVolume: '100',
      trackable: true,
      previousCumulative: '30',
      thisWeek: { volume: '15', mode: 'PERCENT_CUMULATIVE', percentage: '45', updatedBy: { name: 'Super' } },
      cumulative: '45',
      percent: '45',
      remaining: '55',
    });
    expect(week2.week).toMatchObject({ weekNumber: 2, baseline: { label: 'Kontrak' }, open: true, filledCount: 1 });

    const stored = await t.prisma.weeklyProgress.findMany({ orderBy: { actualVolume: 'desc' } });
    expect(stored.map((p) => p.actualVolume.toString())).toEqual(['30', '15']);
    const audit = await t.prisma.auditLog.findMany({ where: { action: 'UPDATE_WEEKLY_PROGRESS' } });
    expect(audit).toHaveLength(2);

    // Saving the same values again changes nothing and writes no audit.
    await ok(save(2, [{ workItemId: galian, mode: 'PERCENT_CUMULATIVE', percentage: '45' }]));
    expect(await t.prisma.auditLog.count({ where: { action: 'UPDATE_WEEKLY_PROGRESS' } })).toBe(2);

    const weeks = await ok(admin.get(base));
    expect(weeks).toHaveLength(18);
    expect(weeks.slice(0, 3).map((w: { filledCount: number }) => w.filledCount)).toEqual([1, 1, 0]);
  });

  it('keeps cumulative within the baseline, including later weeks that an earlier edit pushes up', async () => {
    await contractBaseline();
    const over = await save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '100.000000000001' }]);
    expect(over.status).toBe(400);
    expect(over.body.errors).toEqual([expect.stringContaining('melebihi volume baseline 100')]);
    expect((await save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '-1' }])).status).toBe(400);

    await ok(save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '40' }]));
    await ok(save(3, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '60' }]));
    const pushed = await save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '41' }]);
    expect(pushed.status).toBe(400);
    expect(pushed.body.errors).toEqual([expect.stringContaining('kumulatif minggu 3 menjadi 101')]);
    await ok(save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '10' }])); // lowering is always allowed

    const below = await save(4, [{ workItemId: galian, mode: 'PERCENT_CUMULATIVE', percentage: '50' }]);
    expect(below.body.errors).toEqual([expect.stringContaining('lebih kecil dari kumulatif sampai minggu lalu (70)')]);
    // One bad entry rejects the whole save.
    expect((await save(4, [{ workItemId: urugan, mode: 'VOLUME_WEEK', volume: '5' }, { workItemId: galian, mode: 'VOLUME_WEEK', volume: '31' }])).status).toBe(400);
    expect(await t.prisma.weeklyProgress.count({ where: { workItemId: urugan } })).toBe(0);
  });

  it('refuses weeks that have not started', async () => {
    await contractBaseline();
    await t.prisma.project.update({ where: { id: project.id }, data: { startDate: new Date('2099-01-05') } });
    await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2099-01-05', 120));
    await t.prisma.baselineAssignment.updateMany({ data: { effectiveFrom: new Date('2099-01-05') } });
    const res = await save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '1' }]);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('belum dimulai');
    expect((await ok(admin.get(base)))[0].open).toBe(false);
  });

  it('FILLER and MANAGER input; REVIEWER only reads', async () => {
    await contractBaseline();
    for (const [email, role] of [
      ['filler@example.com', 'FILLER'],
      ['reviewer@example.com', 'REVIEWER'],
    ] as const) {
      const u = await createUser(t.prisma, { email });
      await t.prisma.projectUser.create({ data: { projectId: project.id, userId: u.id, roleId: await roleId(t.prisma, role) } });
    }
    const filler = await loggedIn('filler@example.com');
    const reviewer = await loggedIn('reviewer@example.com');
    await ok(save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '5' }], filler));
    expect((await save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '6' }], reviewer)).status).toBe(403);
    await ok(reviewer.get(`${base}/1`));
  });

  it('a smaller baseline needs confirmation; old progress stays, over 100% and removed items are read-only', async () => {
    const contract = await contractBaseline();
    await ok(save(1, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '90' }]));
    await ok(save(2, [{ workItemId: urugan, mode: 'VOLUME_WEEK', volume: '10' }]));

    // MC-0: Galian 80 m3, Urugan removed.
    const mc0 = (await ok(admin.post(rab, { versionType: 'MC', revisionNumber: 0, documentDate: '2026-01-20' }), 201)) as { version: { id: string }; rows: (Row & { id: string })[] };
    const v = `${rab}/${mc0.version.id}`;
    await ok(admin.patch(`${v}/items/${mc0.rows.find((r) => r.description === 'Galian')!.id}`, { volume: '80' }));
    await ok(admin.delete(`${v}/items/${mc0.rows.find((r) => r.description === 'Urugan')!.id}`));
    await ok(admin.post(`${v}/approve`, { acknowledgeWarnings: true }));
    expect(contract).not.toBe(mc0.version.id);

    const activate = { rabVersionId: mc0.version.id, activationMode: 'EXACT_DATE', effectiveFrom: '2026-02-02' }; // week 5
    const refused = await admin.post(`/projects/${project.id}/baselines`, activate);
    expect(refused.status).toBe(409);
    expect(refused.body.warnings.map((w: { reported: string; newVolume: string }) => [w.reported, w.newVolume]).sort()).toEqual([
      ['10', '0'],
      ['90', '80'],
    ]);
    await ok(admin.post(`/projects/${project.id}/baselines`, { ...activate, acknowledgeWarnings: true }), 201);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'ACTIVATE_BASELINE' }, orderBy: { createdAt: 'desc' } });
    expect((audit.newValue as { acknowledgedWarnings: unknown[] }).acknowledgedWarnings).toHaveLength(2);

    const week5 = await ok(admin.get(`${base}/5`));
    expect(week5.week.baseline.label).toBe('MC-0');
    expect(week5.rows.find((r: Row) => r.workItemId === galian)).toMatchObject({ baselineVolume: '80', cumulative: '90', percent: '112.5', remaining: '-10', trackable: true });
    expect(week5.rows.find((r: Row) => r.workItemId === urugan)).toMatchObject({ trackable: false, cumulative: '10', baselineVolume: null });
    expect((await save(5, [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '1' }])).status).toBe(400);
    expect((await save(5, [{ workItemId: urugan, mode: 'VOLUME_WEEK', volume: '1' }])).body.errors).toEqual([expect.stringContaining('tidak trackable')]);
    expect(await t.prisma.weeklyProgress.count()).toBe(2); // nothing lost
  });
});
