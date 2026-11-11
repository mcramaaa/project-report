import { Decimal } from '@laporan-proyek/calc';
import type { AhspCategory } from '@laporan-proyek/shared';
import { formatAddress, type FormulaNode } from './formula';
import type { TraceResult } from './trace';
import { excelDecimal, type CellInfo, type WorkbookModel } from './workbook-model';

/**
 * Reads one analysis block (header row + "NO. | URAIAN | SATUAN | KOEFISIEN | HARGA SATUAN | JUMLAH HARGA"
 * label row + component rows + D/E/F rows) by following the formulas of its price cell (D-051):
 *   F = D + E,  E = D × (pct / 100),  D = Σ subtotals,  subtotal = SUM(component amounts),
 *   amount = price × coefficient.
 * Labels only classify categories; numbers always come from the formulas they belong to.
 */

export interface BlockColumns {
  no: number;
  description: number;
  unit: number;
  coefficient: number;
  price: number;
  amount: number;
}

export interface BlockComponent {
  row: number;
  /** Coefficient cell was blank (Excel: 0). */
  blankCoefficient: boolean;
  category: AhspCategory;
  description: string;
  unit: string | null;
  coefficient: string;
  /** Cached amount (price × coefficient) for reconciliation; raw float kept for the comparison (D-054). */
  sourceAmount: string | null;
  sourceAmountRaw: number | null;
  priceCell: { sheet: string; row: number; col: number };
  /** Column of the block's amounts (price × coefficient), to tell a component's amount from other cells on its row. */
  amountCol: number;
}

export interface AnalysisBlock {
  sheet: string;
  headerRow: number;
  code: string | null;
  name: string;
  unit: string | null;
  priceCell: string;
  overheadPercent: string | null;
  sourceDirectCost: string | null;
  sourcePriceExact: string | null;
  sourceDirectCostRaw: number | null;
  sourcePriceExactRaw: number | null;
  /**
   * Overhead row E = D × pct written in the block while the header price points at D itself: the source
   * prices without it. Evidence for a review warning; the app keeps the source price (no overhead).
   */
  unusedOverhead: { percent: string; overheadCell: string; percentCell: string; directCell: string } | null;
  /** F written as ROUND(D + E, n) (Bina Marga sheets): the block itself rounds its price to n decimals (D-091). */
  priceRounding: number | null;
  /**
   * F written as ROUNDUP/ROUNDDOWN(D + E, n): not an analysis rounding of the app (half-up only); the analysis keeps
   * D + E and the rounding belongs to how the source price is formed (D-092 source price formula).
   */
  sourceRounding: SourceRounding | null;
  components: BlockComponent[];
}

const LABELS: Record<keyof BlockColumns, RegExp> = {
  no: /^NO\.?$/,
  description: /^URAIAN/,
  unit: /^SATUAN$/,
  coefficient: /^KOEFISIEN$/,
  price: /^HARGA SATUAN/,
  amount: /^JUMLAH HARGA/,
};

const CATEGORY: [RegExp, AhspCategory][] = [
  [/^(TENAGA( KERJA)?|UPAH|PEKERJA)$/, 'LABOR'],
  [/^(BAHAN|MATERIAL)$/, 'MATERIAL'],
  [/^(PERALATAN|ALAT)$/, 'EQUIPMENT'],
];

export class BlockError extends Error {}

export interface SourceRounding {
  mode: 'UP' | 'DOWN' | 'NEAREST';
  scale: number;
}

/** ROUND/ROUNDUP/ROUNDDOWN(x, n) with a literal n → the mode, scale and inner expression; else null. */
export function roundingCall(node: FormulaNode | null): { rounding: SourceRounding; inner: FormulaNode } | null {
  if (!node || node.kind !== 'call' || node.args.length !== 2 || node.args[1]!.kind !== 'number') return null;
  const mode = node.name === 'ROUND' ? 'NEAREST' : node.name === 'ROUNDUP' ? 'UP' : node.name === 'ROUNDDOWN' ? 'DOWN' : null;
  return mode ? { rounding: { mode, scale: node.args[1].value }, inner: node.args[0]! } : null;
}

