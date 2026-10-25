import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;
let project: { id: string };
let base: string;

async function loggedIn(email: string): Promise<Client> {
  const c = new Client(t.baseUrl);
  expect((await c.login(email, TEST_PASSWORD)).status).toBe(200);
  return c;
}

async function member(code: string): Promise<Client> {
  const email = `role-${code.toLowerCase()}@example.com`;
  const u = await createUser(t.prisma, { email });
  await admin.post(`/admin/projects/${project.id}/members`, { userId: u.id, roleId: await roleId(t.prisma, code) });
  return loggedIn(email);
}

async function ok(res: Promise<ApiResponse>, status = 201) {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** Contract with two sections: I (item 1, parent P with item 2) and II (item 3). */
async function contract(c: Client = admin) {
  const v = await ok(c.post(base, { versionType: 'CONTRACT', documentNumber: 'KTR/1', documentDate: '2026-05-20' }));
  const add = async (body: Record<string, unknown>) => {
    const detail = await ok(c.post(`${base}/${v.version.id}/items`, body));
    return detail.rows.at(-1)?.id as string;
  };
  const rowId = async (description: string) => (await c.get(`${base}/${v.version.id}`)).body.rows.find((r: { description: string }) => r.description === description).id;
  await add({ rowType: 'SECTION', displayNumber: 'I', description: 'Pekerjaan Persiapan' });
  const s1 = await rowId('Pekerjaan Persiapan');
  await add({ rowType: 'ITEM', parentId: s1, displayNumber: '1', description: 'Mobilisasi', volume: '1', unit: 'ls', unitPrice: '5000000', taxPercent: '11' });
  await add({ rowType: 'PARENT_ITEM', parentId: s1, displayNumber: '2', description: 'Pembersihan' });
  const p = await rowId('Pembersihan');
  await add({ rowType: 'ITEM', parentId: p, displayNumber: 'a', description: 'Galian tanah', volume: '39.39', unit: 'm3', analysisCode: 'A.2.3', unitPrice: '125000.50', taxPercent: '11' });
  await add({ rowType: 'SECTION', displayNumber: 'II', description: 'Pekerjaan Struktur' });
  const s2 = await rowId('Pekerjaan Struktur');
  await add({ rowType: 'ITEM', parentId: s2, displayNumber: '1', description: 'Beton K-250', volume: '100', unit: 'm3', unitPrice: '1250000', taxPercent: '11' });
  return { id: v.version.id as string, rowId };
}

const approve = (versionId: string, acknowledgeWarnings = true, c: Client = admin) => c.post(`${base}/${versionId}/approve`, { acknowledgeWarnings });

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
  project = await createProject(t.prisma, 'RAB-001');
  base = `/projects/${project.id}/rab-versions`;
});

describe('permissions (D-041)', () => {
  it('FILLER reads, ADMIN edits but cannot approve, MANAGER approves, outsiders get 404', async () => {
    const filler = await member('FILLER');
    const projectAdmin = await member('ADMIN');
    const manager = await member('MANAGER');

    expect((await filler.post(base, { versionType: 'CONTRACT' })).status).toBe(403);
    const v = await contract(projectAdmin);
    expect((await filler.get(`${base}/${v.id}`)).status).toBe(200);
    expect((await filler.get(base)).body).toHaveLength(1);
    expect((await approve(v.id, true, projectAdmin)).status).toBe(403);
    expect((await approve(v.id, true, manager)).status).toBe(200);

    const outsider = await createUser(t.prisma, { email: 'luar@example.com' });
    expect(outsider).toBeTruthy();
    expect((await (await loggedIn('luar@example.com')).get(base)).status).toBe(404);
  });
});

