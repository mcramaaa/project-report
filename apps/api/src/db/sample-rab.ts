import { randomUUID } from 'node:crypto';
import { calculateRab, Decimal, type RabCalcInput } from '@laporan-proyek/calc';
import type { CreateProjectInput, RabRowType } from '@laporan-proyek/shared';
import ExcelJS from 'exceljs';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../auth/auth-context';
import type { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { nextWorkItemNumber, RabService, workItemCode } from '../rab/rab.service';

/**
 * Development sample (D-044): project SDN 2 Serangan with RAB Kontrak and MC-0 from the office
 * weekly-report workbook (sheet "RAB + PPN": Kontrak in F–J, MC-0 in N–P). The workbook stays in
 * storage/temp (not in Git); nothing from it is committed.
 */
export const SAMPLE_PROJECT_CODE = 'SDN2-SERANGAN-2026';
const RAB_SHEET = 'RAB + PPN';
const DATA_SHEET = 'Data';
const COL = { no: 3, description: 4, volume: 6, unit: 7, analysis: 8, price: 9, tax: 10, mcVolume: 14, mcUnit: 15, mcPrice: 16 } as const;

export interface Quantity {
  volume: string;
  unit: string | null;
  unitPrice: string | null;
  taxPercent: string | null;
}

export interface SampleRow {
  key: number;
  parentKey: number | null;
  rowType: RabRowType;
  displayNumber: string | null;
  description: string;
  analysisCode: string | null;
  contract: Quantity | null;
  mc0: Quantity | null;
}

export interface SampleWorkbook {
  rows: SampleRow[];
  /** "JUMLAH TOTAL" (exact) and "DIBULATKAN" of the Kontrak and MC-0 columns, for verification. */
  workbookTotals: { contract: { value: string; rounded: string }; mc0: { value: string; rounded: string } };
}

type CellValue = ExcelJS.CellValue;

/** Formula cells carry their cached result; rich text is flattened. */
function plain(value: CellValue): unknown {
  if (value && typeof value === 'object') {
    if ('result' in value) return value.result;
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
  }
  return value;
}

function text(value: CellValue): string {
  const v = plain(value);
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Excel stores numbers as binary floats (39.39 -> 39.390000000000001); 15 significant digits is what
 * Excel itself displays, so that is the decimal value at this import boundary.
 */
function decimal(value: CellValue, scale: number): string | null {
  const v = plain(value);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return new Decimal(v.toPrecision(15)).toDecimalPlaces(scale).toFixed();
}

const positive = (v: string | null) => v !== null && new Decimal(v).gt(0);

export function parseSampleWorkbook(workbook: ExcelJS.Workbook): SampleWorkbook {
  const sheet = workbook.getWorksheet(RAB_SHEET);
  if (!sheet) throw new Error(`Sheet "${RAB_SHEET}" tidak ditemukan.`);

  const rows: SampleRow[] = [];
  let section: number | null = null;
  let subsection: number | null = null;
  let parentItem: number | null = null;
  let totals: SampleWorkbook['workbookTotals'] | null = null;
  let totalRow: number | null = null;

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const no = text(row.getCell(COL.no).value);
    const description = text(row.getCell(COL.description).value);
    const label = description.toUpperCase();
    if (label === 'JUMLAH TOTAL') {
      totalRow = r;
      continue;
    }
    if (totalRow !== null && label === 'DIBULATKAN') {
      const total = sheet.getRow(totalRow);
      totals = {
        contract: { value: decimal(total.getCell(12).value, 10) ?? '0', rounded: decimal(row.getCell(12).value, 0) ?? '0' },
        mc0: { value: decimal(total.getCell(18).value, 10) ?? '0', rounded: decimal(row.getCell(18).value, 0) ?? '0' },
      };
      break;
    }
    if (!description) continue;
    if (label.startsWith('JUMLAH')) {
      parentItem = null;
      continue;
    }
    // Rows before the first section are the sheet header.
    if (section === null && !/^[A-Z]$/.test(no)) continue;

    const contractVolume = decimal(row.getCell(COL.volume).value, 12);
    const mcVolume = decimal(row.getCell(COL.mcVolume).value, 12);
    const tax = decimal(row.getCell(COL.tax).value, 2);
    const quantity = (volume: string | null, unit: CellValue, price: CellValue): Quantity | null =>
      positive(volume) ? { volume: volume!, unit: text(unit) || null, unitPrice: decimal(price, 2), taxPercent: tax } : null;
    const contract = quantity(contractVolume, row.getCell(COL.unit).value, row.getCell(COL.price).value);
    const mc0 = quantity(mcVolume, row.getCell(COL.mcUnit).value, row.getCell(COL.mcPrice).value);
    const base = { key: r, displayNumber: no || null, description, analysisCode: text(row.getCell(COL.analysis).value) || null };

    if (/^[A-Z]$/.test(no)) {
      rows.push({ ...base, parentKey: null, rowType: 'SECTION', analysisCode: null, contract: null, mc0: null });
      [section, subsection, parentItem] = [r, null, null];
    } else if (/^[A-Z]\.[IVXLC]+$/.test(no)) {
      rows.push({ ...base, parentKey: section, rowType: 'SUBSECTION', analysisCode: null, contract: null, mc0: null });
      [subsection, parentItem] = [r, null];
    } else if (contract || mc0) {
      // Unnumbered items belong to the open parent item ("Pek. Bore Pile …" followed by its parts).
      if (no) parentItem = null;
      rows.push({ ...base, parentKey: (no ? null : parentItem) ?? subsection ?? section, rowType: 'ITEM', contract, mc0 });
    } else if (no) {
      rows.push({ ...base, parentKey: subsection ?? section, rowType: 'PARENT_ITEM', analysisCode: null, contract: null, mc0: null });
      parentItem = r;
    } else if (rows.length > 0) {
      // Unnumbered row without quantities: continuation of the previous description.
      const previous = rows[rows.length - 1]!;
      previous.description = `${previous.description} ${description}`.slice(0, 1000);
    }
  }
  if (!totals) throw new Error('Baris "JUMLAH TOTAL"/"DIBULATKAN" tidak ditemukan di sheet RAB + PPN.');
  return { rows, workbookTotals: totals };
}

/** Rows of one version: its items plus the group rows that contain at least one of them. */
export function versionRows(rows: SampleRow[], pick: (r: SampleRow) => Quantity | null): SampleRow[] {
  const used = new Set<number>();
  const parentOf = new Map(rows.map((r) => [r.key, r.parentKey]));
  for (const r of rows) {
    if (r.rowType !== 'ITEM' || !pick(r)) continue;
    for (let k: number | null = r.key; k !== null && !used.has(k); k = parentOf.get(k) ?? null) used.add(k);
  }
  return rows.filter((r) => used.has(r.key));
}

/** Totals with the app formula (D-043), compared with the workbook before anything is written. */
export function sampleTotals(rows: SampleRow[], pick: (r: SampleRow) => Quantity | null) {
  const inputs: RabCalcInput[] = versionRows(rows, pick).map((r) => {
    const q = pick(r);
    return { id: String(r.key), parentId: r.parentKey === null ? null : String(r.parentKey), rowType: r.rowType, volume: q?.volume ?? null, unitPrice: q?.unitPrice ?? null, taxPercent: q?.taxPercent ?? null };
  });
  return calculateRab(inputs).totals;
}

const MONTHS: Record<string, number> = { JANUARI: 1, FEBRUARI: 2, MARET: 3, APRIL: 4, MEI: 5, JUNI: 6, JULI: 7, AGUSTUS: 8, SEPTEMBER: 9, OKTOBER: 10, NOVEMBER: 11, DESEMBER: 12 };

/** ": 001/KTR/2026, TANGGAL 25 MEI 2026" -> number + ISO date. */
function numberAndDate(value: string): { number: string; date: string } {
  const match = /^:?\s*(.+?),\s*TANGGAL\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})$/i.exec(value);
  const month = match ? MONTHS[match[3]!.toUpperCase()] : undefined;
  if (!match || !month) throw new Error(`Format nomor/tanggal tidak dikenali: ${value}`);
  return { number: match[1]!.trim(), date: `${match[4]}-${String(month).padStart(2, '0')}-${match[2]!.padStart(2, '0')}` };
}

