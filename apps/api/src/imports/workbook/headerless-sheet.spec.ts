import { describe, expect, it } from 'vitest';
import { buildDraft } from '../build-draft';
import { rabSheetCandidates, readRabSheet } from './rab-sheet';
import { detectHeaderless, readHeaderlessSheet } from './headerless-sheet';
import { workbookOf, type SheetSpec } from '../test-workbook';

/** HPS-style estimate: header in rows 13–14, group rows "1.20", items with literal prices, one PPN-rounded price column. */
function hps(): SheetSpec {
  return {
    B13: 'No. Mata', D13: 'Uraian', E13: 'Satuan', F13: 'Total', K13: 'Harga', L13: 'Harga', M13: 'Jumlah',
    F14: 'Kuantitas', K14: 'Satuan', L14: 'Satuan', M14: 'Harga-Harga',
    B15: '1.20', D15: 'Pengujian Tanah',
    B16: '1.20.(1)', D16: 'Pengeboran, termasuk SPT', E16: 'M1', F16: 10, K16: 1250000, L16: [
      'ROUNDDOWN(K16*1.11,0)', 1387500,
    ], M16: ['F16*L16', 13875000],
    B17: '1.20.(2)', D17: 'Sondir', E17: 'M1', F17: 5, K17: 800000, L17: ['ROUNDDOWN(K17*1.11,0)', 888000], M17: ['F17*L17', 4440000],
    B18: '1.21', D18: 'Manajemen Mutu',
    B19: '1.21', D19: 'Manajemen Mutu', E19: 'LS', F19: 1, K19: 5005000, L19: ['ROUNDDOWN(K19*1.11,0)', 5555550], M19: ['F19*L19', 5555550],
    B20: '1.22.(1a)', D20: 'Dokumen keselamatan', E20: 'Set', F20: 0, K20: 500000, L20: ['ROUNDDOWN(K20*1.11,0)', 555000], M20: ['F20*L20', 0],
    B21: '2', D21: 'Pekerjaan kosong tanpa angka',
  };
}

