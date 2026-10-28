import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

// Project: start Monday 2026-01-05, 120 days → finish 2026-05-04; week n starts 2026-01-05 + 7(n−1).
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

/** Approved Kontrak (one item), then approved MCs copied from it with the given numbers and document dates. */
async function approvedVersions(mcs: { n: number; documentDate: string | null }[] = []) {
  const v = `/projects/${project.id}/rab-versions`;
  const contract = (await ok(admin.post(v, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
  await ok(admin.post(`${v}/${contract}/items`, { rowType: 'ITEM', description: 'Galian', volume: '10', unit: 'm3', unitPrice: '1000', taxPercent: '11' }), 201);
  await ok(admin.post(`${v}/${contract}/approve`, { acknowledgeWarnings: true }));
  const ids: Record<string, string> = { contract };
  for (const mc of mcs) {
    const id = (await ok(admin.post(v, { versionType: 'MC', revisionNumber: mc.n, documentDate: mc.documentDate ?? undefined }), 201)).version.id as string;
    await ok(admin.post(`${v}/${id}/approve`, { acknowledgeWarnings: true }));
    ids[`mc${mc.n}`] = id;
  }
  return ids;
}

const activate = (body: Record<string, unknown>, c: Client = admin) => c.post(base, body);

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
  project = await createProject(t.prisma, 'BAS-001');
  base = `/projects/${project.id}/baselines`;
});

describe('baseline activation (D-071)', () => {
  it('Kontrak first from the project start, MC from the week after its document date, weeks split mid-week', async () => {
    const ids = await approvedVersions([
      { n: 0, documentDate: '2026-01-21' }, // Wednesday of week 3 → NEXT_WEEK = week 4 (2026-01-26)
      { n: 1, documentDate: '2026-02-18' },
    ]);
    const first = await ok(admin.get(base));
    expect(first.assignments).toEqual([]);
    expect(first.candidates.map((c: { rabVersion: { label: string } }) => c.rabVersion.label)).toEqual(['Kontrak']);
    expect((await activate({ rabVersionId: ids.mc0, activationMode: 'NEXT_WEEK' })).status).toBe(409); // Kontrak first

    await ok(activate({ rabVersionId: ids.contract, activationMode: 'NEXT_WEEK', reason: 'SPMK' }), 201);
    const afterContract = await ok(admin.get(base));
    expect(afterContract.assignments[0]).toMatchObject({ effectiveFrom: '2026-01-05', effectiveTo: '2026-05-04', activationMode: 'EXACT_DATE', revocable: true });
    expect(afterContract.candidates.map((c: { rabVersion: { label: string } }) => c.rabVersion.label)).toEqual(['MC-0', 'MC-1']);
    expect(afterContract.candidates[0]).toMatchObject({ nextWeek: { effectiveFrom: '2026-01-26', weekNumber: 4 }, exactDefault: '2026-01-21' });

    const mc0 = await ok(activate({ rabVersionId: ids.mc0, activationMode: 'NEXT_WEEK' }), 201);
    expect(mc0.assignments.map((a: { rabVersion: { label: string }; effectiveFrom: string; effectiveTo: string }) => [a.rabVersion.label, a.effectiveFrom, a.effectiveTo])).toEqual([
      ['Kontrak', '2026-01-05', '2026-01-25'],
      ['MC-0', '2026-01-26', '2026-05-04'],
    ]);
    // Exact date mid-week: week 8 (2026-02-23 … 03-01) is split on Wednesday 2026-02-25.
    const mc1 = await ok(activate({ rabVersionId: ids.mc1, activationMode: 'EXACT_DATE', effectiveFrom: '2026-02-25' }), 201);
    expect(mc1.weeks.find((w: { weekNumber: number }) => w.weekNumber === 8).segments).toEqual([
      { rabVersionId: ids.mc0, label: 'MC-0', startDate: '2026-02-23', endDate: '2026-02-24' },
      { rabVersionId: ids.mc1, label: 'MC-1', startDate: '2026-02-25', endDate: '2026-03-01' },
    ]);
    expect(mc1.assignments.map((a: { revocable: boolean }) => a.revocable)).toEqual([false, false, true]);
    const audit = await t.prisma.auditLog.findMany({ where: { action: 'ACTIVATE_BASELINE' }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => (a.newValue as { rabVersion: string }).rabVersion)).toEqual(['Kontrak', 'MC-0', 'MC-1']);
  });

  it('refuses order, date and status violations', async () => {
    const ids = await approvedVersions([
      { n: 0, documentDate: null },
      { n: 5, documentDate: '2026-06-01' }, // after the project end
    ]);
    await ok(activate({ rabVersionId: ids.contract, activationMode: 'EXACT_DATE' }), 201);
    expect((await activate({ rabVersionId: ids.contract, activationMode: 'EXACT_DATE' })).status).toBe(409); // twice
    expect((await activate({ rabVersionId: ids.mc0, activationMode: 'NEXT_WEEK' })).status).toBe(400); // no document date
    expect((await activate({ rabVersionId: ids.mc0, activationMode: 'EXACT_DATE', effectiveFrom: '2026-01-05' })).status).toBe(409); // not after Kontrak
    expect((await activate({ rabVersionId: ids.mc0, activationMode: 'EXACT_DATE', effectiveFrom: '2026-06-01' })).status).toBe(409); // outside
    expect((await activate({ rabVersionId: ids.mc5, activationMode: 'NEXT_WEEK' })).status).toBe(409); // no later week
    await ok(activate({ rabVersionId: ids.mc5, activationMode: 'EXACT_DATE', effectiveFrom: '2026-03-02' }), 201);
    expect((await activate({ rabVersionId: ids.mc0, activationMode: 'EXACT_DATE', effectiveFrom: '2026-04-01' })).status).toBe(409); // backwards
    const draft = (await ok(admin.post(`/projects/${project.id}/rab-versions`, { versionType: 'MC', revisionNumber: 6 }), 201)).version.id;
    expect((await activate({ rabVersionId: draft, activationMode: 'EXACT_DATE', effectiveFrom: '2026-04-01' })).status).toBe(409); // not approved
    expect((await activate({ rabVersionId: ids.mc0, activationMode: 'NEXT_WEEK', effectiveFrom: '2026-04-01' })).status).toBe(400); // date with NEXT_WEEK
  });

  it('revokes only the latest assignment; the previous one is in force again', async () => {
    const ids = await approvedVersions([{ n: 0, documentDate: '2026-01-21' }]);
    const contract = (await ok(activate({ rabVersionId: ids.contract, activationMode: 'EXACT_DATE' }), 201)).assignments[0].id;
    const mc0 = (await ok(activate({ rabVersionId: ids.mc0, activationMode: 'NEXT_WEEK' }), 201)).assignments[1].id;
    expect((await admin.post(`${base}/${contract}/revoke`, { reason: 'Salah pilih' })).status).toBe(409);
    expect((await admin.post(`${base}/${mc0}/revoke`, {})).status).toBe(400);
    const after = await ok(admin.post(`${base}/${mc0}/revoke`, { reason: 'Tanggal efektif salah' }));
    expect(after.assignments).toHaveLength(1);
    expect(after.assignments[0]).toMatchObject({ effectiveTo: '2026-05-04', revocable: true });
    expect(after.candidates.map((c: { rabVersion: { label: string } }) => c.rabVersion.label)).toEqual(['MC-0']);
    const stored = await t.prisma.baselineAssignment.findUniqueOrThrow({ where: { id: mc0 } });
    expect(stored).toMatchObject({ revokeReason: 'Tanggal efektif salah' });
    expect(stored.revokedAt).not.toBeNull();
  });

  it('needs baseline.activate (MANAGER and RAB_EDITOR by default); reading follows rab.read', async () => {
    const ids = await approvedVersions();
    const join = async (code: string) => {
      const email = `${code.toLowerCase()}@example.com`;
      const u = await createUser(t.prisma, { email });
      await ok(admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: await roleId(t.prisma, code) }), 204);
      return loggedIn(email);
    };
    const filler = await join('FILLER');
    await ok(filler.get(base));
    expect((await activate({ rabVersionId: ids.contract, activationMode: 'EXACT_DATE' }, filler)).status).toBe(403);
    const editor = await join('RAB_EDITOR');
    await ok(activate({ rabVersionId: ids.contract, activationMode: 'EXACT_DATE' }, editor), 201);
  });

  it('a schedule change moves the Kontrak assignment and refuses one that strands an MC', async () => {
    const ids = await approvedVersions([{ n: 0, documentDate: '2026-01-21' }]);
    await ok(activate({ rabVersionId: ids.contract, activationMode: 'EXACT_DATE' }), 201);
    await ok(admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-01-07', durationDays: 120, reason: 'SPMK mundur' }));
    expect((await ok(admin.get(base))).assignments[0].effectiveFrom).toBe('2026-01-07');
    await ok(activate({ rabVersionId: ids.mc0, activationMode: 'EXACT_DATE', effectiveFrom: '2026-02-02' }), 201);
    expect((await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-02-03', durationDays: 120, reason: 'Mundur lagi' })).status).toBe(409);
    expect((await admin.request('PUT', `/projects/${project.id}/schedule`, { startDate: '2026-01-07', durationDays: 20, reason: 'Dipersingkat' })).status).toBe(409);
  });
});
