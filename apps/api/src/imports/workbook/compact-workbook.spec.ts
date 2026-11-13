import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCompactWorkbook, slideFormula, WorkbookReadError } from './compact-workbook';
import { WorkbookModel } from './workbook-model';

/** A workbook with every cell shape the import pipeline meets in office files. */
async function fixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RAB + PPN');
  ws.getCell('A1').value = 'Judul merged';
  ws.mergeCells('A1:C1');
  ws.getCell('A2').value = 2;
  ws.getCell('B2').value = 3;
  ws.getCell('A3').value = 4;
  ws.getCell('B3').value = 5;
  ws.getCell('A4').value = 6;
  ws.getCell('B4').value = 7;
  // Shared formula: C2 is the master, C3:C4 depend on it (how Excel saves a filled-down formula).
  ws.fillFormula('C2:C4', 'A2*$B$2', [6, 12, 18]);
  ws.getCell('D2').value = { formula: "ROUND('Harga Bahan'!B1*A2,0)", result: 20 };
  ws.getCell('E2').value = new Date(Date.UTC(2026, 0, 15));
  ws.getCell('E2').numFmt = 'dd/mm/yyyy';
  ws.getCell('F2').value = 46037; // same serial, plain number format
  ws.getCell('G2').value = { formula: 'E2+1', result: 46038 };
  ws.getCell('G2').numFmt = 'd-mmm-yy';
  ws.getCell('H2').value = { richText: [{ text: 'Galian ' }, { text: 'tanah', font: { bold: true } }] };
  ws.getCell('I2').value = { error: '#N/A' };
  ws.getCell('J2').value = { text: 'tautan', hyperlink: 'https://example.test' };
  ws.getCell('K2').value = true;
  ws.getCell('L2').value = 'teks  dengan   spasi';
  ws.getCell('M2').value = { formula: 'A2&"x"', result: '2x' };
  ws.getCell('AB40').value = 'jauh';
  const empty = wb.addWorksheet('Kosong');
  void empty;
  const second = wb.addWorksheet('Harga Bahan');
  second.getCell('B1').value = 10;
  for (let r = 1; r <= 100; r++) second.getCell(`C${r}`).value = r;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('compact workbook loader', () => {
  let buffer: Buffer;
  let dir: string;
  let path: string;
  beforeAll(async () => {
    buffer = await fixture();
    dir = await mkdtemp(join(tmpdir(), 'compact-workbook-'));
    path = join(dir, 'fixture.xlsx');
    await writeFile(path, buffer);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reads the same cells as the exceljs-backed model, including translated shared formulas', async () => {
    const full = new ExcelJS.Workbook();
    await full.xlsx.load(buffer as unknown as ArrayBuffer);
    const expected = new WorkbookModel('doc', 'fixture.xlsx', full);
    const actual = new WorkbookModel('doc', 'fixture.xlsx', await loadCompactWorkbook(buffer));

    expect(actual.sheetNames()).toEqual(expected.sheetNames());
    for (const sheet of expected.sheetNames()) {
      expect(actual.rowCount(sheet), `${sheet} rowCount`).toBe(expected.rowCount(sheet));
      expect(actual.columnCount(sheet), `${sheet} columnCount`).toBe(expected.columnCount(sheet));
      for (let r = 1; r <= expected.rowCount(sheet) + 1; r++)
        for (let c = 1; c <= expected.columnCount(sheet) + 1; c++) {
          const e = expected.cell(sheet, r, c);
          const a = actual.cell(sheet, r, c);
          expect(a, `${sheet}!${r}:${c}`).toEqual(e);
        }
    }
    // The shapes that matter, stated explicitly.
    expect(actual.cell('RAB + PPN', 3, 3)).toMatchObject({ value: 12, formula: 'A3*$B$2' });
    expect(actual.cell('RAB + PPN', 4, 3)).toMatchObject({ value: 18, formula: 'A4*$B$2' });
    expect(actual.cell('RAB + PPN', 1, 2)).toMatchObject({ value: null, formula: null }); // covered by merge
    expect(actual.cell('RAB + PPN', 2, 5).value).toEqual(new Date(Date.UTC(2026, 0, 15)));
    expect(actual.cell('RAB + PPN', 2, 6).value).toBe(46037);
    expect(actual.cell('RAB + PPN', 2, 7).value).toBeInstanceOf(Date);
    expect(actual.text('RAB + PPN', 2, 8)).toBe('Galian tanah');
    expect(actual.cell('RAB + PPN', 2, 9).value).toBeNull();
    expect(actual.text('RAB + PPN', 2, 10)).toBe('tautan');
    expect(actual.cell('RAB + PPN', 2, 11).value).toBe(true);
    expect(actual.cell('RAB + PPN', 2, 13)).toMatchObject({ value: '2x', formula: 'A2&"x"' });
  });

  it('reads a stored file from disk the same way as from a buffer', async () => {
    const fromBuffer = await loadCompactWorkbook(buffer);
    const fromPath = await loadCompactWorkbook(path);
    expect(fromPath).toEqual(fromBuffer);
  });

  it('stops after headRows so the upload inventory never reads a big sheet in full', async () => {
    const model = new WorkbookModel('doc', 'fixture.xlsx', await loadCompactWorkbook(buffer, { headRows: 40 }));
    expect(model.rowCount('Harga Bahan')).toBe(40);
    expect(model.number('Harga Bahan', 40, 3)).toBe(40);
    expect(model.number('Harga Bahan', 41, 3)).toBeNull();
    expect(model.text('RAB + PPN', 40, 28)).toBe('jauh');
  });

  it('refuses files that are not a readable .xlsx', async () => {
    await expect(loadCompactWorkbook(Buffer.from('not a zip at all'))).rejects.toBeInstanceOf(WorkbookReadError);
    const zipWithoutWorkbook = Buffer.from(
      await (async () => {
        const JSZip = (await import('jszip')).default;
        const z = new JSZip();
        z.file('hello.txt', 'x');
        return z.generateAsync({ type: 'nodebuffer' });
      })(),
    );
    await expect(loadCompactWorkbook(zipWithoutWorkbook)).rejects.toBeInstanceOf(WorkbookReadError);
  });
});

describe('slideFormula', () => {
  it('shifts relative references and keeps anchored ones, names and sheets', () => {
    expect(slideFormula('A1*$B$2+SUM(C1:C3)', { row: 1, col: 3 }, { row: 3, col: 4 })).toBe('B3*$B$2+SUM(D3:D5)');
    expect(slideFormula("'Harga Bahan'!B1*A$2", { row: 2, col: 1 }, { row: 5, col: 2 })).toBe("'Harga Bahan'!C4*B$2");
    expect(slideFormula('VLOOKUP(A1,Daftar,2,0)', { row: 1, col: 1 }, { row: 2, col: 1 })).toBe('VLOOKUP(A2,Daftar,2,0)');
  });
});