describe('contract draft and approval', () => {
  it('computes rows and totals, blocks errors, requires acknowledged warnings, and stores the snapshot', async () => {
    const v = await contract();
    const detail = (await admin.get(`${base}/${v.id}`)).body;
    expect(detail.rows.map((r: { displayNumber: string; depth: number }) => [r.displayNumber, r.depth])).toEqual([
      ['I', 0],
      ['1', 1],
      ['2', 1],
      ['a', 2],
      ['II', 0],
      ['1', 1],
    ]);
    const galian = detail.rows.find((r: { description: string }) => r.description === 'Galian tanah');
    // 125000.50 × 1.11 = 138750.555 -> 138750.56; × 39.39 = 5465384.5584 -> 5465384.56
    expect(galian).toMatchObject({ unitPriceWithTax: '138750.56', subtotal: '5465384.56', volume: '39.3900', workItemCode: 'WI-0002' });
    expect(detail.totals).toEqual({ beforeTax: '134923769.70', tax: '14841614.86', value: '149765384.56' });
    // Project contract value (test fixture has none) -> only the volume/structure checks apply.
    expect(detail.issues).toEqual({ errors: [], warnings: [] });

    // Missing unit -> blocking error.
    const beton = await v.rowId('Beton K-250');
    await ok(admin.patch(`${base}/${v.id}/items/${beton}`, { unit: '' }), 200);
    const blocked = await approve(v.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.errors[0].message).toContain('satuan');
    await ok(admin.patch(`${base}/${v.id}/items/${beton}`, { unit: 'm3' }), 200);

    // Contract value mismatch -> warning that must be acknowledged.
    await t.prisma.project.update({ where: { id: project.id }, data: { contractValue: '150000000.00' } });
    const warned = await approve(v.id, false);
    expect(warned.status).toBe(409);
    expect(warned.body.warnings[0].message).toContain('berbeda dengan nilai kontrak');

    const approved = await ok(approve(v.id, true), 200);
    expect(approved.version).toMatchObject({ status: 'APPROVED', label: 'Kontrak', totals: { value: '149765384.56' }, approvedBy: { name: 'Super' } });
    const stored = await t.prisma.rabVersionItem.findMany({ where: { rabVersionId: v.id, rowType: 'ITEM' } });
    expect(stored.every((i) => i.subtotal !== null && i.weight !== null && i.unitPriceWithTax !== null)).toBe(true);
    expect(stored.reduce((sum, i) => sum + Number(i.weight), 0)).toBeCloseTo(100, 6);
    const version = await t.prisma.rabVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(version.totalValue?.toFixed(2)).toBe('149765384.56');

    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'APPROVE_RAB_VERSION' } });
    expect(audit.newValue).toMatchObject({ status: 'APPROVED', value: '149765384.56', itemCount: 3, acknowledgedWarnings: [expect.stringContaining('nilai kontrak')] });
  });

  it('protects an approved version from every write', async () => {
    const v = await contract();
    await ok(approve(v.id), 200);
    const item = await v.rowId('Beton K-250');
    const before = await t.prisma.rabVersionItem.findMany({ where: { rabVersionId: v.id }, orderBy: { id: 'asc' } });

    for (const res of [
      admin.patch(`${base}/${v.id}`, { documentNumber: 'X' }),
      admin.post(`${base}/${v.id}/items`, { rowType: 'SECTION', description: 'Baru' }),
      admin.patch(`${base}/${v.id}/items/${item}`, { volume: '1' }),
      admin.delete(`${base}/${v.id}/items/${item}`),
      admin.post(`${base}/${v.id}/items/${item}/move`, { direction: 'up' }),
      approve(v.id),
      admin.post(`${base}/${v.id}/discard`, { reason: 'Batal' }),
    ]) {
      expect((await res).status).toBe(409);
    }
    expect(await t.prisma.rabVersionItem.findMany({ where: { rabVersionId: v.id }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('blocks approval when amounts would overflow DECIMAL(20,2) (regression)', async () => {
    const v = await ok(admin.post(base, { versionType: 'CONTRACT' }));
    // Each input is valid on its own; price + tax and volume × price exceed 18 integer digits.
    await ok(admin.post(`${base}/${v.version.id}/items`, { rowType: 'ITEM', description: 'Mahal', volume: '1', unit: 'ls', unitPrice: '999999999999999999.99', taxPercent: '11' }));
    await ok(admin.post(`${base}/${v.version.id}/items`, { rowType: 'ITEM', description: 'Banyak', volume: '99999999999999.9999', unit: 'm3', unitPrice: '99999', taxPercent: '0' }));
    const res = await approve(v.version.id);
    expect(res.status).toBe(409);
    expect(res.body.errors.map((e: { message: string }) => e.message)).toEqual([
      expect.stringContaining('Mahal: harga + PPN melebihi batas'),
      expect.stringContaining('Banyak: jumlah (volume × harga + PPN) melebihi batas'),
      expect.stringContaining('Total RAB melebihi batas'),
    ]);
    expect((await t.prisma.rabVersion.findUniqueOrThrow({ where: { id: v.version.id } })).status).toBe('DRAFT');
  });

  it('validates decimals and item-only fields', async () => {
    const v = await ok(admin.post(base, { versionType: 'CONTRACT' }));
    const items = `${base}/${v.version.id}/items`;
    for (const bad of [
      { rowType: 'ITEM', description: 'X', volume: '1.12345' },
      { rowType: 'ITEM', description: 'X', unitPrice: '1.000,00' },
      { rowType: 'ITEM', description: 'X', taxPercent: '100.5' },
      { rowType: 'ITEM', description: 'X', volume: '-1' },
      { rowType: 'ITEM', description: ' ' },
      { rowType: 'SUBTOTAL', description: 'X' },
      { rowType: 'SECTION', description: 'X', volume: '1' },
    ]) {
      expect((await admin.post(items, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('hierarchy', () => {
  it('rejects SECTION below the top, ITEM parents, self-parent and descendant-parent (A → B → A regression)', async () => {
    const v = await contract();
    const items = `${base}/${v.id}/items`;
    const section = await v.rowId('Pekerjaan Persiapan');
    const parentItem = await v.rowId('Pembersihan');
    const item = await v.rowId('Mobilisasi');

    expect((await admin.post(items, { rowType: 'SECTION', parentId: section, description: 'X' })).status).toBe(400);
    expect((await admin.post(items, { rowType: 'ITEM', parentId: item, description: 'X' })).status).toBe(400);
    expect((await admin.patch(`${items}/${parentItem}`, { parentId: parentItem })).status).toBe(400);
    // B (sub-section) under A (parent item), then moving A under B would make A → B → A.
    await ok(admin.post(items, { rowType: 'SUBSECTION', parentId: parentItem, description: 'B' }));
    const b = await v.rowId('B');
    expect((await admin.patch(`${items}/${parentItem}`, { parentId: b })).status).toBe(400);
    expect((await admin.get(`${base}/${v.id}`)).status).toBe(200);
    expect((await admin.post(items, { rowType: 'ITEM', parentId: '0192f0f0-0000-7000-8000-000000000000', description: 'X' })).status).toBe(400);
  });

  it('moves rows among siblings and refuses to delete rows that still have children', async () => {
    const v = await contract();
    const section = await v.rowId('Pekerjaan Persiapan');
    const parentItem = await v.rowId('Pembersihan');
    await ok(admin.post(`${base}/${v.id}/items/${parentItem}/move`, { direction: 'up' }), 200);
    const rows = (await admin.get(`${base}/${v.id}`)).body.rows.map((r: { description: string }) => r.description);
    expect(rows.slice(0, 4)).toEqual(['Pekerjaan Persiapan', 'Pembersihan', 'Galian tanah', 'Mobilisasi']);
    expect((await admin.delete(`${base}/${v.id}/items/${section}`)).status).toBe(409);
  });
});

describe('versions and work item identity', () => {
  it('copies the approved version into MC-0, keeps work item ids, and compares NEW/MODIFIED/REMOVED/UNCHANGED', async () => {
    const c = await contract();
    expect((await admin.post(base, { versionType: 'MC0' })).status).toBe(409); // contract not approved yet
    await ok(approve(c.id), 200);
    const contractItems = await t.prisma.rabVersionItem.findMany({ where: { rabVersionId: c.id, rowType: 'ITEM' } });

    const mc0 = await ok(admin.post(base, { versionType: 'MC0' }));
    expect(mc0.version).toMatchObject({ label: 'MC-0', status: 'DRAFT', previousVersionId: c.id });
    const copied = await t.prisma.rabVersionItem.findMany({ where: { rabVersionId: mc0.version.id, rowType: 'ITEM' } });
    expect(copied.map((i) => i.workItemId).sort()).toEqual(contractItems.map((i) => i.workItemId).sort());
    expect(copied.every((i) => contractItems.some((ci) => ci.id === i.previousVersionItemId && ci.workItemId === i.workItemId))).toBe(true);
    expect(copied.every((i) => i.subtotal === null)).toBe(true); // snapshot only after approval

    const row = (d: string) => mc0.rows.find((r: { description: string }) => r.description === d).id;
    const items = `${base}/${mc0.version.id}/items`;
    await ok(admin.patch(`${items}/${row('Beton K-250')}`, { volume: '120' }), 200);
    await ok(admin.delete(`${items}/${row('Mobilisasi')}`), 200);
    await ok(admin.post(items, { rowType: 'ITEM', parentId: row('Pekerjaan Struktur'), description: 'Bekisting', volume: '50', unit: 'm2', unitPrice: '150000', taxPercent: '11' }));

    const compare = (await admin.get(`${base}/${c.id}/compare/${mc0.version.id}`)).body;
    expect(Object.fromEntries(compare.rows.map((r: { workItemCode: string; change: string }) => [r.workItemCode, r.change]))).toEqual({
      'WI-0001': 'REMOVED',
      'WI-0002': 'UNCHANGED',
      'WI-0003': 'MODIFIED',
      'WI-0004': 'NEW',
    });
    // The removed item's work item stays (history); the contract is untouched.
    expect(await t.prisma.workItem.count({ where: { projectId: project.id } })).toBe(4);
    const beton = await t.prisma.rabVersionItem.findFirstOrThrow({ where: { rabVersionId: c.id, description: 'Beton K-250' } });
    expect(beton.volume?.toFixed(4)).toBe('100.0000');
    // Two rows of one version cannot share a work item.
    await expect(t.prisma.rabVersionItem.update({ where: { id: row('Galian tanah') }, data: { workItemId: beton.workItemId } })).rejects.toThrow();
  });

  it('enforces version order and numbers addenda', async () => {
    const c = await contract();
    expect((await admin.post(base, { versionType: 'CONTRACT' })).status).toBe(409); // one draft / one contract
    await ok(approve(c.id), 200);
    expect((await admin.post(base, { versionType: 'CONTRACT' })).status).toBe(409);

    const a1 = await ok(admin.post(base, { versionType: 'ADDENDUM', documentNumber: 'ADD/1' }));
    expect(a1.version).toMatchObject({ label: 'Addendum 1', revisionNumber: 1 });
    await ok(approve(a1.version.id), 200);
    expect((await admin.post(base, { versionType: 'MC0' })).status).toBe(409); // MC-0 only before addenda
    const a2 = await ok(admin.post(base, { versionType: 'ADDENDUM' }));
    expect(a2.version).toMatchObject({ label: 'Addendum 2', previousVersionId: a1.version.id });
  });

  it('allows only one draft per project under concurrent requests', async () => {
    const c = await contract();
    await ok(approve(c.id), 200);
    const results = await Promise.all([1, 2, 3, 4].map(() => admin.post(base, { versionType: 'ADDENDUM' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await t.prisma.rabVersion.count({ where: { projectId: project.id, status: 'DRAFT' } })).toBe(1);
  });

  it('discard needs a reason, keeps the version, and frees the slot for a new draft', async () => {
    const v = await ok(admin.post(base, { versionType: 'CONTRACT' }));
    expect((await admin.post(`${base}/${v.version.id}/discard`, {})).status).toBe(400);
    const discarded = await ok(admin.post(`${base}/${v.version.id}/discard`, { reason: 'Salah input' }), 200);
    expect(discarded.version).toMatchObject({ status: 'DISCARDED', discardReason: 'Salah input' });
    expect((await admin.post(base, { versionType: 'CONTRACT' })).status).toBe(201);
    expect((await admin.get(base)).body.map((x: { status: string }) => x.status)).toEqual(['DISCARDED', 'DRAFT']);
  });

  it('a CLOSED project rejects RAB changes but keeps them readable', async () => {
    const v = await contract();
    await admin.post(`/projects/${project.id}/close`, { reason: 'Selesai' });
    expect((await admin.post(`${base}/${v.id}/items`, { rowType: 'SECTION', description: 'X' })).status).toBe(409);
    expect((await approve(v.id)).status).toBe(409);
    expect((await admin.get(`${base}/${v.id}`)).status).toBe(200);
  });
});
