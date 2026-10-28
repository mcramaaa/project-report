import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_DEFAULT_PERMISSIONS } from '@laporan-proyek/shared';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';
import { checksumOf } from './provenance';

let t: TestApp;
let admin: Client;
let project: { id: string };
let base: string;

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
}

async function member(code: string, email = `role-${code.toLowerCase()}@example.com`) {
  const u = await createUser(t.prisma, { email });
  const res = await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: await roleId(t.prisma, code) });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
  return { client: await loggedIn(email), userId: u.id };
}

async function ok(res: Promise<ApiResponse>, status = 200) {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

type Row = { id: string; description: string; unitPrice: string; volume: string; workItemId: string; workItemCode: string; analysisUnitPrice: string | null; sourceLocator: unknown; parentId: string | null };
const row = (detail: { rows: Row[] }, description: string) => detail.rows.find((r) => r.description === description)!;

/**
 * Approved Kontrak whose package has: base prices (labor, rent), SUB (rounded to 0) from labor, MAIN with SUB
 * exact ×2, SUB rounded ×1, rent /8 ×0.5 and a manual 7000, overhead 10%, rounded to 2. Item A follows MAIN
 * (ANALYSIS); item B keeps a reviewer override of 70000; item C has a direct price.
 */
async function packagedContract() {
  const v = await ok(admin.post(base, { versionType: 'CONTRACT' }), 201);
  const id = v.version.id as string;
  await ok(admin.post(`${base}/${id}/items`, { rowType: 'SECTION', displayNumber: 'I', description: 'Persiapan' }), 201);
  const section = (await admin.get(`${base}/${id}`)).body.rows[0].id;
  for (const [description, unitPrice] of [['Pekerjaan A', null], ['Pekerjaan B', null], ['Pekerjaan C', '5000']] as const)
    await ok(admin.post(`${base}/${id}/items`, { rowType: 'ITEM', parentId: section, description, volume: '2', unit: 'm2', unitPrice, taxPercent: '11' }), 201);

  const ids = { priceList: randomUUID(), labor: randomUUID(), rent: randomUUID(), subA: randomUUID(), mainA: randomUUID(), sub: randomUUID(), main: randomUUID() };
  const loc = (cell: string) => ({ sheet: 'HARGA', cell });
  await t.prisma.priceList.create({ data: { id: ids.priceList, projectId: project.id, rabVersionId: id, versionNumber: 1, createdBy: (await t.prisma.user.findFirstOrThrow()).id } });
  await t.prisma.priceItem.createMany({
    data: [
      { id: ids.labor, priceListId: ids.priceList, name: 'Pekerja', unit: 'OH', price: '100000', sourceLocator: loc('C5') },
      { id: ids.rent, priceListId: ids.priceList, name: 'Sewa molen', unit: 'hari', price: '800000', sourceLocator: loc('C9') },
    ],
  });
  await t.prisma.ahspAnalysis.createMany({
    data: [
      { id: ids.subA, projectId: project.id, rabVersionId: id, code: 'S.1', name: 'Sub' },
      { id: ids.mainA, projectId: project.id, rabVersionId: id, code: 'M.1', name: 'Main' },
    ],
  });
  const analysis = (vid: string, aid: string, code: string, values: Record<string, string | number | null>) => ({
    id: vid, analysisId: aid, versionNumber: 1, priceListId: ids.priceList, code, name: code, sourceLocator: { sheet: 'ANALISA', cell: `F${code}` }, ...values,
  });
  await t.prisma.ahspAnalysisVersion.createMany({
    data: [
      analysis(ids.sub, ids.subA, 'S.1', { overheadPercent: null, roundingScale: 0, directCost: '1500.3', overheadAmount: '0', priceExact: '1500.3', price: '1500' }),
      analysis(ids.main, ids.mainA, 'M.1', { overheadPercent: '10', roundingScale: 2, directCost: '61500.6', overheadAmount: '6150.06', priceExact: '67650.66', price: '67650.66' }),
    ] as never,
  });
  const comp = (analysisVersionId: string, sortOrder: number, values: Record<string, unknown>) => ({
    id: randomUUID(), analysisVersionId, sortOrder, category: 'MATERIAL' as const, description: `K${sortOrder}`, sourceLocator: { sheet: 'ANALISA', cell: `E${sortOrder}` }, ...values,
  });
  const components = [
    comp(ids.sub, 1, { category: 'LABOR', coefficient: '0.015003', priceItemId: ids.labor, unitPrice: '100000', amount: '1500.3' }),
    comp(ids.main, 1, { coefficient: '2', subAnalysisVersionId: ids.sub, subPriceBasis: 'EXACT', unitPrice: '1500.3', amount: '3000.6' }),
    comp(ids.main, 2, { coefficient: '1', subAnalysisVersionId: ids.sub, subPriceBasis: 'ROUNDED', unitPrice: '1500', amount: '1500' }),
    comp(ids.main, 3, { category: 'EQUIPMENT', coefficient: '0.5', priceItemId: ids.rent, unitPrice: '100000', amount: '50000', sourceLocator: { sheet: 'ANALISA', cell: 'E3', factor: { op: '/', value: '8' } } }),
    comp(ids.main, 4, { coefficient: '1', unitPrice: '7000', amount: '7000' }),
  ];
  await t.prisma.ahspComponent.createMany({ data: components as never });
  const detail = (await admin.get(`${base}/${id}`)).body;
  await t.prisma.rabVersionItem.update({ where: { id: row(detail, 'Pekerjaan A').id }, data: { analysisVersionId: ids.main, priceSource: 'ANALYSIS', unitPrice: '67650.66', analysisUnitPrice: '67650.66', sourceUnitPrice: '67650.66', sourceLocator: { sheet: 'RAB', cell: 'G10' } } });
  await t.prisma.rabVersionItem.update({ where: { id: row(detail, 'Pekerjaan B').id }, data: { analysisVersionId: ids.main, priceSource: 'SOURCE_OVERRIDE', unitPrice: '70000', analysisUnitPrice: '67650.66', sourceUnitPrice: '70000', priceNote: 'harga kontrak' } });
  await ok(admin.post(`${base}/${id}/approve`, { acknowledgeWarnings: true }));
  const [, exact, rounded, rent, manual] = components.map((c) => c.id);
  return { id, ...ids, components: { exact: exact!, rounded: rounded!, rent: rent!, manual: manual! } };
}

const reopen = (versionId: string, c: Client = admin, reason = 'Harga sewa salah ketik') => c.post(`${base}/${versionId}/reopen`, { reason });

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
  project = await createProject(t.prisma, 'KOR-001');
  base = `/projects/${project.id}/rab-versions`;
});

