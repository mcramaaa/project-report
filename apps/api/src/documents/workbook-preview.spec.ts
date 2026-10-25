import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { WorkbookModel } from '../imports/workbook/workbook-model';
import { formulaReferences, previewWindow } from './workbook-preview';

describe('read-only workbook provenance', () => {
  it('lists syntactic cell/range references without claiming VLOOKUP results or executing external links', () => {
    expect(formulaReferences("ROUND('Harga Bahan'!C2*A1,0)+SUM(B3:B6)", 'Analisa')).toEqual([
      { sheet: 'Harga Bahan', cell: 'C2' },
      { sheet: 'Analisa', cell: 'A1' },
      { sheet: 'Analisa', cell: 'B3', range: 'B3:B6' },
    ]);
    expect(formulaReferences("'[1]Outside'!A1", 'Analisa')).toEqual([]);
    expect(formulaReferences(null, 'Analisa')).toEqual([]);
  });
  it('shows cached formula values in a bounded window, including Excel edge cells', () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('RAB');
    sheet.getCell('B2').value = { formula: 'A1*2', result: 123.5 };
    const model = new WorkbookModel('doc', 'rab.xlsx', book);
    const preview = previewWindow(model, 'RAB', 'B2');
    expect(preview.selected).toEqual({
      cell: 'B2',
      value: '123.5',
      formula: 'A1*2',
      references: [{ sheet: 'RAB', cell: 'A1' }],
    });
    expect(preview.rows).toHaveLength(7);
    expect(preview.columns).toHaveLength(12);
    const edge = previewWindow(model, 'RAB', 'XFD1048576');
    expect(edge.columns.at(-1)).toBe('XFD');
    expect(edge.rows.at(-1)?.number).toBe(1048576);
  });
});
