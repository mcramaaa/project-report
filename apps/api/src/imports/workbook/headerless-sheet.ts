import { Decimal } from '@laporan-proyek/calc';
import type { RabColumnMap } from '@laporan-proyek/shared';
import type { FormulaNode } from './formula';
import type { RabColumns, RabSheet, RabSheetRow } from './rab-sheet';
import { excelDecimal, type WorkbookModel } from './workbook-model';

/**
 * RAB sheets without the office layout (VOLUME + NO. ANALISA), e.g. the HPS/BOQ/MPU sheets of e-catalogue
 * estimates: "No. Mata Pembayaran | Uraian | Satuan | Total Kuantitas | … | Harga Satuan | Jumlah".
 * Columns are found from header words, so a new layout needs no new code; the mapping is what the reviewer
 * sees. Prices are literal values (no analysis), so they import as DIRECT prices (build-draft).
 */

/** Same shape as the reviewer's mapping (shared `rabColumnMapSchema`, D-090). */
export type HeaderlessColumns = RabColumnMap;

const CODE = [/^NO\.? ?MATA/, /^KODE\b/, /^NO\.? ?ITEM/, /^ITEM PEMBAYARAN/, /^NO\.? ?PEMBAYARAN/];
const DESCRIPTION = [/^URAIAN/, /^JENIS PEKERJAAN/, /^ITEM PEKERJAAN/, /^NAMA PEKERJAAN/];
const UNIT = [/^SATUAN$/, /^SAT$/];
const QUANTITY = [/KUANTITAS/, /^VOLUME\b/, /^QTY\b/];
const PRICE = [/^HARGA SATUAN/, /^HARGA SAT\b/];
const AMOUNT = [/^JUMLAH/, /^TOTAL HARGA/, /^SUB ?JUMLAH/];

/** Item codes: "1.2", "1.20.(1)", "1.22.(1a)", "2.3.(23a3)". Group codes: "1", "1.20" (no unit, no quantity). */
const NUMERIC_CODE = /^\d+(\.\d+)*\.?\s*(\([^)]*\))?[a-z0-9]*$/i;
const upper = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Finds the header block: a row whose window (the row and the next one) names a code column and a description
 * column, plus a quantity and a price column. Returns null unless the sheet also holds priced item rows, so an
 * analysis sheet that happens to contain "Uraian" is not mistaken for a RAB.
 */
export function detectHeaderless(model: WorkbookModel, sheet: string, maxHeaderRow = 40): HeaderlessColumns | null {
  const width = Math.min(60, model.columnCount(sheet));
  for (let r = 1; r <= Math.min(maxHeaderRow, model.rowCount(sheet)); r++) {
    // Header text of each column over the window (this row and the next), built once per row.
    const labels: string[] = [];
    for (let c = 1; c <= width; c++) labels[c] = upper([0, 1].map((d) => model.text(sheet, r + d, c)).filter(Boolean).join(' '));
    const find = (patterns: RegExp[]) => {
      let found: number | null = null;
      for (let c = 1; c <= width; c++) if (labels[c] && patterns.some((p) => p.test(labels[c]!))) found = c; // rightmost wins (incl. PPN copies)
      return found;
    };
    const code = find(CODE);
    const description = find(DESCRIPTION);
    const quantity = find(QUANTITY);
    const price = find(PRICE);
    if (code === null || description === null || quantity === null || price === null) continue;
    const cols: HeaderlessColumns = {
      headerRow: r + 1,
      code,
      description,
      unit: find(UNIT),
      quantity,
      price,
      amount: find(AMOUNT),
    };
    if (countPricedItems(model, sheet, cols, maxHeaderRow) >= 1) return cols;
  }
  return null;
}

/**
 * Header text of each column (the header row and the row above it), for the reviewer's mapping form. Columns
 * without any header text are listed only when a mapped column points at them.
 */