const field = (v: string) => v.replace(/^:\s*/, '').trim();

export function parseSampleProject(workbook: ExcelJS.Workbook, contractValue: string, code = SAMPLE_PROJECT_CODE): CreateProjectInput {
  const sheet = workbook.getWorksheet(DATA_SHEET);
  if (!sheet) throw new Error(`Sheet "${DATA_SHEET}" tidak ditemukan.`);
  const d = (row: number) => text(sheet.getRow(row).getCell(4).value);
  const start = plain(sheet.getRow(1).getCell(11).value);
  const duration = plain(sheet.getRow(1).getCell(13).value);
  if (!(start instanceof Date) || typeof duration !== 'number') throw new Error('Tanggal mulai (K1) atau masa pelaksanaan (M1) tidak ditemukan di sheet Data.');
  const contract = numberAndDate(d(5));
  const spmk = numberAndDate(d(6));
  return {
    code,
    activityName: field(d(2)),
    subActivityName: field(d(3)),
    projectName: field(d(4)),
    location: field(d(9)),
    fiscalYear: Number(field(d(10))),
    contractorName: field(d(7)),
    consultantName: field(d(8)),
    contractNumber: contract.number,
    contractDate: contract.date,
    contractValue,
    spmkNumber: spmk.number,
    spmkDate: spmk.date,
    // Excel dates are calendar dates stored as UTC midnight.
    startDate: start.toISOString().slice(0, 10),
    durationDays: duration,
  };
}