describe('RAB_EDITOR role and correction rights (D-068)', () => {
  it('is a project role with rab.reopen/ahsp.edit that no older role receives', async () => {
    const role = await t.prisma.role.findUniqueOrThrow({ where: { code: 'RAB_EDITOR' }, include: { permissions: true } });
    expect(role).toMatchObject({ scope: 'PROJECT', isSystem: true });
    expect(role.permissions.map((p) => p.permissionCode).sort()).toEqual([...SYSTEM_ROLE_DEFAULT_PERMISSIONS.RAB_EDITOR].sort());
    const others = await t.prisma.rolePermission.findMany({ where: { permissionCode: { in: ['rab.reopen', 'ahsp.edit'] }, role: { code: { not: 'RAB_EDITOR' } } } });
    expect(others).toEqual([]);
  });

  it('only rab.reopen reopens; rab.edit alone never changes a REOPENED version; revoking applies at once', async () => {
    const v = await packagedContract();
    const manager = await member('MANAGER');
    const projectAdmin = await member('ADMIN');
    const editor = await member('RAB_EDITOR');
    expect((await reopen(v.id, manager.client)).status).toBe(403);
    expect((await editor.client.post(`${base}/${v.id}/reopen`, {})).status).toBe(400);
    await ok(reopen(v.id, editor.client));

    const c = row((await admin.get(`${base}/${v.id}`)).body, 'Pekerjaan C');
    // Old RAB edit endpoint: rab.edit (ADMIN) is not enough on a REOPENED version, with or without a reason.
    expect((await projectAdmin.client.patch(`${base}/${v.id}/items/${c.id}`, { volume: '3', reason: 'x' })).status).toBe(403);
    expect((await projectAdmin.client.delete(`${base}/${v.id}/items/${c.id}`, { reason: 'x' })).status).toBe(403);
    expect((await editor.client.patch(`${base}/${v.id}/items/${c.id}`, { volume: '3' })).status).toBe(400);
    await ok(editor.client.patch(`${base}/${v.id}/items/${c.id}`, { volume: '3', reason: 'Volume hasil ukur ulang' }));
    // ahsp.edit is required for the package; ADMIN has none.
    expect((await projectAdmin.client.patch(`${base}/${v.id}/price-items/${v.rent}`, { price: '1', reason: 'x' })).status).toBe(403);

    await ok(admin.delete(`/admin/projects/${project.id}/members/${editor.userId}`, { reason: 'Pindah tugas' }), 204);
    expect((await editor.client.patch(`${base}/${v.id}/items/${c.id}`, { volume: '4', reason: 'lagi' })).status).toBe(404);
  });

  it('refuses closed projects, wrong statuses, a second open version, discard and new versions while reopened', async () => {
    const v = await packagedContract();
    await t.prisma.project.update({ where: { id: project.id }, data: { status: 'CLOSED' } });
    expect((await reopen(v.id)).status).toBe(409);
    await t.prisma.project.update({ where: { id: project.id }, data: { status: 'ACTIVE' } });

    const mc0 = await ok(admin.post(base, { versionType: 'MC' }), 201);
    expect((await reopen(v.id)).status).toBe(409); // a draft is open
    expect((await reopen(mc0.version.id)).status).toBe(409); // not approved
    await ok(admin.post(`${base}/${mc0.version.id}/approve`, { acknowledgeWarnings: true }));

    await ok(reopen(v.id));
    expect((await reopen(mc0.version.id)).status).toBe(409); // one correction per project
    expect((await admin.post(`${base}/${v.id}/discard`, { reason: 'tidak jadi' })).status).toBe(409);
    expect((await admin.post(base, { versionType: 'MC' })).status).toBe(409);
  });
});

