import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { loadCompactWorkbook } from './compact-workbook';
import { WorkbookModel } from './workbook-model';

// Office workbooks stay out of Git (storage/temp); this comparison runs where they are present.
const dir = resolve(__dirname, '../../../../../storage/temp');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$')) : [];

describe.skipIf(files.length === 0)('compact loader against exceljs on real office workbooks (storage/temp)', () => {
  for (const file of files) {
    it(`${file}: every sheet, extent and cell match`, async () => {
      const path = resolve(dir, file);
      const full = new ExcelJS.Workbook();
      await full.xlsx.readFile(path);
      const expected = new WorkbookModel('doc', file, full);

      const started = process.hrtime.bigint();
      const actual = new WorkbookModel('doc', file, await loadCompactWorkbook(path));
      const ms = Number(process.hrtime.bigint() - started) / 1e6;

      expect(actual.sheetNames()).toEqual(expected.sheetNames());
      let cells = 0;
      /** A text formula result in a date-formatted cell: exceljs turns it into an invalid Date, the compact loader keeps the text. */
      let textKeptInDateCell = 0;
      const mismatches: string[] = [];
      for (const sheet of expected.sheetNames()) {
        if (actual.rowCount(sheet) !== expected.rowCount(sheet)) mismatches.push(`${sheet}: rowCount ${actual.rowCount(sheet)} ≠ ${expected.rowCount(sheet)}`);
        if (actual.columnCount(sheet) !== expected.columnCount(sheet)) mismatches.push(`${sheet}: columnCount ${actual.columnCount(sheet)} ≠ ${expected.columnCount(sheet)}`);
        const rows = expected.rowCount(sheet);
        const cols = expected.columnCount(sheet);
        for (let r = 1; r <= rows; r++)
          for (let c = 1; c <= cols; c++) {
            const e = expected.cell(sheet, r, c);
            const a = actual.cell(sheet, r, c);
            cells++;
            if (e.formula === a.formula && e.value instanceof Date && Number.isNaN(e.value.getTime()) && typeof a.value === 'string' && a.value !== '') {
              textKeptInDateCell++;
              continue;
            }
            if (!same(e.value, a.value) || e.formula !== a.formula) {
              if (mismatches.length < 25) mismatches.push(`${sheet}!R${r}C${c}: exceljs ${show(e)} vs compact ${show(a)}`);
              else if (mismatches.length === 25) mismatches.push('…');
            }
          }
      }
      console.log(
        `${file}: ${expected.sheetNames().length} sheets, ${cells} cells compared, ${textKeptInDateCell} text results kept in date cells, compact load ${ms.toFixed(0)} ms`,
      );
      expect(mismatches).toEqual([]);
    });
  }
});

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  return a === b;
}

function show(c: { value: unknown; formula: string | null }): string {
  const v = c.value instanceof Date ? (Number.isNaN(c.value.getTime()) ? 'Invalid Date' : c.value.toISOString()) : c.value;
  return JSON.stringify({ v, f: c.formula });
}
