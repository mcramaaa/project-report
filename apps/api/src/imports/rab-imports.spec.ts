import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentPath, DocumentsService } from '../documents/documents.service';
import type { AiClient } from '../ai/ai.client';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { createProject, createUser, resetDatabase, roleId, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type TestApp } from '../test/http';
import { checkPackageIsolation, copyAnalysesIntoPackage, isIsolated } from '../ahsp/package';
import { GUIDE_VERSION } from './guide/rab-import-guide';
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
        ? [
            {
              model: 'mock-primary',
              attempt: 1,
              status: 'SUCCEEDED',
              error: null,
              response: result,
              startedAt: now,
              finishedAt: now,
            },
          ]
        : [
            {
              model: 'mock-primary',
              attempt: 1,
              status: 'FAILED',
              error: 'timeout',
              response: null,
              startedAt: now,
              finishedAt: now,
            },
            {
              model: 'mock-fallback',
              attempt: 1,
              status: 'FAILED',
              error: 'HTTP 502',
              response: null,
              startedAt: now,
              finishedAt: now,
            },
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
  await admin.post(`/admin/projects/${project.id}/members`, {
    userId: u.id,
    roleId: await roleId(t.prisma, code),
  });
  return loggedIn(email);
}

// Contract workbook: main analysis P.1 (with sub-analysis M.1 and a scaled rental price), an unused analysis U.9,
// one direct (literal) price, and price list sheet UPAH.
const sub = analysisBlock(40, {
  seq: 2,
  code: 'M.1',
  name: 'MORTAR 1:4',
  unit: 'm3',
  components: [
    {
      category: 'BAHAN',
      name: 'Semen',
      unit: 'kg',
      coef: 400,
      price: ['VLOOKUP(C43,UPAH!B$2:C$20,2,FALSE)', 1500],
    },
  ],
});
const main = analysisBlock(5, {
  seq: 1,
  code: 'P.1',
  name: '1 M2 PASANGAN BATA MERAH',
  unit: 'm2',
  components: [
    {
      category: 'TENAGA',
      name: 'Tukang Batu',
      unit: 'OH',
      coef: 0.1,
      price: ['VLOOKUP(C8,UPAH!B$2:C$20,2,FALSE)', 160000],
    },
    {
      category: 'BAHAN',
      name: 'Mortar',
      unit: 'm3',
      coef: 0.05,
      price: ["'REKAP ANALISA'!E7", 660000],
    },
    {
      category: 'PERALATAN',
      name: 'Sewa Molen',
      unit: 'jam',
      coef: 0.1,
      price: ['VLOOKUP(C14,UPAH!B$2:C$20,2,FALSE)/8', 50000],
    },
  ],
});
const unused = analysisBlock(80, {
  seq: 3,
  code: 'U.9',
  name: 'TIDAK DIPAKAI',
  unit: 'm2',
  components: [
    {
      category: 'TENAGA',
      name: 'Mandor',
      unit: 'OH',
      coef: 1,
      price: ['VLOOKUP(C83,UPAH!B$2:C$20,2,FALSE)', 220000],
    },
  ],
});
// (0.1×160000 + 0.05×660000 + 0.1×50000) × 1.1 = 59400
const MAIN_PRICE = 59400;
const upah = {
  B2: 'Tukang Batu',
  C2: 160000,
  B3: 'Semen',
  C3: 1500,
  B4: 'Sewa Molen',
  C4: 400000,
  B5: 'Mandor',
  C5: 220000,
  B1: 'Lokasi',
  C1: 'Denpasar',
};