describe('snapshots and re-approval (D-068)', () => {
  it('requires both rab.read and ahsp.read to view full history and archived packages', async () => {
    const v = await packagedContract();
    const [snapshot] = (await ok(admin.get(`${base}/${v.id}/history`))).snapshots;
    const role = await t.prisma.role.create({
      data: {
        code: 'RAB_ONLY_TEST',
        name: 'RAB read only test',
        scope: 'PROJECT',
        permissions: { create: { permissionCode: 'rab.read' } },
      },
    });
    const user = await createUser(t.prisma, { email: 'rab-only@example.com' });
    await t.prisma.projectUser.create({ data: { projectId: project.id, userId: user.id, roleId: role.id } });
    const reader = await loggedIn('rab-only@example.com');
    expect((await reader.get(`${base}/${v.id}/history`)).status).toBe(403);
    expect((await reader.get(`${base}/${v.id}/snapshots/${snapshot.id}`)).status).toBe(403);
  });

  it('archives each approval immutably, keeps old payloads after a correction, and records the history', async () => {
    const v = await packagedContract();
    const [first] = (await ok(admin.get(`${base}/${v.id}/history`))).snapshots;
    expect(first).toMatchObject({ sequence: 1, approvedBy: { name: 'Super' } });

    await ok(reopen(v.id));
    expect((await ok(admin.get(`${base}/${v.id}/history`))).snapshots).toHaveLength(1);
    const c = row((await admin.get(`${base}/${v.id}`)).body, 'Pekerjaan C');
    await ok(admin.patch(`${base}/${v.id}/items/${c.id}`, { volume: '3', reason: 'Ukur ulang' }));
    await ok(admin.patch(`${base}/${v.id}/price-items/${v.rent}`, { price: '960000', reason: 'Sewa per hari salah' }));
    const reapproved = await ok(admin.post(`${base}/${v.id}/approve`, { acknowledgeWarnings: true }));
    expect(reapproved.version).toMatchObject({ id: v.id, status: 'APPROVED', versionType: 'CONTRACT' });

    const history = await ok(admin.get(`${base}/${v.id}/history`));
    expect(history.snapshots.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2]);
    expect(history.events.map((e: { action: string }) => e.action)).toEqual([
      'CREATE_RAB_VERSION', 'APPROVE_RAB_VERSION', 'REOPEN_RAB_VERSION', 'CORRECT_RAB_ITEM', 'CORRECT_PRICE_ITEM', 'APPROVE_RAB_VERSION',
    ]);
    const priceEvent = history.events.find((e: { action: string }) => e.action === 'CORRECT_PRICE_ITEM');
    expect(priceEvent).toMatchObject({ reason: 'Sewa per hari salah', actor: { name: 'Super' }, oldValue: { price: '800000' }, newValue: { price: '960000' } });

    const old = await ok(admin.get(`${base}/${v.id}/snapshots/${first.id}`));
    expect(old.checksumValid).toBe(true);
    expect(row(old.payload, 'Pekerjaan C').volume).toBe('2');
    expect(row(old.payload, 'Pekerjaan A').unitPrice).toBe('67650.66');
    expect(old.payload.package.priceItems.find((p: { id: string }) => p.id === v.rent).price).toBe('800000');
    const latest = await ok(admin.get(`${base}/${v.id}/snapshots/${history.snapshots[1].id}`));
    expect(row(latest.payload, 'Pekerjaan A').unitPrice).toBe('78650.66');
    // Deterministic checksum: the stored payload hashes to the stored checksum regardless of JSON key order.
    const stored = await t.prisma.rabVersionSnapshot.findFirstOrThrow({ where: { id: first.id } });
    expect(checksumOf(stored.payload)).toBe(stored.checksum);
  });

  it('freezes a version approved before D-068 at the first reopen', async () => {
    const v = await packagedContract();
    await t.prisma.rabVersionSnapshot.deleteMany({ where: { rabVersionId: v.id } }); // simulate a legacy approval
    const editor = await member('RAB_EDITOR');
    await ok(reopen(v.id, editor.client));
    const s = await t.prisma.rabVersionSnapshot.findFirstOrThrow({ where: { rabVersionId: v.id } });
    expect(s).toMatchObject({ sequence: 1, createdBy: editor.userId });
    expect((s.payload as { version: { approvedBy: string } }).version.approvedBy).toBeTruthy();
  });

  it('keeps Kontrak → MC-0 → Addendum order after re-approving the Kontrak; MC-0 package stays untouched', async () => {
    const v = await packagedContract();
    const mc0 = await ok(admin.post(base, { versionType: 'MC' }), 201);
    await ok(admin.post(`${base}/${mc0.version.id}/approve`, { acknowledgeWarnings: true }));
    const mc0Prices = await t.prisma.priceItem.findMany({ where: { priceList: { rabVersionId: mc0.version.id } }, orderBy: { id: 'asc' } });

    await ok(reopen(v.id));
    await ok(admin.patch(`${base}/${v.id}/price-items/${v.rent}`, { price: '960000', reason: 'Sewa salah' }));
    await ok(admin.post(`${base}/${v.id}/approve`, { acknowledgeWarnings: true }));

    expect(await t.prisma.priceItem.findMany({ where: { priceList: { rabVersionId: mc0.version.id } }, orderBy: { id: 'asc' } })).toEqual(mc0Prices);
    const mc0Detail = await ok(admin.get(`${base}/${mc0.version.id}`));
    expect(row(mc0Detail, 'Pekerjaan A').unitPrice).toBe('67650.66');
    // The copy keeps pointing at its origin row, whose old value is in the Kontrak snapshot.
    const copy = await t.prisma.priceItem.findFirstOrThrow({ where: { priceList: { rabVersionId: mc0.version.id }, name: 'Sewa molen' } });
    expect(copy.copiedFromId).toBe(v.rent);

    const addendum = await ok(admin.post(base, { versionType: 'MC' }), 201);
    expect(addendum.version.previousVersionId).toBe(mc0.version.id);
  });
});