/** Label row of a block directly below `headerRow`, or null when the row is not an analysis header. */
export function blockColumns(model: WorkbookModel, sheet: string, headerRow: number): BlockColumns | null {
  const labelRow = headerRow + 1;
  const found: Partial<BlockColumns> = {};
  const last = Math.min(model.columnCount(sheet), 40);
  for (let c = 1; c <= last; c++) {
    const label = model.text(sheet, labelRow, c).toUpperCase();
    if (!label) continue;
    for (const [key, pattern] of Object.entries(LABELS) as [keyof BlockColumns, RegExp][]) {
      if (found[key] === undefined && pattern.test(label)) found[key] = c;
    }
  }
  return Object.keys(LABELS).every((k) => found[k as keyof BlockColumns] !== undefined) ? (found as BlockColumns) : null;
}

/**
 * Bina Marga analysis form (D-091): label row "KOMPONEN | SATUAN | PERKIRAAN KUANTITAS | HARGA SATUAN | JUMLAH HARGA",
 * titles over two rows, beside an assumptions part on the left ("No. | URAIAN | KODE | KOEF. | SATUAN"). Columns
 * are taken right of KOMPONEN only, so the left part never matches. `no` = description column (no code column).
 */
export function binaMargaColumns(model: WorkbookModel, sheet: string, labelRow: number): BlockColumns | null {
  const last = Math.min(model.columnCount(sheet), 40);
  let description = 0;
  for (let c = 1; c <= last && !description; c++) if (/^KOMPONEN\b/.test(model.text(sheet, labelRow, c).toUpperCase().trim())) description = c;
  if (!description) return null;
  // Titles run over two rows, downwards ("HARGA" / "SATUAN" under the KOMPONEN row) or upwards ("PERKIRAAN" above
  // "KUANTITAS"): a column matches when either reading does.
  const text = (rows: number[], c: number) => rows.map((r) => (r >= 1 ? model.text(sheet, r, c).toUpperCase() : '')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const right = (pattern: RegExp) => {
    for (let c = description + 1; c <= last; c++) if (pattern.test(text([labelRow, labelRow + 1], c)) || pattern.test(text([labelRow - 1, labelRow], c))) return c;
    return 0;
  };
  const unit = right(/^SATUAN$/);
  const coefficient = right(/^(PERKIRAAN )?KUANTITAS\b/) || right(/^KOEF/);
  const price = right(/^HARGA SATUAN/);
  const amount = right(/^JUMLAH HARGA/);
  return unit && coefficient && price && amount ? { no: description, description, unit, coefficient, price, amount } : null;
}

/** Amount values may sit a few columns right of their merged title ("JUMLAH HARGA" over S:U, values in U). */
const AMOUNT_SPAN = 3;

/** Bina Marga block containing `cell` in its amount column: the nearest label row above it. */
function binaMargaBlockAt(model: WorkbookModel, sheet: string, row: number, col: number): number | null {
  for (let r = row - 1; r >= Math.max(1, row - 150); r--) {
    const cols = binaMargaColumns(model, sheet, r);
    if (cols) return col >= cols.amount && col <= cols.amount + AMOUNT_SPAN ? r : null;
  }
  return null;
}

/** Columns of a Bina Marga block with the amount column moved to where the values are (the total row's formula). */
function binaMargaBlock(model: WorkbookModel, sheet: string, labelRow: number): { cols: BlockColumns; totalRow: number } | null {
  const cols = binaMargaColumns(model, sheet, labelRow);
  if (!cols) return null;
  for (let r = labelRow + 2; r <= Math.min(model.rowCount(sheet), labelRow + 200); r++) {
    if (binaMargaColumns(model, sheet, r)) return null;
    const label = [cols.description, cols.description + 1, cols.description + 2, cols.description + 3].map((c) => model.text(sheet, r, c).toUpperCase()).find(Boolean) ?? '';
    if (!/^(TOTAL HARGA|HARGA SATUAN PEKERJAAN)/.test(label)) continue;
    for (let c = cols.amount; c <= cols.amount + AMOUNT_SPAN; c++) if (model.formulaOf(model.cell(sheet, r, c))) return { cols: { ...cols, amount: c }, totalRow: r };
  }
  return null;
}

/**
 * The analysis a trace reaches: an office header step (the row directly above a block label row), or, for the
 * Bina Marga form, the total price cell (F) the chain ends on. `headerRow` is then the block's label row.
 */
export function analysisHeaderIn(
  model: WorkbookModel,
  trace: TraceResult,
): { sheet: string; headerRow: number; stepIndex: number; endRounding?: SourceRounding } | null {
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const m = /^(.*)!([A-Z]+)(\d+)$/.exec(trace.steps[i]!.cell);
    if (!m) continue;
    const sheet = m[1]!;
    const row = Number(m[3]);
    if (blockColumns(model, sheet, row)) return { sheet, headerRow: row, stepIndex: i };
  }
  const end = trace.terminal;
  const sheet = model.sheetName(end.address.sheet);
  if (trace.terminalKind !== 'FORMULA' || !end.formula || !sheet) return null;
  // The chain may end on F itself, or on a rounding of F below it ("G | Dibulatkan = ROUNDDOWN(G96, 0)").
  const wrapped = roundingCall(model.formulaOf(end));
  const candidates: { row: number; col: number; endRounding?: SourceRounding }[] = [{ row: end.address.row, col: end.address.col }];
  if (wrapped && wrapped.inner.kind === 'ref' && (!wrapped.inner.ref.sheet || model.sheetName(wrapped.inner.ref.sheet) === sheet)) {
    candidates.push({ row: wrapped.inner.ref.row, col: wrapped.inner.ref.col, endRounding: wrapped.rounding });
  }
  for (const c of candidates) {
    const labelRow = binaMargaBlockAt(model, sheet, c.row, c.col);
    const block = labelRow !== null ? binaMargaBlock(model, sheet, labelRow) : null;
    if (labelRow !== null && block && block.totalRow === c.row && block.cols.amount === c.col) {
      return { sheet, headerRow: labelRow, stepIndex: trace.steps.length - 1, ...(c.endRounding ? { endRounding: c.endRounding } : {}) };
    }
    const officeHeader = officeBlockAt(model, sheet, c.row, c.col);
    if (officeHeader !== null) {
      return { sheet, headerRow: officeHeader, stepIndex: trace.steps.length - 1, ...(c.endRounding ? { endRounding: c.endRounding } : {}) };
    }
  }
  return null;
}