function contractBook(rabPrice = MAIN_PRICE) {
  return xlsxOf({
    'RAB + PPN': rabSheet([
      { no: 'A', desc: 'PEKERJAAN DINDING' },
      {
        no: 1,
        desc: 'Pek. Pasangan Dinding Bata',
        vol: 10,
        unit: 'm2',
        code: 'P.1',
        price: recapLookup(14, rabPrice),
      },
      { no: 2, desc: 'Papan nama proyek', vol: 1, unit: 'bh', price: 500000 },
    ]),
    'REKAP ANALISA': {
      ...recap([
        { seq: 1, code: 'P.1', price: MAIN_PRICE },
        { seq: 2, code: 'M.1', price: sub.price },
        { seq: 3, code: 'U.9', price: unused.price },
      ]),
      ...(rabPrice !== MAIN_PRICE
        ? { E6: ['ROUND(VLOOKUP(A6,ANALISA!A$5:H$500,8,FALSE),0)', rabPrice] as [string, number] }
        : {}),
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
  adminId = (
    await createUser(t.prisma, { email: 'admin@example.com', name: 'Super', isSystemAdmin: true })
  ).id;
  admin = await loggedIn('admin@example.com');
  project = await createProject(t.prisma, 'IMP-001');
  base = `/projects/${project.id}/rab-imports`;
});

describe('documents and permissions (D-049)', () => {
  it('ADMIN uploads and reviews but cannot approve; FILLER cannot upload; outsiders get 404; only .xlsx', async () => {
    const filler = await member('FILLER');
    const projectAdmin = await member('ADMIN');
    expect(
      (
        await filler.upload(`/projects/${project.id}/documents`, [
          { name: 'a.xlsx', data: await contractBook() },
        ])
      ).status,
    ).toBe(403);
    expect(
      (
        await projectAdmin.upload(`/projects/${project.id}/documents`, [
          { name: 'a.pdf', data: Buffer.from('%PDF-1.4') },
        ])
      ).status,
    ).toBe(400);

    const doc = await upload(projectAdmin, 'RAB Dinding.xlsx', await contractBook());
    expect(doc.rabSheetCandidates).toEqual(['RAB + PPN']);
    const previewBase = `/projects/${project.id}/documents/${doc.id}/preview`;
    const preview = await projectAdmin.get(`${previewBase}?sheet=UPAH&cell=C2`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      filename: 'RAB Dinding.xlsx',
      sheet: 'UPAH',
      selected: { cell: 'C2', value: '160000', formula: null },
    });
    expect(preview.body.rows.length).toBeLessThanOrEqual(11);
    expect(preview.body.columns.length).toBeLessThanOrEqual(12);
    expect((await filler.get(previewBase)).status).toBe(403);
    expect((await projectAdmin.get(`${previewBase}?cell=XFE1`)).status).toBe(400);
    expect((await projectAdmin.get(`${previewBase}?cell=A1048577`)).status).toBe(400);
    expect((await projectAdmin.get(`${previewBase}?sheet=absent`)).status).toBe(404);
    const otherProject = await createProject(t.prisma, 'PREVIEW-OTHER');
    expect(
      (await admin.get(`/projects/${otherProject.id}/documents/${doc.id}/preview`)).status,
    ).toBe(404);

    const stored = await t.prisma.projectDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await filler.get(`/projects/${project.id}/documents`)).status).toBe(403);
    const download = await fetch(
      `${t.baseUrl}/projects/${project.id}/documents/${doc.id}/download`,
      { headers: { cookie: projectAdmin.cookie! } },
    );
    expect(download.status).toBe(200);

    const detail = await runImport(projectAdmin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    expect(detail.import.status).toBe('NEEDS_REVIEW');
    expect((await projectAdmin.post(`${base}/${detail.import.id}/approve`)).status).toBe(403);
    expect((await filler.get(base)).status).toBe(403);

    const outsider = await createUser(t.prisma, { email: 'luar@example.com' });
    expect(outsider).toBeTruthy();
    expect((await (await loggedIn('luar@example.com')).get(base)).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { action: 'UPLOAD_DOCUMENT' } })).toBe(1);
  });

  it('a failure after the metadata commit keeps the stored file (regression)', async () => {
    const spy = vi
      .spyOn(t.prisma.projectDocument, 'findMany')
      .mockRejectedValueOnce(new Error('connection lost after commit'));
    try {
      const res = await admin.upload(`/projects/${project.id}/documents`, [
        { name: 'rab.xlsx', data: await contractBook() },
      ]);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const doc = await t.prisma.projectDocument.findFirstOrThrow({
      where: { projectId: project.id },
    });
    expect(existsSync(documentPath(project.id, doc.storedFilename))).toBe(true);
    expect(
      (await t.app.get(DocumentsService).read(project.id, doc.id)).data.subarray(0, 2).toString(),
    ).toBe('PK');
  });
});

