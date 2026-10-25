import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../ai/ai.client';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';
import { RabImportsService } from './rab-imports.service';
import { analysisBlock, rabSheet, recap, recapLookup, xlsxOf } from './test-workbook';

let t: TestApp;
let admin: Client;
let adminId: string;
let project: { id: string };
let base: string;
const aiCalls: unknown[] = [];
let aiReply: (input: string) => unknown = () => null;

/** Mock 9router client: records prompts, answers what the test sets. */
const mockAi = {
  async completeJson(_schema: unknown, messages: { content: string }[]) {
    aiCalls.push(messages);
    const result = aiReply(messages.at(-1)!.content);
    const now = new Date();
    return {
      result,
      model: result ? 'mock-primary' : null,
      attempts: result
        ? [{ model: 'mock-primary', attempt: 1, status: 'SUCCEEDED', error: null, response: result, startedAt: now, finishedAt: now }]
        : [
            { model: 'mock-primary', attempt: 1, status: 'FAILED', error: 'timeout', response: null, startedAt: now, finishedAt: now },
            { model: 'mock-fallback', attempt: 1, status: 'FAILED', error: 'HTTP 502', response: null, startedAt: now, finishedAt: now },
          ],
    };
  },
} as unknown as AiClient;

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

// Contract workbook: main analysis P.1 (with sub-analysis M.1 and a scaled rental price), an unused analysis U.9,
// one direct (literal) price, and price list sheet UPAH.
const sub = analysisBlock(40, { seq: 2, code: 'M.1', name: 'MORTAR 1:4', unit: 'm3', components: [{ category: 'BAHAN', name: 'Semen', unit: 'kg', coef: 400, price: ['VLOOKUP(C43,UPAH!B$2:C$20,2,FALSE)', 1500] }] });
const main = analysisBlock(5, {
  seq: 1,
  code: 'P.1',
  name: '1 M2 PASANGAN BATA MERAH',
  unit: 'm2',
  components: [
    { category: 'TENAGA', name: 'Tukang Batu', unit: 'OH', coef: 0.1, price: ['VLOOKUP(C8,UPAH!B$2:C$20,2,FALSE)', 160000] },
    { category: 'BAHAN', name: 'Mortar', unit: 'm3', coef: 0.05, price: ["'REKAP ANALISA'!E7", 660000] },
    { category: 'PERALATAN', name: 'Sewa Molen', unit: 'jam', coef: 0.1, price: ['VLOOKUP(C14,UPAH!B$2:C$20,2,FALSE)/8', 50000] },
  ],
});
const unused = analysisBlock(80, { seq: 3, code: 'U.9', name: 'TIDAK DIPAKAI', unit: 'm2', components: [{ category: 'TENAGA', name: 'Mandor', unit: 'OH', coef: 1, price: ['VLOOKUP(C83,UPAH!B$2:C$20,2,FALSE)', 220000] }] });
// (0.1×160000 + 0.05×660000 + 0.1×50000) × 1.1 = 59400
const MAIN_PRICE = 59400;
const upah = { B2: 'Tukang Batu', C2: 160000, B3: 'Semen', C3: 1500, B4: 'Sewa Molen', C4: 400000, B5: 'Mandor', C5: 220000, B1: 'Lokasi', C1: 'Denpasar' };

function contractBook(rabPrice = MAIN_PRICE) {
  return xlsxOf({
    'RAB + PPN': rabSheet([
      { no: 'A', desc: 'PEKERJAAN DINDING' },
      { no: 1, desc: 'Pek. Pasangan Dinding Bata', vol: 10, unit: 'm2', code: 'P.1', price: recapLookup(14, rabPrice) },
      { no: 2, desc: 'Papan nama proyek', vol: 1, unit: 'bh', price: 500000 },
    ]),
    'REKAP ANALISA': {
      ...recap([
        { seq: 1, code: 'P.1', price: MAIN_PRICE },
        { seq: 2, code: 'M.1', price: sub.price },
        { seq: 3, code: 'U.9', price: unused.price },
      ]),
      ...(rabPrice !== MAIN_PRICE ? { E6: ['ROUND(VLOOKUP(A6,ANALISA!A$5:H$500,8,FALSE),0)', rabPrice] as [string, number] } : {}),
    },
    ANALISA: { ...main.cells, ...sub.cells, ...unused.cells },
    UPAH: upah,
  });
}