/** Office-label block whose F (by label) is the given cell: the title row above its label row. */
function officeBlockAt(model: WorkbookModel, sheet: string, row: number, col: number): number | null {
  for (let r = row - 2; r >= Math.max(1, row - 150); r--) {
    const cols = blockColumns(model, sheet, r);
    if (!cols) continue;
    return cols.amount === col && officeTotalRow(model, sheet, r, cols) === row ? r : null;
  }
  return null;
}

/** Title of the Bina Marga block whose amount column holds `cell` (e.g. its D row used as another analysis' price). */
export function binaMargaTitleAt(model: WorkbookModel, sheet: string, row: number, col: number): { code: string | null; name: string } | null {
  const labelRow = binaMargaBlockAt(model, sheet, row, col);
  if (labelRow === null) return null;
  const { code, name } = binaMargaTitle(model, sheet, labelRow);
  return name || code ? { code, name } : null;
}

/** "ITEM PEMBAYARAN NO." / "JENIS PEKERJAAN" / "SATUAN PEMBAYARAN" values above a Bina Marga label row. */
function binaMargaTitle(model: WorkbookModel, sheet: string, labelRow: number): { code: string | null; name: string; unit: string | null } {
  // Nearest title above the label row: the form repeats it top-left and beside the cost table.
  // Copies beside the cost table are filled by formulas that are sometimes swapped (code under "JENIS PEKERJAAN");
  // a value must look like what its label promises, and other form labels are never values.
  const FORM_LABEL = /^(TOTAL HARGA|PERKIRAAN VOL|% THD|ITEM PEMBAYARAN|JENIS PEKERJAAN|SATUAN PEMBAYARAN|NO\. PAKET|NAMA PAKET)/i;
  const looksLikeCode = (t: string) => /\d/.test(t) && !/\s{1}\S+\s/.test(t) && t.length <= 30;
  const value = (pattern: RegExp, accept: (t: string) => boolean): string | null => {
    const last = Math.min(model.columnCount(sheet), 40);
    for (let r = labelRow - 1; r >= Math.max(1, labelRow - 25); r--) {
      for (let c = 1; c <= last; c++) {
        if (!pattern.test(model.text(sheet, r, c).toUpperCase())) continue;
        for (let v = c + 1; v <= Math.min(last, c + 6); v++) {
          const t = model.text(sheet, r, v).replace(/^:\s*/, '').replace(/^\((.*)\)$/, '$1').trim();
          if (!t || t === ':') continue;
          if (FORM_LABEL.test(t) || !accept(t)) break;
          return t;
        }
      }
    }
    return null;
  };
  return {
    code: value(/^ITEM PEMBAYARAN/, looksLikeCode),
    name: value(/^JENIS PEKERJAAN/, (t) => !looksLikeCode(t)) ?? '',
    unit: value(/^SATUAN PEMBAYARAN/, (t) => t.length <= 15),
  };
}