export function headerLabels(
  model: WorkbookModel,
  sheet: string,
  cols: HeaderlessColumns,
): { col: number; label: string; sample?: string; sampleNumeric?: boolean }[] {
  const width = Math.min(60, model.columnCount(sheet));
  const mapped = new Set(Object.entries(cols).filter(([k, v]) => k !== 'headerRow' && typeof v === 'number').map(([, v]) => v as number));
  // First item row under the header (an item code with a price or quantity), the source of each column's sample.
  let sampleRow: number | null = null;
  for (let r = cols.headerRow + 1; r <= Math.min(model.rowCount(sheet), cols.headerRow + 500) && sampleRow === null; r++) {
    if (isItemCode(model.text(sheet, r, cols.code)) && ((model.number(sheet, r, cols.price) ?? 0) > 0 || (model.number(sheet, r, cols.quantity) ?? 0) > 0)) sampleRow = r;
  }
  const out: { col: number; label: string; sample?: string; sampleNumeric?: boolean }[] = [];
  for (let c = 1; c <= Math.max(width, ...mapped); c++) {
    const label = [cols.headerRow - 1, cols.headerRow]
      .filter((r) => r >= 1)
      .map((r) => model.text(sheet, r, c))
      .filter(Boolean)
      .join(' ')
      .slice(0, 80);
    if (!label && !mapped.has(c)) continue;
    const sample = sampleRow === null ? '' : model.text(sheet, sampleRow, c).slice(0, 40);
    // Codes such as "1.2" are text in Excel; only real numbers get number formatting on screen.
    const numeric = sampleRow !== null && model.number(sheet, sampleRow, c) !== null;
    out.push(sample ? { col: c, label, sample, ...(numeric ? { sampleNumeric: true } : {}) } : { col: c, label });
  }
  return out;
}

function countPricedItems(model: WorkbookModel, sheet: string, cols: HeaderlessColumns, last: number): number {
  let n = 0;
  for (let r = cols.headerRow + 1; r <= Math.min(last, model.rowCount(sheet)); r++) {
    const code = model.text(sheet, r, cols.code);
    if (isItemCode(code) && (model.number(sheet, r, cols.price) ?? 0) > 0) n++;
  }
  return n;
}

/**
 * "ROUNDDOWN(K17*1.11,0)", "ROUND(1.11*K17,0)", "K17*1.11": the base price column (same row) and the PPN % of the
 * factor, computed in decimal (1.11 → "11"). null for any other formula.
 */
export function ppnOf(
  model: WorkbookModel,
  sheet: string,
  row: number,
  priceCol: number,
): { baseCol: number; factor: string; taxPercent: string; rounding: 'DOWN' | 'UP' | 'NEAREST' | null; scale: number | null } | null {
  let node: FormulaNode | null = model.formulaOf(model.cell(sheet, row, priceCol));
  let rounding: 'DOWN' | 'UP' | 'NEAREST' | null = null;
  let scale: number | null = null;
  if (node?.kind === 'call' && /^ROUND(UP|DOWN)?$/.test(node.name) && node.args.length === 2 && node.args[1]!.kind === 'number') {
    rounding = node.name === 'ROUNDDOWN' ? 'DOWN' : node.name === 'ROUNDUP' ? 'UP' : 'NEAREST';
    scale = node.args[1].value;
    node = node.args[0]!;
  }
  if (!node || node.kind !== 'binary' || node.op !== '*') return null;
  const sameRowRef = (n: FormulaNode) => n.kind === 'ref' && !n.ref.sheet && n.ref.row === row && n.ref.col !== priceCol;
  const [ref, factor] = sameRowRef(node.left) && node.right.kind === 'number' ? [node.left, node.right.value] : sameRowRef(node.right) && node.left.kind === 'number' ? [node.right, node.left.value] : [null, null];
  if (!ref || ref.kind !== 'ref' || factor === null || !(factor > 1 && factor <= 2)) return null;
  const f = new Decimal(String(factor));
  return { baseCol: ref.ref.col, factor: f.toFixed(), taxPercent: f.minus(1).times(100).toFixed(), rounding, scale };
}

