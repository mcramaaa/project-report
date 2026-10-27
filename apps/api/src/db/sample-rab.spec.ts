import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessService } from '../auth/access.service';
import { RabService } from '../rab/rab.service';
import { createTestPrisma, createUser, resetDatabase } from '../test/db';
import { parseSampleWorkbook, SAMPLE_PROJECT_CODE, seedSampleRab } from './sample-rab';

const prisma = createTestPrisma();
let dir: string;

/** Miniature of the office workbook layout (sheet "RAB + PPN": C no, D uraian, F–J Kontrak, N–P MC-0). */
function workbook({ mc0Total, mc0Rounded }: { mc0Total?: number; mc0Rounded?: number } = {}) {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet('Data');
  const d = (row: number, value: string) => (data.getRow(row).getCell(4).value = value);
  d(2, ': PENGELOLAAN PENDIDIKAN');
  d(3, ': PEMBANGUNAN RUANG KELAS');
  d(4, ': PEMBANGUNAN GEDUNG CONTOH');
  d(5, ': 001/KTR/2026, TANGGAL 25 MEI 2026');
  d(6, ': 002/SPMK/2026, TANGGAL 26 MEI 2026');
  d(7, ': PT. KONTRAKTOR');
  d(8, ': CV. KONSULTAN');
  d(9, ': DENPASAR');
  d(10, ': 2026');
  data.getRow(1).getCell(11).value = new Date(Date.UTC(2026, 4, 26));
  data.getRow(1).getCell(13).value = 30;

  const ws = wb.addWorksheet('RAB + PPN');
  ws.getRow(14).getCell(3).value = 'NO';
  const rows: [unknown, string, number?, string?, string?, number?, number?, number?][] = [
    ['A', 'PEKERJAAN PERSIAPAN'],
    [1, 'Papan nama', 1, 'bh', 'I.2', 1967825, 11, 1],
    [null, 'JUMLAH'],
    ['B', 'PEKERJAAN LANTAI 1'],
    ['B.I', 'PEKERJAAN GALIAN'],
    [1, 'Galian pondasi', 39.390000000000001, 'm3', 'II.1', 124696, 11, 46],
    [2, 'Bore pile'],
    ['', 'Pengeboran', 237.6, 'm', 'VII.3', 69168, 11, 237.6],
    ['', 'Pembesian', 10, 'kg', 'VI.3', 22278, 11, 0],
    [3, 'Terali jendela', 2, 'm2', 'X.1', 100000, 11, 2],
    ['', '(plat 3x30 mm)'],
    [4, 'Saluran baru', 0, 'm', 'XX.1', 50000, 11, 3],
    [null, 'JUMLAH'],
  ];
  rows.forEach(([no, desc, vol, sat, ana, price, ppn, mcVol], i) => {
    const r = ws.getRow(17 + i);
    r.getCell(3).value = no as ExcelJS.CellValue;
    r.getCell(4).value = desc;
    if (vol !== undefined) {
      r.getCell(6).value = vol;
      r.getCell(7).value = sat!;
      r.getCell(8).value = ana!;
      r.getCell(9).value = { formula: 'VLOOKUP(...)', result: price! };
      r.getCell(10).value = ppn!;
      r.getCell(14).value = mcVol!;
      r.getCell(15).value = sat!;
      r.getCell(16).value = price!;
    }
  });
  // Kontrak: 1967825×1.11 + 39.39×124696×1.11 + 237.6×69168×1.11 + 10×22278×1.11 + 2×100000×1.11
  const contract = 2184285.75 + 5452070.7384 + 18242091.648 + 247285.8 + 222000;
  // MC-0: 1967825×1.11 + 46×124696×1.11 + 237.6×69168×1.11 + 2×100000×1.11 + 3×50000×1.11
  const mc0 = 2184285.75 + 6366977.76 + 18242091.648 + 222000 + 166500;
  ws.getRow(40).getCell(4).value = 'JUMLAH TOTAL';
  ws.getRow(40).getCell(12).value = contract;
  ws.getRow(40).getCell(18).value = mc0Total ?? mc0;
  ws.getRow(41).getCell(4).value = 'DIBULATKAN';
  ws.getRow(41).getCell(12).value = Math.trunc(Math.round(contract * 100) / 100);
  ws.getRow(41).getCell(18).value = mc0Rounded ?? Math.trunc(Math.round(mc0 * 100) / 100);
  return wb;
}

async function file(wb: ExcelJS.Workbook, name = 'sample.xlsx') {
  const path = join(dir, name);
  await wb.xlsx.writeFile(path);
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sample-rab-'));
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
});