const refsOf = (node: FormulaNode): { sheet: string | null; row: number; col: number }[] => {
  if (node.kind === 'ref') return [node.ref];
  if (node.kind === 'unary') return refsOf(node.operand);
  if (node.kind === 'binary' && node.op === '+') return [...refsOf(node.left), ...refsOf(node.right)];
  if (node.kind === 'call' && node.name === 'SUM') {
    return node.args.flatMap((a) => {
      if (a.kind === 'range') {
        const out = [];
        for (let r = a.start.row; r <= a.end.row; r++) for (let c = a.start.col; c <= a.end.col; c++) out.push({ sheet: a.start.sheet, row: r, col: c });
        return out;
      }
      return refsOf(a);
    });
  }
  throw new BlockError('bukan penjumlahan referensi');
};

/** D × (pct / 100), D × pct% → the percentage cell; D × f (Cipta Karya: f = 0.1) → the fraction cell (`fraction`). */
function overheadCell(node: FormulaNode, directRow: number, directCol: number): { row: number; col: number; fraction?: true } | null {
  if (node.kind === 'unary') return overheadCell(node.operand, directRow, directCol);
  if (node.kind !== 'binary' || node.op !== '*') return null;
  const plain = (n: FormulaNode): FormulaNode => (n.kind === 'unary' && n.op === '+' ? plain(n.operand) : n);
  const isDirect = (n: FormulaNode) => {
    const p = plain(n);
    return p.kind === 'ref' && p.ref.row === directRow && p.ref.col === directCol && !p.ref.sheet;
  };
  const left = plain(node.left);
  const right = plain(node.right);
  const other = isDirect(left) ? right : isDirect(right) ? left : null;
  if (!other) return null;
  if (other.kind === 'binary' && other.op === '/' && other.left.kind === 'ref' && other.right.kind === 'number' && other.right.value === 100) return other.left.ref;
  if (other.kind === 'percent' && other.operand.kind === 'ref') return other.operand.ref;
  if (other.kind === 'ref' && !other.ref.sheet) return { ...other.ref, fraction: true };
  return null;
}

/** Overhead % from its cell: a fraction (0.1) is converted to percent (10) in decimal. */
function overheadPercentOf(model: WorkbookModel, sheet: string, cell: { row: number; col: number; fraction?: true }): string | null {
  const v = excelDecimal(model.cell(sheet, cell.row, cell.col).value);
  return v === null ? null : cell.fraction ? new Decimal(v).times(100).toFixed() : v;
}

