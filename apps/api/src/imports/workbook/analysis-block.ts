import type { AhspCategory } from '@laporan-proyek/shared';
import { formatAddress, type FormulaNode } from './formula';
import type { TraceResult } from './trace';
import { excelDecimal, type WorkbookModel } from './workbook-model';

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

/** The analysis header a trace passes through: the step whose row is directly above a block label row. */
export function analysisHeaderIn(model: WorkbookModel, trace: TraceResult): { sheet: string; headerRow: number; stepIndex: number } | null {
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const m = /^(.*)!([A-Z]+)(\d+)$/.exec(trace.steps[i]!.cell);
    if (!m) continue;
    const sheet = m[1]!;
    const row = Number(m[3]);
    if (blockColumns(model, sheet, row)) return { sheet, headerRow: row, stepIndex: i };
  }
  return null;
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

/** D × (pct / 100) or D × pct% → the percentage cell. */
function overheadCell(node: FormulaNode, directRow: number, directCol: number): { row: number; col: number } | null {
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
  return null;
}

export function readAnalysisBlock(model: WorkbookModel, sheet: string, headerRow: number): AnalysisBlock {
  const cols = blockColumns(model, sheet, headerRow);
  if (!cols) throw new BlockError(`baris ${headerRow} bukan kepala analisa`);
  const header = model.cell(sheet, headerRow, cols.amount);
  const fRef = model.formulaOf(header);
  // The header's price cell points at F ("Harga Satuan Pekerjaan").
  if (!fRef || fRef.kind !== 'ref' || (fRef.ref.sheet && model.sheetName(fRef.ref.sheet) !== model.sheetName(sheet))) {
    throw new BlockError(`harga kepala analisa ${formatAddress(header.address)} tidak merujuk sel harga satuan pekerjaan`);
  }
  const fCell = model.cell(sheet, fRef.ref.row, fRef.ref.col);
  const f = model.formulaOf(fCell);
  if (!f) throw new BlockError(`sel harga ${formatAddress(fCell.address)} tidak berumus`);

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
    overheadPercent = excelDecimal(model.cell(sheet, pct.row, pct.col).value);
    if (overheadPercent === null) throw new BlockError('persentase overhead bukan angka');
    if (fParts.length !== 2) throw new BlockError(`rumus harga ${formatAddress(fCell.address)} memuat overhead dan bagian lain`);
    directParts = [base];
    directCell = base;
    break;
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
      const comp = readComponent(model, sheet, headerRow, row, cols);
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

  const unit = (() => {
    for (let c = cols.amount + 1; c <= Math.min(model.columnCount(sheet), cols.amount + 6); c++) {
      const t = model.text(sheet, headerRow, c);
      if (t && t.length <= 15 && !/^[\d.,]+$/.test(t)) return t;
    }
    return null;
  })();

  return {
    sheet: model.sheetName(sheet) ?? sheet,
    headerRow,
    code: model.text(sheet, headerRow, cols.no) || null,
    name: model.text(sheet, headerRow, cols.description),
    unit,
    priceCell: formatAddress(fCell.address),
    overheadPercent,
    sourceDirectCost: excelDecimal(dCell.value),
    sourcePriceExact: excelDecimal(fCell.value),
    sourceDirectCostRaw: typeof dCell.value === 'number' ? dCell.value : null,
    sourcePriceExactRaw: typeof fCell.value === 'number' ? fCell.value : null,
    components,
  };
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
  };
}

/** Header rows of every analysis block in a sheet (to report what the import left out). */
export function countAnalysisBlocks(model: WorkbookModel, sheet: string): number {
  let n = 0;
  for (let r = 1; r < model.rowCount(sheet); r++) if (blockColumns(model, sheet, r) && model.formulaOf(model.cell(sheet, r, blockColumns(model, sheet, r)!.amount))) n++;
  return n;
}