describe('parseSampleWorkbook', () => {
  it('maps sections, sub-sections, parent items, unnumbered sub-items, and continuation lines', () => {
    const { rows } = parseSampleWorkbook(workbook());
    const byDesc = (d: string) => rows.find((r) => r.description.startsWith(d))!;
    expect(rows.map((r) => [r.rowType, r.displayNumber, r.description])).toEqual([
      ['SECTION', 'A', 'PEKERJAAN PERSIAPAN'],
      ['ITEM', '1', 'Papan nama'],
      ['SECTION', 'B', 'PEKERJAAN LANTAI 1'],
      ['SUBSECTION', 'B.I', 'PEKERJAAN GALIAN'],
      ['ITEM', '1', 'Galian pondasi'],
      ['PARENT_ITEM', '2', 'Bore pile'],
      ['ITEM', null, 'Pengeboran'],
      ['ITEM', null, 'Pembesian'],
      ['ITEM', '3', 'Terali jendela (plat 3x30 mm)'],
      ['ITEM', '4', 'Saluran baru'],
    ]);
    expect(byDesc('Pengeboran').parentKey).toBe(byDesc('Bore pile').key);
    expect(byDesc('Terali').parentKey).toBe(byDesc('PEKERJAAN GALIAN').key); // numbered row closes the parent item
    // Float artefacts become the value Excel shows; prices come from formula results.
    expect(byDesc('Galian').contract).toEqual({ volume: '39.39', unit: 'm3', unitPrice: '124696', taxPercent: '11' });
    expect(byDesc('Pembesian').mc0).toBeNull(); // removed in MC-0
    expect(byDesc('Saluran').contract).toBeNull(); // new in MC-0
  });
});

describe('seedSampleRab', () => {
  it('creates the project and approves Kontrak and MC-0 with totals equal to the workbook; idempotent', async () => {
    const admin = await createUser(prisma, { email: 'admin@example.com', name: 'Super', isSystemAdmin: true });
    const actor = { id: admin.id, name: admin.name, email: admin.email, isSystemAdmin: true };
    const path = await file(workbook());

    const result = await seedSampleRab(prisma, actor, path);
    expect(result).toMatchObject({ created: true, contract: { realCost: '26347733.94', rounded: '26347733' }, mc0: { realCost: '27181855.16', rounded: '27181855' } });
    const project = await prisma.project.findUniqueOrThrow({ where: { code: SAMPLE_PROJECT_CODE } });
    expect(project).toMatchObject({ contractorName: 'PT. KONTRAKTOR', contractNumber: '001/KTR/2026', durationDays: 30 });
    expect(project.contractValue?.toFixed(2)).toBe('26347733.00');
    expect(await prisma.projectWeek.count({ where: { projectId: project.id } })).toBe(5);
    expect(await prisma.projectUser.findFirst({ where: { projectId: project.id, userId: admin.id }, include: { role: true } })).toMatchObject({ role: { code: 'MANAGER' } });

    const versions = await prisma.rabVersion.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });
    expect(versions.map((v) => [v.versionType, v.status])).toEqual([
      ['CONTRACT', 'APPROVED'],
      ['MC', 'APPROVED'],
    ]);
    const compare = await new RabService(prisma, new AccessService(prisma)).compare(project.id, versions[0]!.id, versions[1]!.id);
    expect(Object.fromEntries(compare.rows.map((r) => [r.target?.description ?? r.base!.description, r.change]))).toEqual({
      'Papan nama': 'UNCHANGED',
      'Galian pondasi': 'MODIFIED',
      Pengeboran: 'UNCHANGED',
      'Terali jendela (plat 3x30 mm)': 'UNCHANGED',
      'Saluran baru': 'NEW',
      Pembesian: 'REMOVED',
    });

    expect(await seedSampleRab(prisma, actor, path)).toEqual({ created: false });
    expect(await prisma.rabVersion.count()).toBe(2);
  });

  it('writes nothing when the app totals differ from the workbook', async () => {
    const admin = await createUser(prisma, { email: 'admin@example.com', isSystemAdmin: true });
    const path = await file(workbook({ mc0Total: 27181865.16, mc0Rounded: 27181865 }), 'mismatch.xlsx');
    await expect(seedSampleRab(prisma, { id: admin.id, name: 'A', email: admin.email, isSystemAdmin: true }, path)).rejects.toThrow(/berbeda dengan workbook/);
    expect(await prisma.project.count()).toBe(0);
  });
});