export function readAnalysisBlock(model: WorkbookModel, sheet: string, headerRow: number): AnalysisBlock {
  const cols = blockColumns(model, sheet, headerRow);
  if (!cols) {
    // Bina Marga form: `headerRow` is the label row; F is the "TOTAL HARGA PEKERJAAN" cell (D-091).
    if (!binaMargaColumns(model, sheet, headerRow)) throw new BlockError(`baris ${headerRow} bukan kepala analisa`);
    const bm = binaMargaBlock(model, sheet, headerRow);
    if (!bm) throw new BlockError(`baris TOTAL HARGA PEKERJAAN analisa baris ${headerRow} tidak ditemukan`);
    return readBlockFrom(model, sheet, headerRow, bm.cols, model.cell(sheet, bm.totalRow, bm.cols.amount), binaMargaTitle(model, sheet, headerRow), headerRow + 1);
  }
  const header = model.cell(sheet, headerRow, cols.amount);
  const fRef = model.formulaOf(header);
  // The header's price cell points at F ("Harga Satuan Pekerjaan"); a title row without a price (Cipta Karya
  // analyses) has F found by its label instead (D-091).
  const pointsAtF = !!fRef && fRef.kind === 'ref' && (!fRef.ref.sheet || model.sheetName(fRef.ref.sheet) === model.sheetName(sheet));
  const fByLabel = pointsAtF ? null : officeTotalRow(model, sheet, headerRow, cols);
  if (!pointsAtF && fByLabel === null) {
    throw new BlockError(`harga kepala analisa ${formatAddress(header.address)} tidak merujuk sel harga satuan pekerjaan`);
  }
  const unit = (() => {
    for (let c = cols.amount + 1; c <= Math.min(model.columnCount(sheet), cols.amount + 6); c++) {
      const t = model.text(sheet, headerRow, c);
      if (t && t.length <= 15 && !/^[\d.,]+$/.test(t)) return t;
    }
    return null;
  })();
  const title = officeTitle(model.text(sheet, headerRow, cols.no), model.text(sheet, headerRow, cols.description), unit);
  const fCell = fByLabel !== null ? model.cell(sheet, fByLabel, cols.amount) : model.cell(sheet, (fRef as Extract<FormulaNode, { kind: 'ref' }>).ref.row, (fRef as Extract<FormulaNode, { kind: 'ref' }>).ref.col);
  return readBlockFrom(model, sheet, headerRow, cols, fCell, title, headerRow);
}

/** Office title: NO + URAIAN cells; a title written whole in the first cell ("11.7.1.2 Pemasangan …") is split. */
function officeTitle(no: string, description: string, unit: string | null): { code: string | null; name: string; unit: string | null } {
  if (description || !no || no.length <= 30) return { code: no || null, name: description, unit };
  const m = /^(\d+(?:\.\d+)+[a-z]?)\s+(.+)$/i.exec(no);
  return m ? { code: m[1]!, name: m[2]!, unit } : { code: null, name: no, unit };
}

/** Row of F in an office-label block: "F | Harga Satuan Pekerjaan" with a formula in the amount column. */
function officeTotalRow(model: WorkbookModel, sheet: string, headerRow: number, cols: BlockColumns): number | null {
  for (let r = headerRow + 2; r <= Math.min(model.rowCount(sheet), headerRow + 200); r++) {
    if (blockColumns(model, sheet, r)) return null;
    const label = `${model.text(sheet, r, cols.no)} ${model.text(sheet, r, cols.description)}`.toUpperCase().trim();
    if (/^(F\.?\s+)?HARGA SATUAN PEKERJAAN\b/.test(label) && model.formulaOf(model.cell(sheet, r, cols.amount))) return r;
  }
  return null;
}

/**
 * F = D + E, E = D × pct, D = Σ subtotals, subtotal = SUM(price × coefficient) from the total price cell F; shared by
 * the office and Bina Marga forms. `categoryFloor` = the row above which category labels are not searched.
 */
