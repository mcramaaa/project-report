import { describe, expect, it } from 'vitest';
import { buildDraft } from '../build-draft';
import { evaluateImport } from '../evaluate';
import { workbookOf, type SheetSpec } from '../test-workbook';

/**
 * D-091/D-092 on synthetic workbooks shaped like a Bina Marga estimate (no real project data): an HPS sheet whose
 * PPN price L = ROUNDDOWN(K × 1.11, 0) and whose base price K links to a Bina Marga or a Cipta Karya analysis.
 */

const HPS: SheetSpec = {
  B13: 'No. Mata', D13: 'Uraian', E13: 'Satuan', F13: 'Total', K13: 'Harga', L13: 'Harga', M13: 'Jumlah',
  F14: 'Kuantitas', K14: 'Satuan', L14: 'Satuan', M14: 'Harga-Harga',
  D15: 'DIVISI 3. PEKERJAAN TANAH',
  B16: '3.1.(1)', D16: 'Galian Biasa', E16: 'M3', F16: 10, K16: ["'Copy of D3'!U51", 23100], L16: ['ROUNDDOWN(K16*1.11,0)', 25641], M16: ['F16*L16', 256410],
  B17: '11.7.1.2', D17: 'Paving Blok', E17: 'M2', F17: 5, K17: ["'Analisa CK'!G97", 212850], L17: ['ROUNDDOWN(K17*1.11,0)', 236263], M17: ['F17*L17', 1181315],
};

/** Bina Marga form: titles over two rows (upwards), JUMLAH HARGA titled in S but amounts in U, overhead P/100 × D. */
const BINA_MARGA: SheetSpec = {
  A1: 'ITEM PEMBAYARAN NO.', D1: ': 3.1.(1)',
  A2: 'JENIS PEKERJAAN', D2: ': Galian Biasa',
  A3: 'SATUAN PEMBAYARAN', D3: ': M3',
  Q18: 'PERKIRAAN', R18: 'HARGA', S18: 'JUMLAH',
  N19: 'KOMPONEN', P19: 'SATUAN', Q19: 'KUANTITAS', R19: 'SATUAN', S19: 'HARGA',
  N23: 'TENAGA',
  N25: 'Pekerja', P25: 'Jam', Q25: 0.5, R25: ["'4-Basic Price'!H8", 20000], U25: ['Q25*R25', 10000],
  // A side table on a component row (box culvert price per m in W:Z): not this component's amount (regression).
  W25: 2400000, X25: 0.5, Z25: ['W25*X25', 1200000],
  N26: 'Mandor', P26: 'Jam', Q26: 0.1, R26: ["'4-Basic Price'!H9", 30000], U26: ['Q26*R26', 3000],
  Q29: 'JUMLAH HARGA TENAGA', U29: ['SUM(U25:U28)', 13000],
  N31: 'BAHAN',
  N33: 'Semen 40 kg', P33: 'kg', Q33: 2, R33: ['60000/40', 1500], U33: ['Q33*R33', 3000],
  N34: 'Box Culvert 600', P34: 'M', Q34: 0, R34: ['Z25', 1200000], U34: ['Q34*R34', 0],
  Q35: 'JUMLAH HARGA BAHAN', U35: ['SUM(U32:U34)', 3000],
  N38: 'PERALATAN',
  N40: 'Excavator', O40: 'E10', P40: 'Jam', Q40: 0.01, R40: ["IF(O40=0,0,VLOOKUP(O40,'5-Daftar Alat'!$A$2:$C$3,3))", 500000], U40: ['Q40*R40', 5000],
  Q47: 'JUMLAH HARGA PERALATAN', U47: ['SUM(U40:U46)', 5000],
  N49: 'JUMLAH HARGA TENAGA, BAHAN DAN PERALATAN', U49: ['U47+U35+U29', 21000],
  N50: 'OVERHEAD & PROFIT', P50: 10, U50: ['P50/100*U49', 2100],
  N51: 'HARGA SATUAN PEKERJAAN', U51: ['U49+U50', 23100],
};

/** Cipta Karya form: title in one cell, overhead as a fraction (E95 = 0.1), "Dibulatkan" = ROUNDDOWN(F, 0). */
const CIPTA_KARYA: SheetSpec = {
  A76: '11.7.1.2 Pemasangan 1 m2 Paving Blok',
  A77: 'No', B77: 'Uraian', C77: 'Kode', D77: 'Satuan', E77: 'Koefisien', F77: 'Harga Satuan (Rp)', G77: 'Jumlah Harga (Rp)',
  A78: 'A', B78: 'TENAGA',
  B79: 'Pekerja', D79: 'OH', E79: 0.1, F79: 150000, G79: ['F79*E79', 15000],
  E83: 'JUMLAH TENAGA KERJA', G83: ['SUM(G79:G82)', 15000],
  A84: 'B', B84: 'BAHAN',
  B85: 'Paving 20 x 20', D85: 'm2', E85: 1.05, F85: 170000, G85: ['F85*E85', 178500],
  E88: 'JUMLAH HARGA BAHAN', G88: ['SUM(G85:G87)', 178500],
  A94: 'D', B94: 'Jumlah (A+B+C)', G94: ['G88+G83', 193500],
  A95: 'E', B95: 'Overhead & Profit', E95: 0.1, G95: ['G94*E95', 19350],
  A96: 'F', B96: 'Harga Satuan Pekerjaan (D+E)', G96: ['G94+G95', 212850],
  A97: 'G', B97: 'Dibulatkan', G97: ['ROUNDDOWN(G96,0)', 212850],
};