function columnName(n: number): string {
  let s = '';
  for (let c = n; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

function isItemCode(code: string): boolean {
  return NUMERIC_CODE.test(code.trim());
}

/** "1.2", "1.20", "1.22": a group heading code (dotted, no parentheses). */
const GROUP_CODE = /^\d+(\.\d+)+$/;
/** "1", "2", "3a", "5": a short sub-heading inside a group (e.g. the SMKK lists under 1.22). */
const SUBHEADING_CODE = /^\d+[a-z]?$/i;
/** Division titles carry no code: "DIVISI 1. UMUM". */
const DIVISION = /^DIVISI\b/i;

/**
 * Reads the rows under the header into the RAB hierarchy:
 *   "DIVISI n. …" (no code)                → SECTION
 *   dotted group code without values        → SUBSECTION   ("1.20 Pengujian Tanah")
 *   short sub-heading code without values   → PARENT_ITEM  ("1 Penyiapan dokumen penerapan SMKK:")
 *   code with a quantity or a price         → ITEM, under the nearest heading above it
 * Rows without a code (other than divisions), without a description, or without any value are skipped;
 * headings with no item under them are dropped.
 */
export function readHeaderlessSheet(model: WorkbookModel, sheet: string, cols: HeaderlessColumns): RabSheet {
  const rows: RabSheetRow[] = [];
  let section: number | null = null;
  let subsection: number | null = null;
  let parentItem: number | null = null;
  const raw = (r: number, c: number | null) => {
    const v = c === null ? null : model.cell(sheet, r, c).value;
    return typeof v === 'number' && Number.isFinite(v) ? v.toPrecision(17) : null;
  };

  for (let r = cols.headerRow + 1; r <= model.rowCount(sheet); r++) {
    const code = model.text(sheet, r, cols.code).trim();
    const description = model.text(sheet, r, cols.description);
    if (!description) continue;
    const base = {
      row: r,
      displayNumber: code || null,
      description,
      volume: null as string | null,
      unit: null as string | null,
      analysisCode: null as string | null,
      taxPercent: null as string | null,
      sourceUnitPrice: null as string | null,
      workbook: { unitPriceWithTax: null as string | null, subtotal: null as string | null },
      priceCell: { sheet, row: r, col: cols.price },
    };

    if (!code) {
      if (DIVISION.test(description)) {
        rows.push({ ...base, rowType: 'SECTION', parentRow: null });
        [section, subsection, parentItem] = [r, null, null];
      }
      continue;
    }
    if (!isItemCode(code)) continue;

    const unit = cols.unit === null ? '' : model.text(sheet, r, cols.unit);
    const quantity = excelDecimal(model.cell(sheet, r, cols.quantity).value);
    const price = excelDecimal(model.cell(sheet, r, cols.price).value);
    const hasPrice = price !== null && !new Decimal(price).isZero();
    const hasQuantity = quantity !== null && !new Decimal(quantity).isZero();

    if (!unit && !hasQuantity && !hasPrice) {
      if (GROUP_CODE.test(code)) {
        rows.push({ ...base, rowType: 'SUBSECTION', parentRow: section });
        [subsection, parentItem] = [r, null];
      } else if (SUBHEADING_CODE.test(code)) {
        rows.push({ ...base, rowType: 'PARENT_ITEM', parentRow: subsection ?? section });
        parentItem = r;
      }
      continue;
    }
    if (!hasPrice && !hasQuantity) continue; // catalogue line not used in this package: nothing to import
    // D-092: a price column computed from a base price (L = ROUNDDOWN(K × 1.11, 0)) keeps L as the RAB price (it
    // already includes PPN, so PPN 0%); the trace starts at the base cell K to link the analysis, and the formula is
    // kept so the analysis is checked against L.
    const ppn = ppnOf(model, sheet, r, cols.price);
    rows.push({
      ...base,
      rowType: 'ITEM',
      parentRow: parentItem ?? subsection ?? section,
      volume: quantity ?? '0',
      unit: unit || null,
      // Every RAB item needs a PPN % to be counted in the totals (calc/rab.ts); an explicit mapping value wins.
      taxPercent: cols.taxPercent ?? '0',
      sourceUnitPrice: price,
      workbook: { unitPriceWithTax: raw(r, cols.price), subtotal: raw(r, cols.amount) },
      priceCell: { sheet, row: r, col: ppn ? ppn.baseCol : cols.price },
      ...(ppn
        ? { sourcePriceFormula: { baseCell: `${columnName(ppn.baseCol)}${r}`, factor: ppn.factor, rounding: ppn.rounding, scale: ppn.scale } }
        : {}),
    });
  }

  const columns: RabColumns = {
    headerRow: cols.headerRow,
    no: cols.code,
    description: cols.description,
    analysis: null,
    volume: cols.quantity,
    unit: cols.unit ?? cols.quantity + 1,
    price: cols.price,
    tax: null,
    priceWithTax: cols.price,
    amount: cols.amount,
    block: null,
  };
  // Headings without any item below them have nothing to price (same rule as the office layout).
  const byRow = new Map(rows.map((x) => [x.row, x]));
  const used = new Set<number>();
  for (const item of rows.filter((x) => x.rowType === 'ITEM'))
    for (let p = item.parentRow; p !== null && !used.has(p); p = byRow.get(p)?.parentRow ?? null) used.add(p);
  return { sheet, columns, rows: rows.filter((x) => x.rowType === 'ITEM' || used.has(x.row)), totals: null, headerless: cols };
}