describe('corrections from the source (D-068)', () => {
  it('base price → factor → EXACT/ROUNDED sub-analysis → ANALYSIS item; overrides and other analyses stay', async () => {
    const v = await packagedContract();
    await ok(reopen(v.id));
    // Labor 100000 → 110000: SUB exact 1650.33 / rounded 1650; MAIN D = 3300.66 + 1650 + 50000 + 7000 = 61950.66,
    // F = 68145.726 → ROUND 2 = 68145.73.
    const detail = await ok(admin.patch(`${base}/${v.id}/price-items/${v.labor}`, { price: '110000', reason: 'Upah sesuai SK' }));
    const comps = new Map((await t.prisma.ahspComponent.findMany()).map((c) => [c.id, c]));
    expect(comps.get(v.components.exact)!.unitPrice.toString()).toBe('1650.33');
    expect(comps.get(v.components.rounded)!.unitPrice.toString()).toBe('1650');
    expect(comps.get(v.components.rent)!.unitPrice.toString()).toBe('100000'); // untouched: rent did not change
    const main = await t.prisma.ahspAnalysisVersion.findUniqueOrThrow({ where: { id: v.main } });
    expect([main.directCost.toString(), main.priceExact.toString(), main.price.toString()]).toEqual(['61950.66', '68145.726', '68145.73']);
    expect(row(detail, 'Pekerjaan A')).toMatchObject({ unitPrice: '68145.73', analysisUnitPrice: '68145.73' });
    expect(row(detail, 'Pekerjaan B')).toMatchObject({ unitPrice: '70000', analysisUnitPrice: '68145.73' });
    // Provenance: the original cell stays; the recalculated value is marked as such.
    expect(row(detail, 'Pekerjaan A').sourceLocator).toMatchObject({ sheet: 'RAB', cell: 'G10', corrections: [{ kind: 'RECALCULATED', reason: 'Upah sesuai SK' }] });
    const labor = await t.prisma.priceItem.findUniqueOrThrow({ where: { id: v.labor } });
    expect(labor.sourceLocator).toMatchObject({ cell: 'C5', corrections: [{ kind: 'MANUAL', changes: { price: ['100000', '110000'] } }] });
  });

  it('coefficient, manual price and overhead are inputs; derived prices and >2-decimal RAB prices are refused', async () => {
    const v = await packagedContract();
    await ok(reopen(v.id));
    expect((await admin.patch(`${base}/${v.id}/components/${v.components.rent}`, { unitPrice: '1', reason: 'x' })).status).toBe(409);
    const a = row((await admin.get(`${base}/${v.id}`)).body, 'Pekerjaan A');
    expect((await admin.patch(`${base}/${v.id}/items/${a.id}`, { unitPrice: '1', reason: 'x' })).status).toBe(409);

    await ok(admin.patch(`${base}/${v.id}/components/${v.components.manual}`, { unitPrice: '8000', reason: 'Harga toko' }));
    await ok(admin.patch(`${base}/${v.id}/components/${v.components.rent}`, { coefficient: '0.6', reason: 'Koefisien' }));
    // D = 3000.6 + 1500 + 0.6 × 100000 + 8000 = 72500.6; F = 79750.66 even unrounded; overhead 10.5% gives 80113.163.
    await ok(admin.patch(`${base}/${v.id}/analysis-versions/${v.main}`, { roundingScale: null, reason: 'Sumber tanpa pembulatan' }));
    const refused = await admin.patch(`${base}/${v.id}/analysis-versions/${v.main}`, { overheadPercent: '10.5', reason: 'OH' });
    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].message).toContain('lebih dari 2 desimal');
    const ok2 = await ok(admin.patch(`${base}/${v.id}/analysis-versions/${v.main}`, { overheadPercent: '', reason: 'Tanpa overhead' }));
    expect(row(ok2, 'Pekerjaan A').unitPrice).toBe('72500.6');
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'CORRECT_AHSP_ANALYSIS', reason: 'Tanpa overhead' } });
    expect(audit.oldValue).toMatchObject({ overheadPercent: '10' });
    expect(audit.newValue).toMatchObject({ overheadPercent: null });
  });

  it('refuses cycles and relations outside the package', async () => {
    const v = await packagedContract();
    await ok(reopen(v.id));
    await t.prisma.ahspComponent.create({ data: { analysisVersionId: v.sub, sortOrder: 9, category: 'MATERIAL', description: 'loop', coefficient: '0', subAnalysisVersionId: v.main, subPriceBasis: 'EXACT', unitPrice: '0', amount: '0', sourceLocator: {} } });
    const cyclic = await admin.patch(`${base}/${v.id}/price-items/${v.rent}`, { price: '1', reason: 'x' });
    expect(cyclic.status).toBe(409);
    expect(cyclic.body.message).toContain('bersiklus');
    await t.prisma.ahspComponent.deleteMany({ where: { description: 'loop' } });

    const other = await createProject(t.prisma, 'KOR-002');
    const foreign = await t.prisma.priceList.create({ data: { projectId: other.id, rabVersionId: (await t.prisma.rabVersion.create({ data: { projectId: other.id, versionType: 'CONTRACT', revisionNumber: 0, createdBy: (await t.prisma.user.findFirstOrThrow()).id } })).id, versionNumber: 1, createdBy: (await t.prisma.user.findFirstOrThrow()).id, items: { create: { name: 'Asing', price: '1', sourceLocator: {} } } }, include: { items: true } });
    await t.prisma.ahspComponent.update({ where: { id: v.components.manual }, data: { priceItemId: foreign.items[0]!.id } });
    expect((await admin.patch(`${base}/${v.id}/price-items/${v.rent}`, { price: '1', reason: 'x' })).status).toBe(409);
  });

  it('refuses changing a source that a foreign AHSP component still references', async () => {
    const v = await packagedContract();
    const mc0 = await ok(admin.post(base, { versionType: 'MC' }), 201);
    await ok(admin.post(`${base}/${mc0.version.id}/approve`, { acknowledgeWarnings: true }));
    const foreignAnalysis = await t.prisma.ahspAnalysisVersion.findFirstOrThrow({
      where: { analysis: { rabVersionId: mc0.version.id } },
      select: { id: true },
    });
    const reference = await t.prisma.ahspComponent.create({
      data: {
        analysisVersionId: foreignAnalysis.id,
        sortOrder: 500,
        category: 'MATERIAL',
        description: 'Tautan legacy lintas paket',
        coefficient: '1',
        priceItemId: v.rent,
        unitPrice: '100000',
        amount: '100000',
        sourceLocator: { factor: { op: '/', value: '8' } },
      },
    });
    await ok(reopen(v.id));
    expect((await admin.patch(`${base}/${v.id}/price-items/${v.rent}`, { price: '960000', reason: 'Koreksi sumber' })).status).toBe(409);
    expect((await t.prisma.priceItem.findUniqueOrThrow({ where: { id: v.rent } })).price.toString()).toBe('800000');
    expect((await t.prisma.ahspComponent.findUniqueOrThrow({ where: { id: reference.id } })).unitPrice.toString()).toBe('100000');
  });

  it('corrects the work item of an MC-0 row to the Kontrak work item, rejecting duplicates and foreign ones', async () => {
    const v = await packagedContract();
    const mc0 = await ok(admin.post(base, { versionType: 'MC' }), 201);
    const section = (await admin.get(`${base}/${mc0.version.id}`)).body.rows[0].id;
    const added = await ok(admin.post(`${base}/${mc0.version.id}/items`, { rowType: 'ITEM', parentId: section, description: 'kWh meter', volume: '1', unit: 'bh', unitPrice: '100', taxPercent: '11' }), 201);
    const kwh = row(added, 'kWh meter');
    const contract = (await admin.get(`${base}/${v.id}`)).body;
    const target = row(contract, 'Pekerjaan C');
    const used = row(contract, 'Pekerjaan B');

    expect((await admin.post(`${base}/${mc0.version.id}/items/${kwh.id}/work-item`, { workItemId: used.workItemId })).status).toBe(409);
    expect((await admin.post(`${base}/${mc0.version.id}/items/${kwh.id}/work-item`, { workItemId: kwh.workItemId })).status).toBe(400);
    expect((await admin.post(`${base}/${v.id}/items/${target.id}/work-item`, { workItemId: used.workItemId })).status).toBe(409); // Kontrak is approved
    // The duplicate WI-C row must leave first: here the MC-0 copy of C is moved off WI-C by deleting it.
    const copyOfC = row((await admin.get(`${base}/${mc0.version.id}`)).body, 'Pekerjaan C');
    await ok(admin.delete(`${base}/${mc0.version.id}/items/${copyOfC.id}`));
    const corrected = await ok(admin.post(`${base}/${mc0.version.id}/items/${kwh.id}/work-item`, { workItemId: target.workItemId, reason: 'kWh meter = pekerjaan C' }));
    expect(row(corrected, 'kWh meter')).toMatchObject({ workItemCode: target.workItemCode });
    const stored = await t.prisma.rabVersionItem.findUniqueOrThrow({ where: { id: kwh.id } });
    expect(stored.previousVersionItemId).toBe(target.id);
    expect(await t.prisma.workItem.count({ where: { id: kwh.workItemId } })).toBe(1); // old WI kept
    expect(await t.prisma.auditLog.count({ where: { action: 'CORRECT_RAB_WORK_ITEM' } })).toBe(1);
  });

  it('a row approved before cannot be deleted during a correction; a row added in it can', async () => {
    const v = await packagedContract();
    await ok(reopen(v.id));
    const detail = (await admin.get(`${base}/${v.id}`)).body;
    expect((await admin.delete(`${base}/${v.id}/items/${row(detail, 'Pekerjaan C').id}`, { reason: 'hapus' })).status).toBe(409);
    const added = await ok(admin.post(`${base}/${v.id}/items`, { rowType: 'ITEM', parentId: detail.rows[0].id, description: 'Baru', volume: '1', unit: 'ls', unitPrice: '1', taxPercent: '11', reason: 'Item tertinggal' }), 201);
    expect(row(added, 'Baru').sourceLocator).toMatchObject({ corrections: [{ kind: 'MANUAL', reason: 'Item tertinggal' }] });
    await ok(admin.delete(`${base}/${v.id}/items/${row(added, 'Baru').id}`, { reason: 'batal' }));
  });

  it('cancelling a correction restores the last approved snapshot exactly and keeps the history (D-070)', async () => {
    const v = await packagedContract();
    const [first] = (await ok(admin.get(`${base}/${v.id}/history`))).snapshots;
    const approved = (await admin.get(`${base}/${v.id}`)).body;
    expect((await admin.post(`${base}/${v.id}/cancel-correction`, { reason: 'Belum dibuka' })).status).toBe(409); // not reopened

    await ok(reopen(v.id));
    const open = (await admin.get(`${base}/${v.id}`)).body;
    const parentId = row(open, 'Pekerjaan A').parentId;
    const siblings = open.rows.filter((r: Row) => r.parentId === parentId).map((r: Row) => r.id);
    await ok(admin.post(`${base}/${v.id}/items/reorder`, { parentId, itemIds: [...siblings].reverse() }));
    await ok(admin.patch(`${base}/${v.id}/items/${row(open, 'Pekerjaan C').id}`, { volume: '3', description: 'Pekerjaan C ubah', reason: 'Ukur ulang' }));
    await ok(admin.patch(`${base}/${v.id}`, { documentNumber: 'BARU/1', documentDate: '2026-11-01', reason: 'Nomor salah' }));
    await ok(admin.patch(`${base}/${v.id}/price-items/${v.labor}`, { price: '110000', reason: 'Upah sesuai SK' }));
    await ok(admin.patch(`${base}/${v.id}/components/${v.components.rent}`, { coefficient: '0.6', reason: 'Koefisien' }));
    await ok(admin.patch(`${base}/${v.id}/analysis-versions/${v.main}`, { overheadPercent: '', reason: 'Tanpa overhead' }));
    const added = await ok(admin.post(`${base}/${v.id}/items`, { rowType: 'ITEM', parentId, description: 'Baru', volume: '1', unit: 'ls', unitPrice: '1', taxPercent: '11', reason: 'Item tertinggal' }), 201);
    const addedWorkItem = row(added, 'Baru').workItemId;

    expect((await admin.post(`${base}/${v.id}/cancel-correction`, {})).status).toBe(400); // reason required
    const restored = await ok(admin.post(`${base}/${v.id}/cancel-correction`, { reason: 'Tidak jadi dikoreksi' }));
    expect(restored.version).toMatchObject({ status: 'APPROVED', documentNumber: approved.version.documentNumber, documentDate: approved.version.documentDate });
    expect(restored.rows).toEqual(approved.rows);
    expect(restored.totals).toEqual(approved.totals);
    expect(await t.prisma.workItem.count({ where: { id: addedWorkItem } })).toBe(0);
    expect((await t.prisma.priceItem.findUniqueOrThrow({ where: { id: v.labor } })).price.toString()).toBe('100000');
    expect((await t.prisma.ahspAnalysisVersion.findUniqueOrThrow({ where: { id: v.main } })).overheadPercent?.toString()).toBe('10');

    // No new snapshot; the corrections and the cancellation stay in the history.
    const history = await ok(admin.get(`${base}/${v.id}/history`));
    expect(history.snapshots.map((s: { id: string }) => s.id)).toEqual([first.id]);
    expect(history.events.at(-1)).toMatchObject({ action: 'CANCEL_RAB_CORRECTION', reason: 'Tidak jadi dikoreksi', newValue: { restoredSnapshot: 1, removedRows: 1 } });
    // Reopening again starts from the restored state.
    await ok(reopen(v.id));
    expect((await admin.get(`${base}/${v.id}`)).body.rows).toEqual(approved.rows);
  });

  it('reorders a reopened version without a reason: audited, no correction mark, still needs rab.reopen', async () => {
    const v = await packagedContract();
    await ok(reopen(v.id));
    const detail = (await admin.get(`${base}/${v.id}`)).body;
    const parentId = row(detail, 'Pekerjaan A').parentId;
    const siblings = detail.rows.filter((r: { parentId: string | null }) => r.parentId === parentId).map((r: { id: string }) => r.id);
    const reordered = await ok(admin.post(`${base}/${v.id}/items/reorder`, { parentId, itemIds: [...siblings].reverse() }));
    const after = reordered.rows.filter((r: { parentId: string | null }) => r.parentId === parentId);
    expect(after.map((r: { id: string }) => r.id)).toEqual([...siblings].reverse());
    expect(after.every((r: { sourceLocator: { corrections?: unknown } | null }) => !r.sourceLocator?.corrections)).toBe(true);
    const audit = await t.prisma.auditLog.findFirst({ where: { entityId: v.id, action: 'CORRECT_RAB_ITEM' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.newValue).toMatchObject({ operation: 'REORDER' });
  });
});
