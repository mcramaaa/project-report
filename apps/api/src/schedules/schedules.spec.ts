import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { xlsxOf, type SheetSpec } from '../imports/test-workbook';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

// Project: start 2026-01-05, 120 days → 18 weeks. RAB: A (one item, 40%) and B → B.I (one item, 60%).
let t: TestApp;
let admin: Client;
let project: { id: string };
let base: string;

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

/** Approved Kontrak with groups A (40%) and B.I (60%); section B only holds B.I. */
async function approvedContract(): Promise<string> {
  const v = `/projects/${project.id}/rab-versions`;
  const id = (await ok(admin.post(v, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
  const add = async (body: Record<string, unknown>) => {
    const rows = (await ok(admin.post(`${v}/${id}/items`, body), 201)).rows as { id: string; description: string }[];
    return rows.find((r) => r.description === body.description)!.id;
  };
  const a = await add({ rowType: 'SECTION', displayNumber: 'A', description: 'Persiapan' });
  await add({ parentId: a, rowType: 'ITEM', description: 'Bouwplank', volume: '1', unit: 'ls', unitPrice: '400', taxPercent: '0' });
  const b = await add({ rowType: 'SECTION', displayNumber: 'B', description: 'Lantai 1' });
  const bi = await add({ parentId: b, rowType: 'SUBSECTION', displayNumber: 'B.I', description: 'Galian' });
  await add({ parentId: bi, rowType: 'ITEM', description: 'Galian tanah', volume: '1', unit: 'm3', unitPrice: '600', taxPercent: '0' });
  await ok(admin.post(`${v}/${id}/approve`, { acknowledgeWarnings: true }));
  return id;
}

async function draft() {
  const rabVersionId = await approvedContract();
  const s = await ok(admin.post(base, { rabVersionId }), 201);
  const [a, bi] = s.groups as { id: string; displayNumber: string; weight: string }[];
  return { s, a: a!, bi: bi! };
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
  project = await createProject(t.prisma, 'SCH-001');
  await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 120));
  base = `/projects/${project.id}/schedules`;
});