describe('contract import → approval', () => {
  it('imports only used analyses/prices with sub-analyses, links RAB items, and keeps the recap name (D-046, D-047)', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const detail = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    expect(detail.import).toMatchObject({
      status: 'NEEDS_REVIEW',
      guideVersion: GUIDE_VERSION,
      blockingIssues: 0,
    });
    expect(detail.draft.stats).toMatchObject({
      items: 2,
      analysesInWorkbook: 3,
      analysesImported: 2,
      subAnalyses: 1,
      components: 4,
      pricesImported: 3,
    });
    expect(detail.issues.map((i: { code: string }) => i.code)).toContain('DIRECT_PRICE');
    expect(detail.reconciliation).toMatchObject({ realCost: '1214340.00', matches: null });

    const approved = await admin.post(`${base}/${detail.import.id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.import.status).toBe('APPROVED');

    const priceLists = await t.prisma.priceList.findMany({ include: { items: true } });
    expect(priceLists).toHaveLength(1);
    expect(priceLists[0]).toMatchObject({ versionNumber: 1, location: 'Denpasar' });
    expect(priceLists[0]!.items.map((i) => i.name).sort()).toEqual([
      'Semen',
      'Sewa Molen',
      'Tukang Batu',
    ]); // Mandor (unused analysis) not imported
    const versions = await t.prisma.ahspAnalysisVersion.findMany({
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(versions.map((v) => [v.code, v.name, v.price.toString()]).sort()).toEqual([
      ['M.1', 'MORTAR 1:4', '660000'],
      ['P.1', '1 M2 PASANGAN BATA MERAH', '59400'],
    ]);
    const p1 = versions.find((v) => v.code === 'P.1')!;
    const m1 = versions.find((v) => v.code === 'M.1')!;
    expect(
      p1.components.map((c) => [c.description, c.unitPrice.toString(), c.subAnalysisVersionId]),
    ).toEqual([
      ['Tukang Batu', '160000', null],
      ['Mortar', '660000', m1.id],
      ['Sewa Molen', '50000', null],
    ]);

    const rab = await t.prisma.rabVersion.findFirstOrThrow({ where: { projectId: project.id } });
    expect(rab).toMatchObject({ versionType: 'CONTRACT', status: 'DRAFT' });
    const items = await t.prisma.rabVersionItem.findMany({
      where: { rabVersionId: rab.id, rowType: 'ITEM' },
      orderBy: { sortOrder: 'asc' },
    });
    expect(
      items.map((i) => [
        i.description,
        i.priceSource,
        i.analysisVersionId,
        i.unitPrice?.toString(),
      ]),
    ).toEqual([
      ['Pek. Pasangan Dinding Bata', 'ANALYSIS', p1.id, '59400'],
      ['Papan nama proyek', 'DIRECT', null, '500000'],
    ]);
    expect(
      await t.prisma.auditLog.findFirst({ where: { action: 'APPROVE_RAB_IMPORT' } }),
    ).toMatchObject({
      newValue: expect.objectContaining({ analyses: 2, subAnalyses: 1, components: 4 }),
    });

    // Approval of the RAB itself still goes through M4; the linked price cannot be edited directly.
    const rabBase = `/projects/${project.id}/rab-versions/${rab.id}`;
    expect((await admin.patch(`${rabBase}/items/${items[0]!.id}`, { unitPrice: '1' })).status).toBe(
      409,
    );
    // What the RAB form sends for a linked item (everything but the derived price) is accepted (regression).
    const edited = await admin.patch(`${rabBase}/items/${items[0]!.id}`, {
      displayNumber: '1',
      description: 'Pek. Pasangan Dinding Bata (revisi)',
      volume: '25',
      unit: 'm2',
      analysisCode: 'P.1',
      taxPercent: '11',
      parentId: items[0]!.parentItemId,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(
      await t.prisma.rabVersionItem.findUniqueOrThrow({ where: { id: items[0]!.id } }),
    ).toMatchObject({ analysisVersionId: p1.id, priceSource: 'ANALYSIS' });
    expect(
      (
        await t.prisma.rabVersionItem.findUniqueOrThrow({ where: { id: items[0]!.id } })
      ).unitPrice?.toString(),
    ).toBe('59400');
    expect((await admin.post(`${rabBase}/approve`, { acknowledgeWarnings: true })).status).toBe(
      200,
    );
    const grid = (await admin.get(rabBase)).body;
    expect(
      grid.rows.find(
        (r: { description: string }) => r.description === 'Pek. Pasangan Dinding Bata (revisi)',
      ).analysis,
    ).toMatchObject({ code: 'P.1', versionId: p1.id });

    // Resource tabs use component categories, including equipment stored on the UPAH sheet.
    for (const [category, names] of Object.entries({
      LABOR: ['Tukang Batu'],
      MATERIAL: ['Semen'],
      EQUIPMENT: ['Sewa Molen'],
    })) {
      const prices = await admin.get(`${rabBase}/price-list?category=${category}`);
      expect(prices.status).toBe(200);
      expect(prices.body.items.map((i: { name: string }) => i.name)).toEqual(names);
      expect(prices.body.items[0].categories).toContain(category);
    }
    expect((await admin.get(`${rabBase}/price-list?category=OTHER`)).status).toBe(400);
    expect(
      (await admin.get(`${rabBase}/price-list?category=LABOR&search=Semen`)).body.items,
    ).toEqual([]);
    const analysisDetail = await admin.get(`${rabBase}/analyses/${p1.analysisId}`);
    expect(analysisDetail.status).toBe(200);
    expect(analysisDetail.body.versions[0].categoryTotals).toEqual({
      LABOR: '16000',
      MATERIAL: '33000',
      EQUIPMENT: '5000',
    });

    // Combined analysis list of this version's package.
    expect((await admin.get(`/projects/${project.id}/analyses`)).status).toBe(404); // project-wide list is gone (D-057)
    const list = (await admin.get(`/projects/${project.id}/rab-versions/${rab.id}/analyses`)).body;
    expect(
      list.map((a: { code: string; latestVersion: { rabItems: number; usedAsSub: number } }) => [
        a.code,
        a.latestVersion.rabItems,
        a.latestVersion.usedAsSub,
      ]),
    ).toEqual([
      ['M.1', 0, 1],
      ['P.1', 1, 0],
    ]);
  });

  it('price mismatch blocks approval and writes nothing until a reviewer chooses; override needs a reason (D-051)', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook(60000));
    const detail = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    const row = detail.draft.rows.find(
      (r: { description: string }) => r.description === 'Pek. Pasangan Dinding Bata',
    );
    expect(detail.issues).toContainEqual(
      expect.objectContaining({ code: 'PRICE_MISMATCH', rowKey: row.key }),
    );
    const blocked = await admin.post(`${base}/${detail.import.id}/approve`);
    expect(blocked.status).toBe(409);
    expect(await t.prisma.rabVersion.count()).toBe(0);
    expect(await t.prisma.ahspAnalysis.count()).toBe(0);

    const decisions = `${base}/${detail.import.id}/decisions`;
    expect(
      (
        await admin.post(decisions, {
          decisions: [
            { rowKey: row.key, kind: 'PRICE_CHOICE', value: { source: 'SOURCE_OVERRIDE' } },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post(decisions, {
          decisions: [
            {
              rowKey: row.key,
              kind: 'PRICE_CHOICE',
              value: { source: 'SOURCE_OVERRIDE' },
              reason: 'Harga negosiasi kontrak',
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await admin.post(`${base}/${detail.import.id}/approve`)).status).toBe(200);
    const item = await t.prisma.rabVersionItem.findFirstOrThrow({
      where: { description: 'Pek. Pasangan Dinding Bata' },
    });
    expect(item).toMatchObject({
      priceSource: 'SOURCE_OVERRIDE',
      priceNote: 'Harga negosiasi kontrak',
      priceDecidedBy: adminId,
    });
    expect([
      item.unitPrice?.toString(),
      item.sourceUnitPrice?.toString(),
      item.analysisUnitPrice?.toString(),
    ]).toEqual(['60000', '60000', '59400']);
  });
});

describe('MC-0 import with reviewer decisions (D-053)', () => {
  it('links rows to official analyses and work items only through recorded decisions; approved history unchanged', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const contract = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    await admin.post(`${base}/${contract.import.id}/approve`);
    const contractRab = await t.prisma.rabVersion.findFirstOrThrow({
      where: { projectId: project.id },
    });
    await admin.post(`/projects/${project.id}/rab-versions/${contractRab.id}/approve`, {
      acknowledgeWarnings: true,
    });
    const p1 = await t.prisma.ahspAnalysisVersion.findFirstOrThrow({ where: { code: 'P.1' } });

    // MC-0 workbook: recap holds values only (no analysis sheet), volume changed.
    const mc0Doc = await upload(
      admin,
      'mc0.xlsx',
      await xlsxOf({
        'RAB + PPN': rabSheet([
          { no: 'A', desc: 'PEKERJAAN DINDING' },
          {
            no: 1,
            desc: 'Pek. Pasangan Dinding Bata',
            vol: 12,
            unit: 'm2',
            code: 'P.1',
            price: recapLookup(14, MAIN_PRICE),
          },
          { no: 2, desc: 'Papan nama proyek', vol: 1, unit: 'bh', price: 500000 },
        ]),
        'REKAP ANALISA': { B6: 'P.1', E6: MAIN_PRICE },
      }),
    );
    const mc0 = await runImport(admin, {
      targetVersionType: 'MC0',
      sources: [{ documentId: mc0Doc.id }],
    });
    const [bata, papan] = mc0.draft.rows.filter((r: { rowType: string }) => r.rowType === 'ITEM');
    expect(bata.price.kind).toBe('UNRESOLVED');
    expect(bata.analysisCandidates).toEqual([
      expect.objectContaining({ analysisVersionId: p1.id, origin: 'RULE' }),
    ]);
    expect(bata.workItemCandidates).toHaveLength(1);
    expect(
      mc0.issues
        .filter((i: { severity: string }) => i.severity === 'BLOCKING')
        .map((i: { code: string }) => i.code)
        .sort(),
    ).toEqual(['ANALYSIS_UNRESOLVED', 'WORK_ITEM_UNDECIDED', 'WORK_ITEM_UNDECIDED']);
    // Rule candidates are never applied without a decision.
    expect((await admin.post(`${base}/${mc0.import.id}/approve`)).status).toBe(409);

    const res = await admin.post(`${base}/${mc0.import.id}/decisions`, {
      decisions: [
        {
          rowKey: bata.key,
          kind: 'ANALYSIS_LINK',
          value: { analysisVersionId: p1.id },
          reason: 'Kode, satuan, harga sama dengan analisa Kontrak',
        },
        {
          rowKey: bata.key,
          kind: 'WORK_ITEM_MATCH',
          value: { workItemId: bata.workItemCandidates[0].workItemId },
        },
        {
          rowKey: papan.key,
          kind: 'WORK_ITEM_MATCH',
          value: { workItemId: papan.workItemCandidates[0].workItemId },
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.import.blockingIssues).toBe(0);
    expect((await admin.post(`${base}/${mc0.import.id}/approve`)).status).toBe(200);

    const mc0Rab = await t.prisma.rabVersion.findFirstOrThrow({ where: { versionType: 'MC0' } });
    const mc0Item = await t.prisma.rabVersionItem.findFirstOrThrow({
      where: { rabVersionId: mc0Rab.id, description: 'Pek. Pasangan Dinding Bata' },
    });
    const contractItem = await t.prisma.rabVersionItem.findFirstOrThrow({
      where: { rabVersionId: contractRab.id, description: 'Pek. Pasangan Dinding Bata' },
    });
    // D-056/D-058: the MC-0 links its own copy of P.1 (with sub-analysis M.1 and prices), not the Kontrak's.
    const copy = await t.prisma.ahspAnalysisVersion.findUniqueOrThrow({
      where: { id: mc0Item.analysisVersionId! },
      include: {
        analysis: true,
        components: {
          include: { priceItem: true, subAnalysisVersion: { include: { analysis: true } } },
        },
      },
    });
    expect(copy).toMatchObject({
      copiedFromId: p1.id,
      sourceImportId: mc0.import.id,
      price: p1.price,
      analysis: { rabVersionId: mc0Rab.id },
    });
    expect(
      copy.components.map((c) => [
        c.description,
        c.priceItem?.priceListId ?? null,
        c.subAnalysisVersion?.analysis.rabVersionId ?? null,
      ]),
    ).toEqual([
      [
        'Tukang Batu',
        (await t.prisma.priceList.findUniqueOrThrow({ where: { rabVersionId: mc0Rab.id } })).id,
        null,
      ],
      ['Mortar', null, mc0Rab.id],
      [
        'Sewa Molen',
        (await t.prisma.priceList.findUniqueOrThrow({ where: { rabVersionId: mc0Rab.id } })).id,
        null,
      ],
    ]);
    expect(mc0Item).toMatchObject({ workItemId: contractItem.workItemId, priceSource: 'ANALYSIS' });
    expect(
      (
        await admin.get(
          `/projects/${project.id}/rab-versions/${contractRab.id}/compare/${mc0Rab.id}`,
        )
      ).body.rows.map((r: { change: string }) => r.change),
    ).toEqual(['MODIFIED', 'UNCHANGED']);
    for (const v of [contractRab.id, mc0Rab.id])
      expect(isIsolated(await checkPackageIsolation(t.prisma, v))).toBe(true);
    // Each version's package lists only its own analyses; the copy shows where it came from.
    const mc0List = (await admin.get(`/projects/${project.id}/rab-versions/${mc0Rab.id}/analyses`))
      .body;
    expect(
      mc0List.map(
        (a: {
          code: string;
          latestVersion: { copiedFrom: { rabVersion: { label: string } } | null };
        }) => [a.code, a.latestVersion.copiedFrom?.rabVersion.label],
      ),
    ).toEqual([
      ['M.1', 'Kontrak'],
      ['P.1', 'Kontrak'],
    ]);
    expect(
      (
        await admin.get(
          `/projects/${project.id}/rab-versions/${contractRab.id}/analyses/${copy.analysisId}`,
        )
      ).status,
    ).toBe(404);
    // The copy's provenance opens the exact source analysis in the source version's package.
    const from = (
      await admin.get(
        `/projects/${project.id}/rab-versions/${mc0Rab.id}/analyses/${copy.analysisId}`,
      )
    ).body.versions[0].copiedFrom;
    expect(from).toMatchObject({ analysisVersionId: p1.id, rabVersion: { id: contractRab.id } });
    const source = await admin.get(
      `/projects/${project.id}/rab-versions/${from.rabVersion.id}/analyses/${from.analysisId}`,
    );
    expect(source.status).toBe(200);
    expect(source.body.versions.map((v: { id: string }) => v.id)).toContain(p1.id);
    expect(
      (
        await admin.get(`/projects/${project.id}/rab-versions/${mc0Rab.id}/price-list`)
      ).body.items.map((i: { name: string }) => i.name),
    ).toEqual(['Semen', 'Sewa Molen', 'Tukang Batu']);
    // The approved contract and its package are unchanged.
    expect(
      (await t.prisma.rabVersionItem.findUniqueOrThrow({ where: { id: contractItem.id } }))
        .analysisVersionId,
    ).toBe(p1.id);
    expect(await t.prisma.ahspAnalysis.count({ where: { rabVersionId: contractRab.id } })).toBe(2);
    expect(
      (await t.prisma.rabImport.findUniqueOrThrow({ where: { id: mc0.import.id } })).priceListId,
    ).toBe((await t.prisma.priceList.findUniqueOrThrow({ where: { rabVersionId: mc0Rab.id } })).id);
    expect(await t.prisma.rabImportDecision.count({ where: { importId: mc0.import.id } })).toBe(3);

    // Addendum through "Buat versi" (M4): items and their package are copied from MC-0, never shared (D-057).
    expect(
      (
        await admin.post(`/projects/${project.id}/rab-versions/${mc0Rab.id}/approve`, {
          acknowledgeWarnings: true,
        })
      ).status,
    ).toBe(200);
    // After MC-0 is approved, its finished import is still shown against the analyses it linked (regression).
    const finished = (await admin.get(`/projects/${project.id}/rab-imports/${mc0.import.id}`)).body;
    expect(finished.issues.filter((i: { code: string }) => i.code === 'ANALYSIS_INVALID')).toEqual([]);
    expect(finished.reconciliation.realCost).toBe(
      (await admin.get(`/projects/${project.id}/rab-versions/${mc0Rab.id}`)).body.totals.realCost,
    );
    const before = await packageSnapshot([contractRab.id, mc0Rab.id]);
    const add = await admin.post(`/projects/${project.id}/rab-versions`, {
      versionType: 'ADDENDUM',
    });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const addId = add.body.version.id as string;
    const addItem = await t.prisma.rabVersionItem.findFirstOrThrow({
      where: { rabVersionId: addId, description: 'Pek. Pasangan Dinding Bata' },
      include: { analysisVersion: true },
    });
    expect(addItem.analysisVersion).toMatchObject({
      copiedFromId: mc0Item.analysisVersionId,
      sourceImportId: null,
      price: p1.price,
    });
    expect(await t.prisma.ahspAnalysis.count({ where: { rabVersionId: addId } })).toBe(2);
    expect(isIsolated(await checkPackageIsolation(t.prisma, addId))).toBe(true);
    expect(await packageSnapshot([contractRab.id, mc0Rab.id])).toEqual(before);
    // A change inside the Addendum package leaves MC-0 and Kontrak untouched.
    const addPrice = await t.prisma.priceItem.findFirstOrThrow({
      where: { priceList: { rabVersionId: addId }, name: 'Tukang Batu' },
    });
    await t.prisma.priceItem.update({ where: { id: addPrice.id }, data: { price: '170000' } });
    expect(await packageSnapshot([contractRab.id, mc0Rab.id])).toEqual(before);

    // Copying again into the same package reuses the earlier copies.
    const again = await t.prisma.$transaction((tx) =>
      copyAnalysesIntoPackage(
        tx,
        {
          projectId: project.id,
          rabVersionId: addId,
          priceListId: addPrice.priceListId,
          sourceImportId: null,
        },
        [mc0Item.analysisVersionId!],
      ),
    );
    expect(again.get(mc0Item.analysisVersionId!)).toBe(addItem.analysisVersionId);
    expect(await t.prisma.ahspAnalysis.count({ where: { rabVersionId: addId } })).toBe(2);

    // The backend refuses to approve a version whose item links another version's analysis.
    await t.prisma.rabVersionItem.update({
      where: { id: addItem.id },
      data: { analysisVersionId: mc0Item.analysisVersionId },
    });
    expect(isIsolated(await checkPackageIsolation(t.prisma, addId))).toBe(false);
    const refused = await admin.post(`/projects/${project.id}/rab-versions/${addId}/approve`, {
      acknowledgeWarnings: true,
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body.errors)).toContain('milik paket versi RAB lain');
  });
});

describe('MC-0 with its own analyses (D-058)', () => {
  it('uses the new source instead of inheriting; the Kontrak package is untouched', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const contract = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    await admin.post(`${base}/${contract.import.id}/approve`);
    const contractRab = await t.prisma.rabVersion.findFirstOrThrow({
      where: { projectId: project.id },
    });
    await admin.post(`/projects/${project.id}/rab-versions/${contractRab.id}/approve`, {
      acknowledgeWarnings: true,
    });
    const before = await packageSnapshot([contractRab.id]);

    // The MC-0 workbook carries full analysis sheets: rows are proven by formula, nothing is offered from Kontrak.
    const mc0Doc = await upload(admin, 'mc0-lengkap.xlsx', await contractBook());
    const mc0 = await runImport(admin, {
      targetVersionType: 'MC0',
      sources: [{ documentId: mc0Doc.id }],
    });
    const rows = mc0.draft.rows.filter((r: { rowType: string }) => r.rowType === 'ITEM');
    expect(
      rows.map((r: { price: { kind: string }; analysisCandidates: unknown[] }) => [
        r.price.kind,
        r.analysisCandidates.length,
      ]),
    ).toEqual([
      ['ANALYSIS', 0],
      ['DIRECT', 0],
    ]);
    const decided = await admin.post(`${base}/${mc0.import.id}/decisions`, {
      decisions: rows.map((r: { key: string; workItemCandidates: { workItemId: string }[] }) => ({
        rowKey: r.key,
        kind: 'WORK_ITEM_MATCH',
        value: { workItemId: r.workItemCandidates[0]!.workItemId },
      })),
    });
    expect(decided.body.import.blockingIssues).toBe(0);
    expect((await admin.post(`${base}/${mc0.import.id}/approve`)).status).toBe(200);

    const mc0Rab = await t.prisma.rabVersion.findFirstOrThrow({ where: { versionType: 'MC0' } });
    const own = await t.prisma.ahspAnalysisVersion.findMany({
      where: { analysis: { rabVersionId: mc0Rab.id } },
    });
    expect(own.map((v) => [v.code, v.copiedFromId, v.sourceImportId]).sort()).toEqual([
      ['M.1', null, mc0.import.id],
      ['P.1', null, mc0.import.id],
    ]);
    expect(isIsolated(await checkPackageIsolation(t.prisma, mc0Rab.id))).toBe(true);
    expect(await packageSnapshot([contractRab.id])).toEqual(before);
  });
});

/** Every analysis, component, and price of the given versions' packages, for before/after comparison. */
async function packageSnapshot(versionIds: string[]) {
  return Promise.all(
    versionIds.map(async (id) => ({
      analyses: await t.prisma.ahspAnalysisVersion.findMany({
        where: { analysis: { rabVersionId: id } },
        include: { components: true },
        orderBy: { id: 'asc' },
      }),
      prices: await t.prisma.priceItem.findMany({
        where: { priceList: { rabVersionId: id } },
        orderBy: { id: 'asc' },
      }),
      items: await t.prisma.rabVersionItem.findMany({
        where: { rabVersionId: id },
        select: { id: true, analysisVersionId: true, unitPrice: true },
        orderBy: { id: 'asc' },
      }),
    })),
  );
}

describe('failures, retry, rejection, AI', () => {
  it('ambiguous sheet → FAILED; retry is a new run linked to the old one; rejection needs a reason', async () => {
    const book = await xlsxOf({
      'RAB A': rabSheet([{ no: 'A', desc: 'P' }]),
      'RAB B': rabSheet([{ no: 'A', desc: 'P' }]),
    });
    const doc = await upload(admin, 'dua-sheet.xlsx', book);
    const failed = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    expect(failed.import).toMatchObject({
      status: 'FAILED',
      errorMessage: expect.stringContaining('pilih sheet RAB'),
    });
    const retry = await admin.post(`${base}/${failed.import.id}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ attemptNumber: 2, previousImportId: failed.import.id });
    await t.app.get(RabImportsService).waitFor(retry.body.id);
    expect(
      (await t.prisma.rabImport.findUniqueOrThrow({ where: { id: failed.import.id } })).status,
    ).toBe('FAILED');

    const good = await upload(admin, 'rab.xlsx', await contractBook());
    const run = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: good.id }],
    });
    expect((await admin.post(`${base}/${run.import.id}/reject`, {})).status).toBe(400);
    expect(
      (await admin.post(`${base}/${run.import.id}/reject`, { reason: 'Salah file' })).body.import,
    ).toMatchObject({ status: 'REJECTED', rejectReason: 'Salah file' });
    expect((await admin.post(`${base}/${run.import.id}/approve`)).status).toBe(409);
  });

  it('AI suggestions only come from offered official analyses and are recorded; failures fall back to manual review', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const contract = await runImport(admin, {
      targetVersionType: 'CONTRACT',
      sources: [{ documentId: doc.id }],
    });
    await admin.post(`${base}/${contract.import.id}/approve`);
    const contractRab = await t.prisma.rabVersion.findFirstOrThrow({});
    await admin.post(`/projects/${project.id}/rab-versions/${contractRab.id}/approve`, {
      acknowledgeWarnings: true,
    });
    const p1 = await t.prisma.ahspAnalysisVersion.findFirstOrThrow({ where: { code: 'P.1' } });

    // Code and price differ, so no rule candidate; only the AI can suggest.
    const mc0Book = await xlsxOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN DINDING' },
        {
          no: 1,
          desc: 'Pek. Pasangan Dinding Bata',
          vol: 12,
          unit: 'm2',
          code: 'X.7',
          price: recapLookup(14, 59000),
        },
      ]),
      'REKAP ANALISA': { B6: 'X.7', E6: 59000 },
    });
    aiReply = (prompt) =>
      prompt.includes(p1.id)
        ? {
            suggestions: [
              { rowKey: '0:14', candidateIds: [p1.id, 'invented-id'], reason: 'uraian sama' },
            ],
          }
        : null;
    const mc0Doc = await upload(admin, 'mc0.xlsx', mc0Book);
    const withAi = await runImport(admin, {
      targetVersionType: 'MC0',
      sources: [{ documentId: mc0Doc.id }],
    });
    const row = withAi.draft.rows.find((r: { key: string }) => r.key === '0:14');
    expect(row.analysisCandidates).toEqual([
      expect.objectContaining({ analysisVersionId: p1.id, origin: 'AI' }),
    ]);
    expect(withAi.aiRuns).toEqual([
      expect.objectContaining({
        model: 'mock-primary',
        status: 'SUCCEEDED',
        instructionVersion: GUIDE_VERSION,
      }),
    ]);
    expect(JSON.stringify(aiCalls)).toContain(GUIDE_VERSION);

    // The reviewer can change what the AI suggested: accept it, then replace it with a direct price.
    const decide = async (d: object) =>
      (await admin.post(`${base}/${withAi.import.id}/decisions`, { decisions: [d] })).body;
    const linked = await decide({
      rowKey: '0:14',
      kind: 'ANALYSIS_LINK',
      value: { analysisVersionId: p1.id },
      reason: 'saran AI diterima',
    });
    expect(
      linked.issues.map((i: { code: string; rowKey?: string }) => i.rowKey === '0:14' && i.code),
    ).toContain('PRICE_MISMATCH'); // 59400 vs 59000
    const edited = await decide({
      rowKey: '0:14',
      kind: 'DIRECT_PRICE',
      value: { accept: true },
      reason: 'reviewer: bukan analisa P.1',
    });
    const rowIssues = edited.issues
      .filter((i: { rowKey?: string }) => i.rowKey === '0:14')
      .map((i: { code: string }) => i.code);
    expect(rowIssues).toContain('DIRECT_PRICE');
    expect(rowIssues).not.toContain('PRICE_MISMATCH');
    expect(
      edited.decisions
        .filter((d: { rowKey: string }) => d.rowKey === '0:14')
        .map((d: { kind: string }) => d.kind),
    ).toEqual(['ANALYSIS_LINK', 'DIRECT_PRICE']);
    expect(
      edited.draft.rows.find((r: { key: string }) => r.key === '0:14').analysisCandidates,
    ).toEqual([expect.objectContaining({ origin: 'AI' })]); // suggestion kept as evidence

    aiReply = () => null;
    const noAi = await runImport(admin, {
      targetVersionType: 'MC0',
      sources: [{ documentId: mc0Doc.id }],
    });
    expect(noAi.import.status).toBe('NEEDS_REVIEW');
    expect(noAi.aiRuns.map((r: { model: string; status: string }) => [r.model, r.status])).toEqual([
      ['mock-primary', 'FAILED'],
      ['mock-fallback', 'FAILED'],
    ]);
  });

  it('runs left PROCESSING by a stopped server become FAILED on start', async () => {
    const doc = await upload(admin, 'rab.xlsx', await contractBook());
    const stuck = await t.prisma.rabImport.create({
      data: {
        projectId: project.id,
        targetVersionType: 'CONTRACT',
        status: 'PROCESSING',
        guideVersion: 'rab-import-guide@1',
        parserVersion: 'x',
        createdBy: adminId,
        documents: { create: [{ documentId: doc.id }] },
      },
    });
    await t.app.get(RabImportsService).onModuleInit();
    expect((await t.prisma.rabImport.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe(
      'FAILED',
    );
  });
});
