import ExcelJS from 'exceljs';
import { WorkbookModel } from './workbook/workbook-model';

/** Cell spec: literal, or [formula, cached result] like a saved Excel file. */
export type Cell = string | number | null | [string, number | string];
export type SheetSpec = Record<string, Cell>;

/** Builds an in-memory workbook (no real project data) and wraps it for the parser. */
export function workbookOf(sheets: Record<string, SheetSpec>, id = 'doc-1'): WorkbookModel {
  const wb = new ExcelJS.Workbook();
  for (const [name, cells] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const [addr, value] of Object.entries(cells)) {
      if (value === null) continue;
      ws.getCell(addr).value = Array.isArray(value) ? { formula: value[0], result: value[1] } : value;
    }
  }
  return new WorkbookModel(id, `${id}.xlsx`, wb);
}

/** One analysis block in the office layout (header row r, labels r+1, components, D/E/F). */
export function analysisBlock(
  r: number,
  spec: {
    seq: number;
    code: string;
    name: string;
    unit: string;
    overhead?: number | null;
    components: { category: 'TENAGA' | 'BAHAN' | 'PERALATAN'; name: string; unit: string; coef: number | null; price: Cell }[];
  },
): { cells: SheetSpec; priceRow: number; price: number } {
  const cells: SheetSpec = {};
  cells[`A${r}`] = spec.seq;
  cells[`B${r}`] = spec.code;
  cells[`C${r}`] = spec.name;
  cells[`K${r}`] = spec.unit;
  Object.assign(cells, { [`B${r + 1}`]: 'NO.', [`C${r + 1}`]: 'URAIAN', [`E${r + 1}`]: 'SATUAN', [`F${r + 1}`]: 'KOEFISIEN', [`G${r + 1}`]: 'HARGA SATUAN', [`H${r + 1}`]: 'JUMLAH HARGA' });
  let row = r + 2;
  const subtotals: string[] = [];
  let direct = 0;
  for (const category of ['TENAGA', 'BAHAN', 'PERALATAN'] as const) {
    const comps = spec.components.filter((c) => c.category === category);
    if (!comps.length) continue;
    cells[`C${row++}`] = category;
    const first = row;
    for (const c of comps) {
      const price = Array.isArray(c.price) ? Number(c.price[1]) : Number(c.price);
      cells[`C${row}`] = c.name;
      cells[`E${row}`] = c.unit;
      cells[`F${row}`] = c.coef;
      cells[`G${row}`] = c.price;
      const amount = (c.coef ?? 0) * price;
      cells[`H${row}`] = [`G${row}*F${row}`, amount];
      direct += amount;
      row++;
    }
    const sum = spec.components.filter((c) => c.category === category).reduce((s, c) => s + (c.coef ?? 0) * (Array.isArray(c.price) ? Number(c.price[1]) : Number(c.price)), 0);
    cells[`H${row}`] = [`SUM(H${first}:H${row - 1})`, sum];
    subtotals.push(`H${row}`);
    row++;
  }
  const dRow = row;
  cells[`C${dRow}`] = 'Jumlah (A + B + C)';
  cells[`H${dRow}`] = [subtotals.join('+'), direct];
  let price = direct;
  if (spec.overhead !== null) {
    const pct = spec.overhead ?? 10;
    cells[`C${dRow + 1}`] = 'Overhead & Profit';
    cells[`E${dRow + 1}`] = pct;
    cells[`H${dRow + 1}`] = [`+H${dRow}*(E${dRow + 1}/100)`, (direct * pct) / 100];
    price = direct + (direct * pct) / 100;
    cells[`H${dRow + 2}`] = [`+H${dRow + 1}+H${dRow}`, price];
    cells[`H${r}`] = [`H${dRow + 2}`, price];
  } else {
    cells[`H${dRow + 1}`] = [`H${dRow}`, price];
    cells[`H${r}`] = [`H${dRow + 1}`, price];
  }
  return { cells, priceRow: r, price };
}
