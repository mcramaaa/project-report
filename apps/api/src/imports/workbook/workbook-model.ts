import { Decimal } from '@laporan-proyek/calc';
import type ExcelJS from 'exceljs';
import { isCompactWorkbook, type CompactSheet, type CompactWorkbook } from './compact-workbook';
import { formatAddress, parseFormula, type CellAddress, type FormulaNode } from './formula';

export type CellScalar = number | string | boolean | Date | null;

/**
 * Excel stores numbers as binary floats (39.39 -> 39.390000000000001); 15 significant digits is what
 * Excel itself keeps, so that is the decimal value at this import boundary.
 */
export function excelDecimal(value: CellScalar): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Decimal(value.toPrecision(15)).toFixed();
}

export interface CellInfo {
  address: Required<CellAddress> & { sheet: string };
  /** Cached value (formula result or literal). */
  value: CellScalar;
  formula: string | null;
}

/** One sheet as the model reads it: name, extent and cell access without exceljs objects. */
interface SheetView {
  name: string;
  rowCount: number;
  columnCount: number;
  /** `null` for an empty cell or one covered by a merge (Excel stores nothing there). */
  cell(row: number, col: number): { value: CellScalar; formula: string | null } | null;
}

function compactView(s: CompactSheet): SheetView {
  return {
    name: s.name,
    rowCount: s.rowCount,
    columnCount: s.columnCount,
    cell(row, col) {
      const r = s.rows[row];
      if (!r) return null;
      const value = r.v[col] ?? null;
      const formula = r.f?.[col] ?? null;
      return value === null && formula === null ? null : { value, formula };
    },
  };
}

function excelView(ws: ExcelJS.Worksheet): SheetView {
  return {
    name: ws.name,
    rowCount: ws.rowCount,
    columnCount: ws.columnCount,
    cell(row, col) {
      // findCell does not create empty cells (getCell would, for every probe).
      const c = ws.findCell(row, col);
      // Cells covered by a merge report the master's value in exceljs; Excel stores nothing there.
      if (!c || (c.isMerged && c.master.address !== c.address)) return null;
      const formula = typeof c.formula === 'string' && c.formula ? c.formula : null;
      return { value: formula ? toScalar(c.result) : toScalar(c.value), formula };
    },
  };
}

/**
 * Read-only view over a workbook with cached values and lazily parsed formulas.
 * Production loads a `CompactWorkbook` (streamed, see compact-workbook.ts); tests may pass an exceljs workbook.
 */
export class WorkbookModel {
  private readonly parsed = new Map<string, FormulaNode>();
  private readonly lookupIndex = new Map<string, Map<string, number[]>>();
  private readonly sheets: SheetView[];
  /** Lower-cased name → sheet. Every cell read looks its sheet up, so a list scan costs seconds on 100+ sheets. */
  private readonly byName = new Map<string, SheetView>();

  constructor(
    readonly documentId: string,
    readonly filename: string,
    workbook: ExcelJS.Workbook | CompactWorkbook,
  ) {
    this.sheets = isCompactWorkbook(workbook) ? workbook.sheets.map(compactView) : workbook.worksheets.map(excelView);
    // First sheet wins on a case-insensitive name clash, as the list scan did.
    for (const s of this.sheets) if (!this.byName.has(s.name.toLowerCase())) this.byName.set(s.name.toLowerCase(), s);
  }

  sheetNames(): string[] {
    return this.sheets.map((s) => s.name);
  }

  hasSheet(name: string): boolean {
    return Boolean(this.findSheet(name));
  }

  rowCount(sheet: string): number {
    return this.findSheet(sheet)?.rowCount ?? 0;
  }

  columnCount(sheet: string): number {
    return this.findSheet(sheet)?.columnCount ?? 0;
  }

  /** Excel compares sheet names case-insensitively. */
  private findSheet(name: string): SheetView | undefined {
    return this.byName.get(name.toLowerCase());
  }

  sheetName(name: string): string | null {
    return this.findSheet(name)?.name ?? null;
  }

  cell(sheet: string, row: number, col: number): CellInfo {
    const ws = this.findSheet(sheet);
    const address = { sheet: ws?.name ?? sheet, row, col };
    const c = ws?.cell(row, col);
    return c ? { address, value: c.value, formula: c.formula } : { address, value: null, formula: null };
  }

  formulaOf(info: CellInfo): FormulaNode | null {
    if (!info.formula) return null;
    const key = formatAddress(info.address);
    let node = this.parsed.get(key);
    if (!node) {
      node = parseFormula(info.formula);
      this.parsed.set(key, node);
    }
    return node;
  }

  /** Rows (ascending) of the first-column cells equal to `key` under Excel exact-match rules, cached per range. */
  lookupRows(sheet: string, col: number, startRow: number, endRow: number, key: CellScalar): number[] {
    const id = `${sheet.toLowerCase()}|${col}|${startRow}|${endRow}`;
    let index = this.lookupIndex.get(id);
    if (!index) {
      index = new Map();
      const last = Math.min(endRow, this.rowCount(sheet));
      for (let r = startRow; r <= last; r++) {
        const k = lookupKey(this.cell(sheet, r, col).value);
        if (k === null) continue;
        const rows = index.get(k);
        if (rows) rows.push(r);
        else index.set(k, [r]);
      }
      this.lookupIndex.set(id, index);
    }
    const k = lookupKey(key);
    return k === null ? [] : (index.get(k) ?? []);
  }

  text(sheet: string, row: number, col: number): string {
    const v = this.cell(sheet, row, col).value;
    return v === null || v === undefined || v instanceof Date ? '' : String(v).replace(/\s+/g, ' ').trim();
  }

  number(sheet: string, row: number, col: number): number | null {
    const v = this.cell(sheet, row, col).value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
}

function toScalar(value: ExcelJS.CellValue | undefined): CellScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return toScalar(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return null;
  }
  return null;
}

/** VLOOKUP exact match: numbers by value, text case-insensitively (no trimming), types never mix. */
function lookupKey(value: CellScalar): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (value instanceof Date) return `n:${value.getTime()}`;
  return `s:${value.toLowerCase()}`;
}