async function upload(c: Client, name: string, data: Buffer) {
  const res = await c.upload(`/projects/${project.id}/documents`, [{ name, data }]);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body[0] as { id: string; rabSheetCandidates: string[] };
}

async function runImport(c: Client, body: Record<string, unknown>) {
  const res = await c.post(base, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await t.app.get(RabImportsService).waitFor(res.body.id);
  return (await c.get(`${base}/${res.body.id}`)).body;
}

beforeAll(async () => {
  t = await startApp({ ai: mockAi });
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  Object.assign(t.app.get(LoginRateLimiter), new LoginRateLimiter());
  aiCalls.length = 0;
  aiReply = () => null;
  adminId = (await createUser(t.prisma, { email: 'admin@example.com', name: 'Super', isSystemAdmin: true })).id;
  admin = await loggedIn('admin@example.com');
  project = await createProject(t.prisma, 'IMP-001');
  base = `/projects/${project.id}/rab-imports`;
});

describe('documents and permissions (D-049)', () => {
  it('ADMIN uploads and reviews but cannot approve; FILLER cannot upload; outsiders get 404; only .xlsx', async () => {
    const filler = await member('FILLER');
    const projectAdmin = await member('ADMIN');
    expect((await filler.upload(`/projects/${project.id}/documents`, [{ name: 'a.xlsx', data: await contractBook() }])).status).toBe(403);
    expect((await projectAdmin.upload(`/projects/${project.id}/documents`, [{ name: 'a.pdf', data: Buffer.from('%PDF-1.4') }])).status).toBe(400);

    const doc = await upload(projectAdmin, 'RAB Dinding.xlsx', await contractBook());
    expect(doc.rabSheetCandidates).toEqual(['RAB + PPN']);
    const stored = await t.prisma.projectDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await filler.get(`/projects/${project.id}/documents`)).status).toBe(403);
    const download = await fetch(`${t.baseUrl}/projects/${project.id}/documents/${doc.id}/download`, { headers: { cookie: projectAdmin.cookie! } });
    expect(download.status).toBe(200);

    const detail = await runImport(projectAdmin, { targetVersionType: 'CONTRACT', sources: [{ documentId: doc.id }] });
    expect(detail.import.status).toBe('NEEDS_REVIEW');
    expect((await projectAdmin.post(`${base}/${detail.import.id}/approve`)).status).toBe(403);
    expect((await filler.get(base)).status).toBe(403);

    const outsider = await createUser(t.prisma, { email: 'luar@example.com' });
    expect(outsider).toBeTruthy();
    expect((await (await loggedIn('luar@example.com')).get(base)).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { action: 'UPLOAD_DOCUMENT' } })).toBe(1);
  });
});

