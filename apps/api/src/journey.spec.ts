import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './auth/login-rate-limiter';
import { createUser, resetDatabase, roleId, TEST_PASSWORD } from './test/db';
import { Client, startApp, type ApiResponse, type TestApp } from './test/http';

/**
 * One project through every step a team takes, each step using what the previous one produced:
 * project → RAB Kontrak → baseline → schedule → weekly progress → daily allocation → daily report →
 * weekly report (submit, review by someone else, final) → lock → MC-0 → baseline from the next week.
 */
let t: TestApp;
let admin: Client;

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
  await createUser(t.prisma, { email: 'admin@example.com', name: 'Manajer', isSystemAdmin: true });
  admin = await loggedIn('admin@example.com');
});

describe('project journey', () => {
  it('runs from a new project to a final weekly report and a later MC baseline', async () => {
    // 1. Project: weeks and 4-week periods come from the start date and duration.
    const project = await ok(
      admin.post('/projects', {
        code: 'JRN-001',
        activityName: 'Kegiatan',
        subActivityName: 'Sub kegiatan',
        projectName: 'Gedung Uji',
        location: 'Denpasar',
        fiscalYear: 2026,
        contractorName: 'PT Kontraktor',
        consultantName: 'CV Konsultan',
        contractNumber: 'KTR/1',
        contractDate: '2026-01-02',
        contractValue: '1000',
        spmkNumber: 'SPMK/1',
        spmkDate: '2026-01-04',
        startDate: '2026-01-05',
        durationDays: 28,
      }),
      201,
    );
    const P = `/projects/${project.id}`;
    expect(await ok(admin.get(`${P}/weeks`))).toHaveLength(4);

    // Team: a filler enters progress, a reviewer checks it.
    for (const [email, role] of [
      ['filler@example.com', 'FILLER'],
      ['reviewer@example.com', 'REVIEWER'],
    ] as const) {
      const u = await createUser(t.prisma, { email, name: role });
      await t.prisma.projectUser.create({ data: { projectId: project.id, userId: u.id, roleId: await roleId(t.prisma, role) } });
    }
    const filler = await loggedIn('filler@example.com');
    const reviewer = await loggedIn('reviewer@example.com');

    // 2. RAB Kontrak: A (40%) and B.I (60%), then approve.
    const kontrak = (await ok(admin.post(`${P}/rab-versions`, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
    const add = async (version: string, body: Record<string, unknown>) =>
      ((await ok(admin.post(`${P}/rab-versions/${version}/items`, body), 201)).rows as { id: string; description: string; workItemId: string }[]).find(
        (r) => r.description === body.description,
      )!;
    const a = await add(kontrak, { rowType: 'SECTION', displayNumber: 'A', description: 'Persiapan' });
    const bouwplank = await add(kontrak, { parentId: a.id, rowType: 'ITEM', description: 'Bouwplank', volume: '1', unit: 'ls', unitPrice: '400', taxPercent: '0' });
    const b = await add(kontrak, { rowType: 'SECTION', displayNumber: 'B', description: 'Lantai 1' });
    const bi = await add(kontrak, { parentId: b.id, rowType: 'SUBSECTION', displayNumber: 'B.I', description: 'Galian' });
    const galian = await add(kontrak, { parentId: bi.id, rowType: 'ITEM', description: 'Galian tanah', volume: '100', unit: 'm3', unitPrice: '6', taxPercent: '0' });
    await ok(admin.post(`${P}/rab-versions/${kontrak}/approve`, { acknowledgeWarnings: true }));

    // 3. Baseline: progress cannot be entered before one is active.
    const early = await filler.request('PUT', `${P}/progress/weeks/1`, { entries: [{ workItemId: galian.workItemId, mode: 'VOLUME_WEEK', volume: '1' }] });
    expect(early.status).toBe(409);
    await ok(admin.post(`${P}/baselines`, { rabVersionId: kontrak, activationMode: 'EXACT_DATE' }), 201);

    // 4. Schedule of the Kontrak: A in week 1, B.I over weeks 1–2; approved, it becomes the plan.
    const schedule = await ok(admin.post(`${P}/schedules`, { rabVersionId: kontrak }), 201);
    const group = (n: string) => (schedule.groups as { id: string; displayNumber: string }[]).find((g) => g.displayNumber === n)!.id;
    await ok(
      admin.request('PUT', `${P}/schedules/${schedule.id}/entries`, {
        entries: [
          { groupId: group('A'), weekNumber: 1, weight: '40' },
          { groupId: group('B.I'), weekNumber: 1, weight: '30' },
          { groupId: group('B.I'), weekNumber: 2, weight: '30' },
        ],
      }),
    );
    await ok(admin.post(`${P}/schedules/${schedule.id}/approve`, {}));

    // 5. Weekly progress by the filler: Bouwplank done, Galian 40 of 100 m3.
    await ok(
      filler.request('PUT', `${P}/progress/weeks/1`, {
        entries: [
          { workItemId: bouwplank.workItemId, mode: 'VOLUME_WEEK', volume: '1' },
          { workItemId: galian.workItemId, mode: 'VOLUME_WEEK', volume: '40' },
        ],
      }),
    );
    const curve = await ok(admin.get(`${P}/schedules/s-curve`));
    expect(curve.weeks[0]).toMatchObject({ plannedCumulative: '70', actualCumulative: '64' }); // 40% + 40/100 × 60%

    // 6. Daily allocation spreads the week over its days; the daily report takes the day's share.
    const daily = await ok(admin.get(`${P}/progress/weeks/1/daily`));
    const galianDays = daily.rows.find((r: { workItemId: string }) => r.workItemId === galian.workItemId).volumes as string[];
    expect(galianDays.reduce((t: number, v: string) => t + Number(v), 0)).toBeCloseTo(40, 6);
    const day = await ok(filler.get(`${P}/daily-reports/2026-01-06`));
    expect(day.work.find((w: { workItemId: string }) => w.workItemId === galian.workItemId).volume).toBe(galianDays[1]);
    await ok(
      filler.request('PUT', `${P}/daily-reports/2026-01-06`, {
        baseUpdatedAt: null,
        resources: [{ category: 'LABOR', name: 'Pekerja', unit: 'OH', actual: '6' }],
        weather: [{ condition: 'CLEAR', fromTime: '08:00', toTime: '16:00' }],
      }),
    );
    await ok(filler.post(`${P}/daily-reports/2026-01-06/finalize`, {}));

    // 7. Weekly report: filler submits, the reviewer (who entered nothing) checks, the manager finalizes.
    await ok(filler.post(`${P}/weekly-reports/1/submit`, {}));
    expect((await filler.post(`${P}/weekly-reports/1/review`, { acknowledgeWarnings: true })).status).toBe(403);
    await ok(reviewer.post(`${P}/weekly-reports/1/review`, { acknowledgeWarnings: true }));
    const final = await ok(admin.post(`${P}/weekly-reports/1/finalize`, { acknowledgeWarnings: true }));
    expect(final.content.totals).toMatchObject({ actualCumulative: '64', plannedCumulative: '70', deviation: '-6' });
    expect(final.content.daily.labor).toEqual([{ name: 'Pekerja', unit: 'OH', total: '6' }]);
    expect(final.content.recap.filter((r: { weight: string | null }) => r.weight).map((r: { displayNumber: string; cumulative: string }) => [r.displayNumber, r.cumulative])).toEqual([
      ['A', '40'],
      ['B.I', '24'],
    ]);

    // 8. Week 1 is locked: progress, its daily reports and a baseline starting in it.
    expect((await filler.request('PUT', `${P}/progress/weeks/1`, { entries: [{ workItemId: galian.workItemId, mode: 'VOLUME_WEEK', volume: '30' }] })).status).toBe(409);
    expect((await filler.request('PUT', `${P}/daily-reports/2026-01-07`, { baseUpdatedAt: null, resources: [], weather: [] })).status).toBe(409);

    // 9. MC-0 (Galian becomes 120 m3), approved, in force from the week after its document date.
    const mc = (await ok(admin.post(`${P}/rab-versions`, { versionType: 'MC', documentDate: '2026-01-08' }), 201)).version.id as string;
    const mcGalian = ((await ok(admin.get(`${P}/rab-versions/${mc}`))).rows as { id: string; workItemId: string }[]).find((r) => r.workItemId === galian.workItemId)!;
    await ok(admin.request('PATCH', `${P}/rab-versions/${mc}/items/${mcGalian.id}`, { volume: '120' }));
    await ok(admin.post(`${P}/rab-versions/${mc}/approve`, { acknowledgeWarnings: true }));
    expect((await admin.post(`${P}/baselines`, { rabVersionId: mc, activationMode: 'EXACT_DATE', effectiveFrom: '2026-01-07' })).status).toBe(409); // inside locked week 1
    await ok(admin.post(`${P}/baselines`, { rabVersionId: mc, activationMode: 'NEXT_WEEK' }), 201);
    const weeks = await ok(admin.get(`${P}/progress/weeks`));
    expect(weeks.slice(0, 2).map((w: { baseline: { label: string } }) => w.baseline.label)).toEqual(['Kontrak', 'MC-0']);
    expect(weeks[0]).toMatchObject({ locked: true, open: false });

    // Week 2 follows MC-0: 40 + 70 = 110 m3 fits 120, though it would exceed the Kontrak 100.
    await ok(filler.request('PUT', `${P}/progress/weeks/2`, { entries: [{ workItemId: galian.workItemId, mode: 'VOLUME_WEEK', volume: '70' }] }));
    const w2 = await ok(admin.get(`${P}/weekly-reports/2`));
    expect(w2.content.baseline.label).toBe('MC-0');
    // The week-1 snapshot did not move.
    expect((await ok(admin.get(`${P}/weekly-reports/1`))).content.totals.actualCumulative).toBe('64');

    // 10. Dated data pins the start date (D-038); the duration can still grow.
    expect((await admin.request('PUT', `${P}/schedule`, { startDate: '2026-01-12', durationDays: 28, reason: 'geser' })).status).toBe(409);
    await ok(admin.request('PUT', `${P}/schedule`, { startDate: '2026-01-05', durationDays: 35, reason: 'Adendum waktu' }));
    expect(await ok(admin.get(`${P}/weeks`))).toHaveLength(5);
  });
});