describe('time schedule (D-072)', () => {
  it('groups are REKAP RAB rows with RAB weights; approve needs every group to add up, then the schedule locks', async () => {
    const { s, a, bi } = await draft();
    expect(s.groups.map((g: { displayNumber: string; weight: string }) => [g.displayNumber, Number(g.weight)])).toEqual([
      ['A', 40],
      ['B.I', 60],
    ]);
    expect(s.weeks).toHaveLength(18);
    expect(s.status).toBe('DRAFT');

    const partial = await ok(admin.request('PUT', `${base}/${s.id}/entries`, { entries: [{ groupId: a.id, weekNumber: 1, weight: '40' }, { groupId: bi.id, weekNumber: 2, weight: '30' }] }));
    expect(partial.issues.map((i: { message: string }) => i.message)).toEqual([expect.stringContaining('B.I Galian: jumlah rencana 30.000000%')]);
    expect((await admin.post(`${base}/${s.id}/approve`, {})).status).toBe(409);

    const full = await ok(
      admin.request('PUT', `${base}/${s.id}/entries`, {
        entries: [
          { groupId: a.id, weekNumber: 1, weight: '40' },
          { groupId: bi.id, weekNumber: 2, weight: '30' },
          { groupId: bi.id, weekNumber: 3, weight: '29.99995' }, // within the 0.0001 tolerance
          { groupId: bi.id, weekNumber: 4, weight: '0' }, // zero cells are not stored
        ],
      }),
    );
    expect(full.issues).toEqual([]);
    expect(full.entries).toHaveLength(3);
    expect(full.curve.slice(0, 4)).toEqual([
      { weekNumber: 1, planned: '40', cumulative: '40' },
      { weekNumber: 2, planned: '30', cumulative: '70' },
      { weekNumber: 3, planned: '29.99995', cumulative: '99.99995' },
      { weekNumber: 4, planned: '0', cumulative: '99.99995' },
    ]);

    const approved = await ok(admin.post(`${base}/${s.id}/approve`, {}));
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: { name: 'Super' } });
    expect((await admin.request('PUT', `${base}/${s.id}/entries`, { entries: [] })).status).toBe(409);

    expect((await admin.post(`${base}/${s.id}/reopen`, {})).status).toBe(400); // reason required
    const reopened = await ok(admin.post(`${base}/${s.id}/reopen`, { reason: 'Revisi MC' }));
    expect(reopened.status).toBe('REOPENED');
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'REOPEN_SCHEDULE' } });
    expect(audit.reason).toBe('Revisi MC');
    expect((audit.oldValue as { entries: unknown[] }).entries).toHaveLength(3);
  });

  it('rejects a second schedule for the same version, non-group rows, and weeks outside the project', async () => {
    const { s, a } = await draft();
    expect((await admin.post(base, { rabVersionId: s.rabVersion.id })).status).toBe(409);
    const sectionB = (await t.prisma.rabVersionItem.findFirstOrThrow({ where: { displayNumber: 'B' } })).id;
    expect((await admin.request('PUT', `${base}/${s.id}/entries`, { entries: [{ groupId: sectionB, weekNumber: 1, weight: '1' }] })).status).toBe(400);
    expect((await admin.request('PUT', `${base}/${s.id}/entries`, { entries: [{ groupId: a.id, weekNumber: 19, weight: '1' }] })).status).toBe(400);
  });

  it('imports Master Curva S by week header and group number, from cached values', async () => {
    const { s } = await draft();
    const sheet: SheetSpec = {
      C20: 'NO',
      D20: 'PEKERJAAN',
      L20: 'M.1',
      M20: 'M.2',
      N20: 'M.3',
      C25: 'A',
      L25: ['+I25/J25', 40],
      C26: 'B', // section with subsections: no values, ignored
      C27: 'B.I',
      M27: 20.000000000000004,
      N27: 39.99999999999999,
      D80: 'RENCANA PROGRES',
      L80: 40,
    };
    const upload = await admin.upload(`/projects/${project.id}/documents`, [{ name: 'mingguan.xlsx', data: await xlsxOf({ 'Master Curva S': sheet }) }]);
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const documentId = upload.body[0].id as string;

    const imported = await ok(admin.post(`${base}/${s.id}/import`, { documentId }));
    expect(imported.sourceDocument).toEqual({ id: documentId, filename: 'mingguan.xlsx' });
    expect(imported.entries.map((e: { weekNumber: number; weight: string }) => [e.weekNumber, e.weight])).toEqual([
      [1, '40'],
      [2, '20'],
      [3, '40'],
    ]);
    expect(imported.issues).toEqual([]);
    expect(imported.importAdjustments).toEqual([]);

    // D-074: a sheet made for other weights keeps its weekly spread, scaled to this version's weight.
    const older = await admin.upload(`/projects/${project.id}/documents`, [{ name: 'lama.xlsx', data: await xlsxOf({ 'Master Curva S': { ...sheet, M27: 30, N27: 60 } }) }]);
    const scaled = await ok(admin.post(`${base}/${s.id}/import`, { documentId: older.body[0].id }));
    expect(scaled.entries.map((e: { weekNumber: number; weight: string }) => [e.weekNumber, e.weight])).toEqual([
      [1, '40'],
      [2, '20'],
      [3, '40'],
    ]);
    expect(scaled.importAdjustments).toEqual([{ group: 'B.I Galian', from: '90', to: '60' }]);
    expect(scaled.issues).toEqual([]);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'IMPORT_SCHEDULE' }, orderBy: { createdAt: 'desc' } });
    expect((audit.newValue as { scaledGroups: unknown[] }).scaledGroups).toHaveLength(1);

    const unknown = await admin.upload(`/projects/${project.id}/documents`, [{ name: 'salah.xlsx', data: await xlsxOf({ 'Master Curva S': { ...sheet, C30: 'Z.IX', L30: 5 } }) }]);
    const failed = await admin.post(`${base}/${s.id}/import`, { documentId: unknown.body[0].id });
    expect(failed.status).toBe(400);
    expect(failed.body.errors).toEqual([expect.stringContaining('Baris 30 (Z.IX) berisi rencana')]);
  });

  it('needs schedule.edit to change and schedule.approve to approve; rab.read can only read', async () => {
    const { s } = await draft();
    const reader = await createUser(t.prisma, { email: 'filler@example.com' });
    await t.prisma.projectUser.create({ data: { projectId: project.id, userId: reader.id, roleId: await roleId(t.prisma, 'FILLER') } });
    const filler = await loggedIn('filler@example.com');
    await ok(filler.get(`${base}/${s.id}`));
    expect((await filler.request('PUT', `${base}/${s.id}/entries`, { entries: [] })).status).toBe(403);
    expect((await filler.post(`${base}/${s.id}/approve`, {})).status).toBe(403);
  });

  it('a week with schedule entries blocks shortening the project', async () => {
    const { s, a } = await draft();
    await ok(admin.request('PUT', `${base}/${s.id}/entries`, { entries: [{ groupId: a.id, weekNumber: 18, weight: '40' }] }));
    const res = await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-01-05', durationDays: 100, reason: 'Percepatan' });
    expect(res.status).toBe(409);
  });
});