describe('header-based RAB layout (no VOLUME / NO. ANALISA header)', () => {
  it('finds the header words and the item rows of an estimate sheet', () => {
    const model = workbookOf({ HPS: hps() });
    const cols = detectHeaderless(model, 'HPS');
    expect(cols).toEqual({ headerRow: 14, code: 2, description: 4, unit: 5, quantity: 6, price: 12, amount: 13 });
    const sheet = readHeaderlessSheet(model, 'HPS', cols!);
    expect(sheet.rows.map((r) => [r.rowType, r.displayNumber])).toEqual([
      ['SUBSECTION', '1.20'],
      ['ITEM', '1.20.(1)'],
      ['ITEM', '1.20.(2)'],
      ['SUBSECTION', '1.21'],
      ['ITEM', '1.21'],
      ['ITEM', '1.22.(1a)'],
    ]);
    // D-092: the RAB price is the PPN price column L (PPN 0%); the trace starts at the base cell K and the formula
    // L = ROUNDDOWN(K × 1.11, 0) is kept to check an analysis against L.
    expect(sheet.rows[1]).toMatchObject({
      volume: '10',
      unit: 'M1',
      sourceUnitPrice: '1387500',
      taxPercent: '0',
      priceCell: { sheet: 'HPS', row: 16, col: 11 },
      sourcePriceFormula: { baseCell: 'K16', factor: '1.11', rounding: 'DOWN', scale: 0 },
    });
    expect(sheet.rows[1]!.parentRow).toBe(sheet.rows[0]!.row);
  });

  it('keeps the division > group > sub-heading hierarchy of the estimate', () => {
    const model = workbookOf({
      HPS: {
        B13: 'No. Mata', D13: 'Uraian', E13: 'Satuan', F13: 'Total', L13: 'Harga', M13: 'Jumlah',
        F14: 'Kuantitas', L14: 'Satuan', M14: 'Harga-Harga',
        D15: 'DIVISI 1. UMUM',
        B16: '1.2', D16: 'Mobilisasi',
        B17: '1.2', D17: 'Mobilisasi dan Demobilisasi', E17: 'LS', F17: 1, L17: 5555550,
        B18: '1.22', D18: 'Sistem Manajemen Keselamatan Konstruksi',
        B19: '1', D19: 'Penyiapan dokumen penerapan SMKK:',
        B20: '1.22.(1a)', D20: 'Pembuatan dokumen RKK', E20: 'Set', F20: 1, L20: 555000,
        B21: '3a', D21: 'APK, antara lain :',
        B22: '1.22.(3a1)', D22: 'Kerucut lalu lintas', E22: 'bh', F22: 10, L22: 111000,
        D23: 'Jumlah Harga Pekerjaan DIVISI 1',
        D24: 'DIVISI 2. DRAINASE',
        B25: '2.1', D25: 'Selokan dan Saluran Air',
        B26: '2.1.(1)', D26: 'Galian untuk Selokan', E26: 'M3', F26: 4, L26: 120000,
        D27: 'DIVISI 3. KOSONG',
        B28: '3.1', D28: 'Galian tanpa item',
      },
    });
    const sheet = readRabSheet(model, 'HPS', 'CONTRACT', 0);
    const byRow = new Map(sheet.rows.map((r) => [r.row, r]));
    const path = (row: number) => {
      const out: string[] = [];
      for (let p = byRow.get(row)?.parentRow ?? null; p !== null; p = byRow.get(p)?.parentRow ?? null) out.unshift(byRow.get(p)!.displayNumber ?? byRow.get(p)!.description);
      return out.join(' > ');
    };
    expect(sheet.rows.map((r) => [r.rowType, r.displayNumber ?? r.description])).toEqual([
      ['SECTION', 'DIVISI 1. UMUM'],
      ['SUBSECTION', '1.2'],
      ['ITEM', '1.2'],
      ['SUBSECTION', '1.22'],
      ['PARENT_ITEM', '1'],
      ['ITEM', '1.22.(1a)'],
      ['PARENT_ITEM', '3a'],
      ['ITEM', '1.22.(3a1)'],
      ['SECTION', 'DIVISI 2. DRAINASE'],
      ['SUBSECTION', '2.1'],
      ['ITEM', '2.1.(1)'],
    ]);
    expect(path(17)).toBe('DIVISI 1. UMUM > 1.2');
    expect(path(22)).toBe('DIVISI 1. UMUM > 1.22 > 3a');
    expect(path(26)).toBe('DIVISI 2. DRAINASE > 2.1');
  });

  it('is picked by the reader when the sheet has no office header, and is offered as a candidate', () => {
    const model = workbookOf({ HPS: hps(), Notes: { A1: 'catatan' } });
    expect(rabSheetCandidates(model)).toEqual(['HPS']);
    const sheet = readRabSheet(model, 'HPS', 'CONTRACT', 0);
    expect(sheet.rows.filter((r) => r.rowType === 'ITEM')).toHaveLength(4);
  });

  it('does not take an analysis sheet for a RAB just because it has the words Uraian and Volume', () => {
    const model = workbookOf({
      Analisa: { B2: 'NO', C2: 'Uraian', D2: 'Volume', E2: 'Harga Satuan', B3: 1, C3: 'Pekerja', D3: 2, E3: 5000 },
    });
    expect(detectHeaderless(model, 'Analisa')).toBeNull();
  });

  it('a typed base price is a DIRECT price (the L value), traced from K, with no blocking issue', () => {
    const model = workbookOf({ HPS: hps() });
    const draft = buildDraft(
      [{ model, documentId: 'doc-hps', filename: 'RAB.xlsx', sha256: 'x', role: 'RAB', rabSheet: 'HPS' }],
      { targetVersionType: 'CONTRACT', targetRevisionNumber: undefined, officialAnalyses: [], previousItems: [] },
    );
    const items = draft.rows.filter((r) => r.rowType === 'ITEM');
    expect(items.map((r) => r.price.kind)).toEqual(['DIRECT', 'DIRECT', 'DIRECT', 'DIRECT']);
    expect(items[0]!).toMatchObject({ sourceUnitPrice: '1387500', taxPercent: '0' });
    expect(items[0]!.price.evidence).toEqual([{ cell: 'HPS!K16', formula: null, value: 1250000, via: 'START' }]);
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });
});