/** Inserts the contract rows in tree order with new work items; returns sheet row -> item id. */
async function insertContractRows(prisma: PrismaService, projectId: string, versionId: string, rows: SampleRow[]): Promise<Map<number, string>> {
  const ids = new Map(rows.map((r) => [r.key, randomUUID()]));
  const items = rows.filter((r) => r.rowType === 'ITEM');
  const workItems = new Map(items.map((r) => [r.key, randomUUID()]));
  const order = new Map<number | null, number>();
  await prisma.$transaction(async (tx) => {
    const first = await nextWorkItemNumber(tx, projectId);
    await tx.workItem.createMany({
      data: items.map((r, i) => ({ id: workItems.get(r.key)!, projectId, internalCode: workItemCode(first + i), canonicalDescription: r.description })),
    });
    await tx.rabVersionItem.createMany({
      data: rows.map((r) => {
        const sortOrder = (order.get(r.parentKey) ?? 0) + 1;
        order.set(r.parentKey, sortOrder);
        return {
          id: ids.get(r.key)!,
          rabVersionId: versionId,
          parentItemId: r.parentKey === null ? null : ids.get(r.parentKey)!,
          sortOrder,
          rowType: r.rowType,
          workItemId: workItems.get(r.key) ?? null,
          displayNumber: r.displayNumber,
          description: r.description,
          analysisCode: r.analysisCode,
          volume: r.contract?.volume ?? null,
          unit: r.contract?.unit ?? null,
          unitPrice: r.contract?.unitPrice ?? null,
          taxPercent: r.contract?.taxPercent ?? null,
        };
      }),
    });
  });
  return ids;
}

/**
 * Turns the MC-0 draft (a copy of the approved contract) into the workbook's MC-0, like a user would:
 * update changed items, delete items with no MC-0 volume (REMOVED), add MC-0-only rows (NEW), then
 * drop groups left empty.
 */