function readBlockFrom(
  model: WorkbookModel,
  sheet: string,
  headerRow: number,
  cols: BlockColumns,
  fCell: CellInfo,
  title: { code: string | null; name: string; unit: string | null },
  categoryFloor: number,
): AnalysisBlock {
  let f = model.formulaOf(fCell);
  if (!f) throw new BlockError(`sel harga ${formatAddress(fCell.address)} tidak berumus`);
  // F = ROUND/ROUNDUP/ROUNDDOWN(D + E, n): the sum inside is the price. ROUND is the block's own rounding
  // (priceRounding); ROUNDUP/ROUNDDOWN are kept as how the source price is formed (sourceRounding).
  let priceRounding: number | null = null;
  let sourceRounding: SourceRounding | null = null;
  const wrapped = roundingCall(f);
  if (wrapped) {
    if (wrapped.rounding.mode === 'NEAREST') priceRounding = wrapped.rounding.scale;
    else sourceRounding = wrapped.rounding;
    f = wrapped.inner;
  }
  const rounded = wrapped !== null;

  // F = D + E when one part is D × pct (overhead); otherwise every part is direct cost (no overhead).
  const fParts = refsOf(f);
  let directParts = fParts;
  let overheadPercent: string | null = null;
  let directCell: { row: number; col: number } | null = null;
  for (const e of fParts) {
    const eNode = model.formulaOf(model.cell(sheet, e.row, e.col));
    if (!eNode) continue;
    const base = fParts.find((dPart) => dPart !== e && overheadCell(eNode, dPart.row, dPart.col));
    if (!base) continue;
    const pct = overheadCell(eNode, base.row, base.col)!;
    overheadPercent = overheadPercentOf(model, sheet, pct);
    if (overheadPercent === null) throw new BlockError('persentase overhead bukan angka');
    if (fParts.length !== 2) throw new BlockError(`rumus harga ${formatAddress(fCell.address)} memuat overhead dan bagian lain`);
    directParts = [base];
    directCell = base;
    break;
  }

  // Without overhead in F's chain, an E row of the block may still compute D × pct from the cell used.
  let unusedOverhead: AnalysisBlock['unusedOverhead'] = null;
  if (overheadPercent === null) {
    for (let r = fCell.address.row + 1; r <= Math.min(model.rowCount(sheet), fCell.address.row + 10) && !blockColumns(model, sheet, r) && !binaMargaColumns(model, sheet, r); r++) {
      const node = model.formulaOf(model.cell(sheet, r, cols.amount));
      const pct = node ? overheadCell(node, fCell.address.row, fCell.address.col) : null;
      const percent = pct ? overheadPercentOf(model, sheet, pct) : null;
      if (!pct || percent === null) continue;
      unusedOverhead = {
        percent,
        overheadCell: formatAddress(model.cell(sheet, r, cols.amount).address),
        percentCell: formatAddress(model.cell(sheet, pct.row, pct.col).address),
        directCell: formatAddress(fCell.address),
      };
      break;
    }
  }

  // D = Σ subtotals; subtotal = SUM(amount cells), a single reference, or a sum of references.
  const dCell = directCell ? model.cell(sheet, directCell.row, directCell.col) : fCell;
  const dParts = directCell ? (() => {
    const d = model.formulaOf(dCell);
    if (!d) throw new BlockError(`biaya langsung ${formatAddress(dCell.address)} tidak berumus`);
    return refsOf(d);
  })() : directParts;
  const seen = new Set<number>();
  const components: BlockComponent[] = [];
  // Subtotals may be SUM(range), a single reference (=H301), or sums of references; expand down to the
  // price × coefficient cells of the amount column.
  const expand = (row: number, col: number, depth: number) => {
    if (depth > 6 || col !== cols.amount || seen.has(row)) return;
    const cell = model.cell(sheet, row, col);
    const node = model.formulaOf(cell);
    if (!node) return; // empty or literal slot: no component
    if (isProduct(node)) {
      seen.add(row);
      const comp = readComponent(model, sheet, categoryFloor, row, cols);
      if (comp) components.push(comp);
      return;
    }
    seen.add(row);
    for (const r of refsOf(node)) {
      if (r.sheet && model.sheetName(r.sheet) !== model.sheetName(sheet)) throw new BlockError(`subtotal ${formatAddress(cell.address)} merujuk sheet lain`);
      expand(r.row, r.col, depth + 1);
    }
  };
  for (const sub of dParts) expand(sub.row, sub.col, 0);
  components.sort((x, y) => x.row - y.row);

  return {
    sheet: model.sheetName(sheet) ?? sheet,
    headerRow,
    code: title.code,
    name: title.name,
    unit: title.unit,
    priceCell: formatAddress(fCell.address),
    overheadPercent,
    sourceDirectCost: excelDecimal(dCell.value),
    // With ROUND in F the comparable workbook value is the unrounded D + E, i.e. the sum of F's cached parts.
    sourcePriceExact: excelDecimal(!rounded ? fCell.value : partsValue(model, sheet, fParts)),
    sourceDirectCostRaw: typeof dCell.value === 'number' ? dCell.value : null,
    sourcePriceExactRaw: !rounded ? (typeof fCell.value === 'number' ? fCell.value : null) : partsValue(model, sheet, fParts),
    unusedOverhead,
    priceRounding,
    sourceRounding,
    components,
  };
}