describe('contract import → approval', () => {
  it('imports only used analyses/prices with sub-analyses, links RAB items, and keeps the recap name (D-046, D-047)', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const detail = await runImport(admin, { targetVersionType: 'CONTRACT', sources: [{ documentId: doc.id }] });
    expect(detail.import).toMatchObject({ status: 'NEEDS_REVIEW', guideVersion: 'rab-import-guide@1', blockingIssues: 0 });
    expect(detail.draft.stats).toMatchObject({ items: 2, analysesInWorkbook: 3, analysesImported: 2, subAnalyses: 1, components: 4, pricesImported: 3 });
    expect(detail.issues.map((i: { code: string }) => i.code)).toContain('DIRECT_PRICE');
    expect(detail.reconciliation).toMatchObject({ realCost: '1214340.00', matches: null });

    const approved = await admin.post(`${base}/${detail.import.id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.import.status).toBe('APPROVED');

    const priceLists = await t.prisma.priceList.findMany({ include: { items: true } });
    expect(priceLists).toHaveLength(1);
    expect(priceLists[0]).toMatchObject({ versionNumber: 1, location: 'Denpasar' });
    expect(priceLists[0]!.items.map((i) => i.name).sort()).toEqual(['Semen', 'Sewa Molen', 'Tukang Batu']); // Mandor (unused analysis) not imported
    const versions = await t.prisma.ahspAnalysisVersion.findMany({ include: { components: { orderBy: { sortOrder: 'asc' } } } });
    expect(versions.map((v) => [v.code, v.name, v.price.toString()]).sort()).toEqual([
      ['M.1', 'MORTAR 1:4', '660000'],
      ['P.1', '1 M2 PASANGAN BATA MERAH', '59400'],
    ]);
    const p1 = versions.find((v) => v.code === 'P.1')!;
    const m1 = versions.find((v) => v.code === 'M.1')!;
    expect(p1.components.map((c) => [c.description, c.unitPrice.toString(), c.subAnalysisVersionId])).toEqual([
      ['Tukang Batu', '160000', null],
      ['Mortar', '660000', m1.id],
      ['Sewa Molen', '50000', null],
    ]);

    const rab = await t.prisma.rabVersion.findFirstOrThrow({ where: { projectId: project.id } });
    expect(rab).toMatchObject({ versionType: 'CONTRACT', status: 'DRAFT' });
    const items = await t.prisma.rabVersionItem.findMany({ where: { rabVersionId: rab.id, rowType: 'ITEM' }, orderBy: { sortOrder: 'asc' } });
    expect(items.map((i) => [i.description, i.priceSource, i.analysisVersionId, i.unitPrice?.toString()])).toEqual([
      ['Pek. Pasangan Dinding Bata', 'ANALYSIS', p1.id, '59400'],
      ['Papan nama proyek', 'DIRECT', null, '500000'],
    ]);
    expect(await t.prisma.auditLog.findFirst({ where: { action: 'APPROVE_RAB_IMPORT' } })).toMatchObject({ newValue: expect.objectContaining({ analyses: 2, subAnalyses: 1, components: 4 }) });

    // Approval of the RAB itself still goes through M4; the linked price cannot be edited directly.
    const rabBase = `/projects/${project.id}/rab-versions/${rab.id}`;
    expect((await admin.patch(`${rabBase}/items/${items[0]!.id}`, { unitPrice: '1' })).status).toBe(409);
    expect((await admin.post(`${rabBase}/approve`, { acknowledgeWarnings: true })).status).toBe(200);
    const grid = (await admin.get(rabBase)).body;
    expect(grid.rows.find((r: { description: string }) => r.description === 'Pek. Pasangan Dinding Bata').analysis).toMatchObject({ code: 'P.1', versionId: p1.id });

    // Combined analysis list.
    const list = (await admin.get(`/projects/${project.id}/analyses`)).body;
    expect(list.map((a: { code: string; latestVersion: { rabItems: number; usedAsSub: number } }) => [a.code, a.latestVersion.rabItems, a.latestVersion.usedAsSub])).toEqual([
      ['M.1', 0, 1],
      ['P.1', 1, 0],
    ]);
  });

  it('price mismatch blocks approval and writes nothing until a reviewer chooses; override needs a reason (D-051)', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook(60000));
    const detail = await runImport(admin, { targetVersionType: 'CONTRACT', sources: [{ documentId: doc.id }] });
    const row = detail.draft.rows.find((r: { description: string }) => r.description === 'Pek. Pasangan Dinding Bata');
    expect(detail.issues).toContainEqual(expect.objectContaining({ code: 'PRICE_MISMATCH', rowKey: row.key }));
    const blocked = await admin.post(`${base}/${detail.import.id}/approve`);
    expect(blocked.status).toBe(409);
    expect(await t.prisma.rabVersion.count()).toBe(0);
    expect(await t.prisma.ahspAnalysis.count()).toBe(0);

    const decisions = `${base}/${detail.import.id}/decisions`;
    expect((await admin.post(decisions, { decisions: [{ rowKey: row.key, kind: 'PRICE_CHOICE', value: { source: 'SOURCE_OVERRIDE' } }] })).status).toBe(400);
    expect((await admin.post(decisions, { decisions: [{ rowKey: row.key, kind: 'PRICE_CHOICE', value: { source: 'SOURCE_OVERRIDE' }, reason: 'Harga negosiasi kontrak' }] })).status).toBe(200);
    expect((await admin.post(`${base}/${detail.import.id}/approve`)).status).toBe(200);
    const item = await t.prisma.rabVersionItem.findFirstOrThrow({ where: { description: 'Pek. Pasangan Dinding Bata' } });
    expect(item).toMatchObject({ priceSource: 'SOURCE_OVERRIDE', priceNote: 'Harga negosiasi kontrak', priceDecidedBy: adminId });
    expect([item.unitPrice?.toString(), item.sourceUnitPrice?.toString(), item.analysisUnitPrice?.toString()]).toEqual(['60000', '60000', '59400']);
  });
});

describe('MC-0 import with reviewer decisions (D-053)', () => {
  it('links rows to official analyses and work items only through recorded decisions; approved history unchanged', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const contract = await runImport(admin, { targetVersionType: 'CONTRACT', sources: [{ documentId: doc.id }] });
    await admin.post(`${base}/${contract.import.id}/approve`);
    const contractRab = await t.prisma.rabVersion.findFirstOrThrow({ where: { projectId: project.id } });
    await admin.post(`/projects/${project.id}/rab-versions/${contractRab.id}/approve`, { acknowledgeWarnings: true });
    const p1 = await t.prisma.ahspAnalysisVersion.findFirstOrThrow({ where: { code: 'P.1' } });

    // MC-0 workbook: recap holds values only (no analysis sheet), volume changed.
    const mc0Doc = await upload(
      admin,
      'mc0.xlsx',
      await xlsxOf({
        'RAB + PPN': rabSheet([
          { no: 'A', desc: 'PEKERJAAN DINDING' },
          { no: 1, desc: 'Pek. Pasangan Dinding Bata', vol: 12, unit: 'm2', code: 'P.1', price: recapLookup(14, MAIN_PRICE) },
          { no: 2, desc: 'Papan nama proyek', vol: 1, unit: 'bh', price: 500000 },
        ]),
        'REKAP ANALISA': { B6: 'P.1', E6: MAIN_PRICE },
      }),
    );
    const mc0 = await runImport(admin, { targetVersionType: 'MC0', sources: [{ documentId: mc0Doc.id }] });
    const [bata, papan] = mc0.draft.rows.filter((r: { rowType: string }) => r.rowType === 'ITEM');
    expect(bata.price.kind).toBe('UNRESOLVED');
    expect(bata.analysisCandidates).toEqual([expect.objectContaining({ analysisVersionId: p1.id, origin: 'RULE' })]);
    expect(bata.workItemCandidates).toHaveLength(1);
    expect(mc0.issues.filter((i: { severity: string }) => i.severity === 'BLOCKING').map((i: { code: string }) => i.code).sort()).toEqual([
      'ANALYSIS_UNRESOLVED',
      'WORK_ITEM_UNDECIDED',
      'WORK_ITEM_UNDECIDED',
    ]);
    // Rule candidates are never applied without a decision.
    expect((await admin.post(`${base}/${mc0.import.id}/approve`)).status).toBe(409);

    const res = await admin.post(`${base}/${mc0.import.id}/decisions`, {
      decisions: [
        { rowKey: bata.key, kind: 'ANALYSIS_LINK', value: { analysisVersionId: p1.id }, reason: 'Kode, satuan, harga sama dengan analisa Kontrak' },
        { rowKey: bata.key, kind: 'WORK_ITEM_MATCH', value: { workItemId: bata.workItemCandidates[0].workItemId } },
        { rowKey: papan.key, kind: 'WORK_ITEM_MATCH', value: { workItemId: papan.workItemCandidates[0].workItemId } },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.import.blockingIssues).toBe(0);
    expect((await admin.post(`${base}/${mc0.import.id}/approve`)).status).toBe(200);

    const mc0Rab = await t.prisma.rabVersion.findFirstOrThrow({ where: { versionType: 'MC0' } });
    const mc0Item = await t.prisma.rabVersionItem.findFirstOrThrow({ where: { rabVersionId: mc0Rab.id, description: 'Pek. Pasangan Dinding Bata' } });
    const contractItem = await t.prisma.rabVersionItem.findFirstOrThrow({ where: { rabVersionId: contractRab.id, description: 'Pek. Pasangan Dinding Bata' } });
    expect(mc0Item).toMatchObject({ analysisVersionId: p1.id, workItemId: contractItem.workItemId, priceSource: 'ANALYSIS' });
    expect((await admin.get(`/projects/${project.id}/rab-versions/${contractRab.id}/compare/${mc0Rab.id}`)).body.rows.map((r: { change: string }) => r.change)).toEqual(['MODIFIED', 'UNCHANGED']);
    // No new analyses or price list for a version that only links official ones.
    expect(await t.prisma.priceList.count()).toBe(1);
    expect((await t.prisma.rabImport.findUniqueOrThrow({ where: { id: mc0.import.id } })).priceListId).toBeNull();
    // The approved contract still points at the same analysis version.
    expect((await t.prisma.rabVersionItem.findUniqueOrThrow({ where: { id: contractItem.id } })).analysisVersionId).toBe(p1.id);
    expect(await t.prisma.rabImportDecision.count({ where: { importId: mc0.import.id } })).toBe(3);
  });
});

describe('failures, retry, rejection, AI', () => {
  it('ambiguous sheet → FAILED; retry is a new run linked to the old one; rejection needs a reason', async () => {
    const book = await xlsxOf({ 'RAB A': rabSheet([{ no: 'A', desc: 'P' }]), 'RAB B': rabSheet([{ no: 'A', desc: 'P' }]) });
    const doc = await upload(admin, 'dua-sheet.xlsx', book);
    const failed = await runImport(admin, { targetVersionType: 'CONTRACT', sources: [{ documentId: doc.id }] });
    expect(failed.import).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('pilih sheet RAB') });
    const retry = await admin.post(`${base}/${failed.import.id}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ attemptNumber: 2, previousImportId: failed.import.id });
    await t.app.get(RabImportsService).waitFor(retry.body.id);
    expect((await t.prisma.rabImport.findUniqueOrThrow({ where: { id: failed.import.id } })).status).toBe('FAILED');

    const good = await upload(admin, 'rab.xlsx', await contractBook());
    const run = await runImport(admin, { targetVersionType: 'CONTRACT', sources: [{ documentId: good.id }] });
    expect((await admin.post(`${base}/${run.import.id}/reject`, {})).status).toBe(400);
    expect((await admin.post(`${base}/${run.import.id}/reject`, { reason: 'Salah file' })).body.import).toMatchObject({ status: 'REJECTED', rejectReason: 'Salah file' });
    expect((await admin.post(`${base}/${run.import.id}/approve`)).status).toBe(409);
  });

  it('AI suggestions only come from offered official analyses and are recorded; failures fall back to manual review', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const contract = await runImport(admin, { targetVersionType: 'CONTRACT', sources: [{ documentId: doc.id }] });
    await admin.post(`${base}/${contract.import.id}/approve`);
    const contractRab = await t.prisma.rabVersion.findFirstOrThrow({});
    await admin.post(`/projects/${project.id}/rab-versions/${contractRab.id}/approve`, { acknowledgeWarnings: true });
    const p1 = await t.prisma.ahspAnalysisVersion.findFirstOrThrow({ where: { code: 'P.1' } });

    // Code and price differ, so no rule candidate; only the AI can suggest.
    const mc0Book = await xlsxOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN DINDING' },
        { no: 1, desc: 'Pek. Pasangan Dinding Bata', vol: 12, unit: 'm2', code: 'X.7', price: recapLookup(14, 59000) },
      ]),
      'REKAP ANALISA': { B6: 'X.7', E6: 59000 },
    });
    aiReply = (prompt) => (prompt.includes(p1.id) ? { suggestions: [{ rowKey: '0:14', candidateIds: [p1.id, 'invented-id'], reason: 'uraian sama' }] } : null);
    const mc0Doc = await upload(admin, 'mc0.xlsx', mc0Book);
    const withAi = await runImport(admin, { targetVersionType: 'MC0', sources: [{ documentId: mc0Doc.id }] });
    const row = withAi.draft.rows.find((r: { key: string }) => r.key === '0:14');
    expect(row.analysisCandidates).toEqual([expect.objectContaining({ analysisVersionId: p1.id, origin: 'AI' })]);
    expect(withAi.aiRuns).toEqual([expect.objectContaining({ model: 'mock-primary', status: 'SUCCEEDED', instructionVersion: 'rab-import-guide@1' })]);
    expect(JSON.stringify(aiCalls)).toContain('rab-import-guide@1');

    aiReply = () => null;
    const noAi = await runImport(admin, { targetVersionType: 'MC0', sources: [{ documentId: mc0Doc.id }] });
    expect(noAi.import.status).toBe('NEEDS_REVIEW');
    expect(noAi.aiRuns.map((r: { model: string; status: string }) => [r.model, r.status])).toEqual([
      ['mock-primary', 'FAILED'],
      ['mock-fallback', 'FAILED'],
    ]);
  });

  it('runs left PROCESSING by a stopped server become FAILED on start', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const stuck = await t.prisma.rabImport.create({
      data: { projectId: project.id, targetVersionType: 'CONTRACT', status: 'PROCESSING', guideVersion: 'rab-import-guide@1', parserVersion: 'x', createdBy: adminId, documents: { create: [{ documentId: doc.id }] } },
    });
    await t.app.get(RabImportsService).onModuleInit();
    expect((await t.prisma.rabImport.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe('FAILED');
  });
});