async function applyMc0(prisma: PrismaService, projectId: string, versionId: string, rows: SampleRow[], contractIds: Map<number, string>): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const copies = await tx.rabVersionItem.findMany({ where: { rabVersionId: versionId }, select: { id: true, previousVersionItemId: true } });
    const copyOf = new Map(copies.map((c) => [c.previousVersionItemId!, c.id]));
    const mc0Ids = new Map<number, string>();
    for (const [key, contractId] of contractIds) mc0Ids.set(key, copyOf.get(contractId)!);

    for (const r of rows.filter((x) => x.rowType === 'ITEM' && x.contract)) {
      const id = mc0Ids.get(r.key)!;
      if (!r.mc0) {
        await tx.rabVersionItem.delete({ where: { id } });
        mc0Ids.delete(r.key);
      } else {
        await tx.rabVersionItem.update({ where: { id }, data: { volume: r.mc0.volume, unit: r.mc0.unit, unitPrice: r.mc0.unitPrice, taxPercent: r.mc0.taxPercent } });
      }
    }

    for (const r of versionRows(rows, (x) => x.mc0)) {
      if (mc0Ids.has(r.key)) continue;
      const parentItemId = r.parentKey === null ? null : mc0Ids.get(r.parentKey)!;
      const last = await tx.rabVersionItem.aggregate({ where: { rabVersionId: versionId, parentItemId }, _max: { sortOrder: true } });
      const workItemId =
        r.rowType === 'ITEM'
          ? (await tx.workItem.create({ data: { projectId, internalCode: workItemCode(await nextWorkItemNumber(tx, projectId)), canonicalDescription: r.description } })).id
          : null;
      const created = await tx.rabVersionItem.create({
        data: {
          rabVersionId: versionId,
          parentItemId,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          rowType: r.rowType,
          workItemId,
          displayNumber: r.displayNumber,
          description: r.description,
          analysisCode: r.analysisCode,
          volume: r.mc0?.volume ?? null,
          unit: r.mc0?.unit ?? null,
          unitPrice: r.mc0?.unitPrice ?? null,
          taxPercent: r.mc0?.taxPercent ?? null,
        },
      });
      mc0Ids.set(r.key, created.id);
    }

    // Groups whose items were all removed, deepest first (each pass frees their parents).
    for (;;) {
      const empty = await tx.rabVersionItem.findMany({ where: { rabVersionId: versionId, rowType: { not: 'ITEM' }, children: { none: {} } }, select: { id: true } });
      if (empty.length === 0) break;
      await tx.rabVersionItem.deleteMany({ where: { id: { in: empty.map((e) => e.id) } } });
    }
  });
}

export interface SampleSeedResult {
  created: boolean;
  projectId?: string;
  contract?: { realCost: string; rounded: string };
  mc0?: { realCost: string; rounded: string };
}

/**
 * Creates the sample project and approves Kontrak and MC-0 through the regular services (membership,
 * weeks/periods, validation, snapshots, audit). Refuses to write anything if the app totals differ
 * from the workbook. Idempotent by project code.
 */
export async function seedSampleRab(prisma: PrismaService, actor: AuthUser, workbookPath: string): Promise<SampleSeedResult> {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed contoh tidak boleh dijalankan di production.');
  if (await prisma.project.findUnique({ where: { code: SAMPLE_PROJECT_CODE }, select: { id: true } })) return { created: false };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const { rows, workbookTotals } = parseSampleWorkbook(workbook);
  const pickContract = (r: SampleRow) => r.contract;
  const pickMc0 = (r: SampleRow) => r.mc0;
  const expected = { contract: sampleTotals(rows, pickContract), mc0: sampleTotals(rows, pickMc0) };
  for (const [name, totals] of Object.entries(expected) as [keyof typeof expected, (typeof expected)['contract']][]) {
    const book = workbookTotals[name];
    const bookRealCost = new Decimal(book.value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    if (totals.realCost !== bookRealCost || totals.rounded !== book.rounded) {
      throw new Error(`Total ${name} aplikasi (${totals.realCost} / ${totals.rounded}) berbeda dengan workbook (${bookRealCost} / ${book.rounded}); seed dibatalkan.`);
    }
  }

  const projects = new ProjectsService(prisma, new AccessService(prisma));
  const rab = new RabService(prisma);
  const project = await projects.create(actor, parseSampleProject(workbook, expected.contract.rounded));

  const contract = await rab.create(actor, project.id, { versionType: 'CONTRACT', documentNumber: project.contractNumber, documentDate: project.contractDate });
  const contractIds = await insertContractRows(prisma, project.id, contract.version.id, versionRows(rows, pickContract));
  const approvedContract = await rab.approve(actor, project.id, contract.version.id, true);

  const mc0 = await rab.create(actor, project.id, { versionType: 'MC0' });
  await applyMc0(prisma, project.id, mc0.version.id, rows, contractIds);
  const approvedMc0 = await rab.approve(actor, project.id, mc0.version.id, true);

  return {
    created: true,
    projectId: project.id,
    contract: { realCost: approvedContract.totals.realCost, rounded: approvedContract.totals.rounded },
    mc0: { realCost: approvedMc0.totals.realCost, rounded: approvedMc0.totals.rounded },
  };
}