/** Sum of the cached values of F's parts (D and E), or null when one is not a number. */
function partsValue(model: WorkbookModel, sheet: string, parts: { row: number; col: number }[]): number | null {
  let sum = 0;
  for (const p of parts) {
    const v = model.cell(sheet, p.row, p.col).value;
    if (typeof v !== 'number') return null;
    sum += v;
  }
  return sum;
}

const isProduct = (n: FormulaNode): boolean =>
  n.kind === 'unary' && n.op === '+' ? isProduct(n.operand) : n.kind === 'binary' && n.op === '*';

/** null for category label rows that carry a product formula but no coefficient ("PERALATAN"). */
function readComponent(model: WorkbookModel, sheet: string, headerRow: number, row: number, cols: BlockColumns): BlockComponent | null {
  const amount = model.cell(sheet, row, cols.amount);
  const node = model.formulaOf(amount)!;
  const factors: { row: number; col: number }[] = [];
  const collect = (n: FormulaNode): boolean => {
    if (n.kind === 'unary' && n.op === '+') return collect(n.operand);
    if (n.kind === 'binary' && n.op === '*') return collect(n.left) && collect(n.right);
    if (n.kind === 'ref' && !n.ref.sheet) {
      factors.push(n.ref);
      return true;
    }
    return false;
  };
  if (!collect(node) || factors.length !== 2 || !factors.every((f) => f.row === row)) {
    throw new BlockError(`nilai komponen ${formatAddress(amount.address)} bukan harga × koefisien`);
  }
  const hasCoef = factors.some((f) => f.col === cols.coefficient);
  const hasPrice = factors.some((f) => f.col === cols.price);
  if (!hasCoef || !hasPrice) throw new BlockError(`nilai komponen ${formatAddress(amount.address)} tidak memakai kolom harga dan koefisien`);
  const description = model.text(sheet, row, cols.description);
  const coefValue = model.cell(sheet, row, cols.coefficient).value;
  if ((coefValue === null || coefValue === '') && (!description || CATEGORY.some(([pattern]) => pattern.test(description.toUpperCase())))) return null;
  // Excel evaluates a blank coefficient as 0; the component stays with coefficient 0 (D-046).
  const blankCoefficient = coefValue === null || coefValue === '';
  const coefficient = blankCoefficient ? '0' : excelDecimal(coefValue);
  if (coefficient === null) throw new BlockError(`koefisien baris ${row} bukan angka`);

  let category: AhspCategory | null = null;
  for (let r = row - 1; r > headerRow && !category; r--) {
    const label = model.text(sheet, r, cols.description).toUpperCase();
    for (const [pattern, cat] of CATEGORY) if (pattern.test(label)) category = cat;
  }
  if (!category) throw new BlockError(`kategori komponen baris ${row} tidak dikenali`);

  return {
    row,
    blankCoefficient,
    category,
    description,
    unit: model.text(sheet, row, cols.unit) || null,
    coefficient,
    sourceAmount: excelDecimal(amount.value),
    sourceAmountRaw: typeof amount.value === 'number' ? amount.value : null,
    priceCell: { sheet: model.sheetName(sheet) ?? sheet, row, col: cols.price },
    amountCol: cols.amount,
  };
}

/** Header rows of every analysis block in a sheet (to report what the import left out). */
export function countAnalysisBlocks(model: WorkbookModel, sheet: string): number {
  let n = 0;
  for (let r = 1; r < model.rowCount(sheet); r++) {
    const office = blockColumns(model, sheet, r);
    if (office && model.formulaOf(model.cell(sheet, r, office.amount))) n++;
    else if (!office && binaMargaBlock(model, sheet, r)) n++;
  }
  return n;
}