const BASIC: SheetSpec = { A8: 'L01', D8: 'Pekerja', F8: 'Jam', H8: 20000, A9: 'L03', D9: 'Mandor', F9: 'Jam', H9: 30000 };
// Approximate VLOOKUP (no 4th argument) over a code-keyed list: accepted only because the key is unique and the
// cached result equals that row.
const ALAT: SheetSpec = { A2: 'E10', B2: 'EXCAVATOR 80-140 HP', C2: 500000, A3: 'E08', B3: 'DUMP TRUCK', C3: 400000 };

function draftOf(overrides: Partial<Record<string, SheetSpec>> = {}) {
  const model = workbookOf({ HPS, 'Copy of D3': BINA_MARGA, 'Analisa CK': CIPTA_KARYA, '4-Basic Price': BASIC, '5-Daftar Alat': ALAT, ...overrides } as Record<string, SheetSpec>);
  return buildDraft([{ model, documentId: 'doc', filename: 'hps.xlsx', sha256: 'x', role: 'RAB', rabSheet: 'HPS' }], {
    targetVersionType: 'CONTRACT',
    targetRevisionNumber: undefined,
    officialAnalyses: [],
    previousItems: [],
  });
}

describe('Bina Marga and Cipta Karya analyses reached from an HPS sheet (D-091)', () => {
  it('reads both forms by their titles and follows the D/E/F formulas', () => {
    const draft = draftOf();
    const byCode = new Map(draft.analyses.map((a) => [a.code, a]));
    expect(byCode.get('3.1.(1)')).toMatchObject({ name: 'Galian Biasa', unit: 'M3', overheadPercent: '10' });
    expect(byCode.get('11.7.1.2')).toMatchObject({ name: 'Pemasangan 1 m2 Paving Blok', overheadPercent: '10' });
    expect(byCode.get('3.1.(1)')!.computed.price).toBe('23100');
    expect(byCode.get('11.7.1.2')!.computed.price).toBe('212850');
    expect(byCode.get('3.1.(1)')!.components.map((c) => [c.category, c.description])).toEqual([
      ['LABOR', 'Pekerja'],
      ['LABOR', 'Mandor'],
      ['MATERIAL', 'Semen 40 kg'],
      ['MATERIAL', 'Box Culvert 600'],
      ['EQUIPMENT', 'Excavator'],
    ]);
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('prices components through plain references, an IF-guarded approximate lookup, and number-only formulas', () => {
    const draft = draftOf();
    const names = draft.prices.map((p) => [p.name, p.price]);
    expect(names).toEqual(
      expect.arrayContaining([
        ['Pekerja', '20000'],
        ['Mandor', '30000'],
        ['EXCAVATOR 80-140 HP (E10)', '500000'],
      ]),
    );
    const galian = draft.analyses.find((a) => a.code === '3.1.(1)')!;
    const semen = galian.components.find((c) => c.description === 'Semen 40 kg')!;
    expect(semen).toMatchObject({ unitPrice: '1500', source: { kind: 'LITERAL' } });
    // The side-table cell Z25 on the Pekerja row is a price, not the Pekerja amount U25 (regression: 10 000 was taken).
    const box = galian.components.find((c) => c.description === 'Box Culvert 600')!;
    expect(box.unitPrice).toBe('1200000');
  });

  it('refuses an approximate lookup whose cached result is not the exact key row', () => {
    const draft = draftOf({ '5-Daftar Alat': { ...ALAT, C2: 450000 } });
    expect(draft.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'COMPONENT_PRICE_UNTRACEABLE', severity: 'BLOCKING' })]));
    expect(draft.issues.find((i) => i.code === 'COMPONENT_PRICE_UNTRACEABLE')!.message).toContain('bukan pencocokan tepat');
  });
});

describe('HPS price as a formula over the analysis price (D-092)', () => {
  it('keeps the HPS price L, links the analysis, and needs no reviewer decision when the formula holds', () => {
    const draft = draftOf();
    const ev = evaluateImport(draft, [], new Map());
    const items = ev.rows.filter((r) => r.row.rowType === 'ITEM');
    expect(items.map((r) => [r.row.displayNumber, r.priceSource, r.unitPrice, r.analysisUnitPrice])).toEqual([
      ['3.1.(1)', 'SOURCE_OVERRIDE', '25641', '23100'],
      ['11.7.1.2', 'SOURCE_OVERRIDE', '236263', '212850'],
    ]);
    expect(items[0]!.priceNote).toBe('Harga sumber = ROUNDDOWN(harga analisa × 1,11; 0) (K16 → kolom harga, D-092).');
    // The Cipta Karya chain ends on "Dibulatkan" = ROUNDDOWN(F, 0): that rounding is part of the source formula.
    expect(items[1]!.priceNote).toBe('Harga sumber = ROUNDDOWN(ROUNDDOWN(harga analisa; 0) × 1,11; 0) (K17 → kolom harga, D-092).');
    expect(items.every((r) => r.row.taxPercent === '0')).toBe(true);
    expect(ev.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('a price that the formula does not explain stays a blocking mismatch for the reviewer', () => {
    const draft = draftOf({ HPS: { ...HPS, L16: ['ROUNDDOWN(K16*1.11,0)+1000', 26641] } as SheetSpec });
    // L16 is no longer base × factor: no formula, the trace starts at L16 and stops on its arithmetic.
    expect(draft.rows.find((r) => r.displayNumber === '3.1.(1)')!.sourcePriceFormula).toBeUndefined();
    const mismatch = draftOf({ HPS: { ...HPS, L16: ['ROUNDDOWN(K16*1.11,0)', 25000] } as SheetSpec });
    expect(mismatch.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRICE_MISMATCH', severity: 'BLOCKING' })]));
    const ev = evaluateImport(mismatch, [], new Map());
    expect(ev.rows.find((r) => r.row.displayNumber === '3.1.(1)')!.unitPrice).toBeNull();
  });
});
