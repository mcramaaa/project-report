import { describe, expect, it } from 'vitest';
import { matchesWord, RAB_BUILTIN_PROFILE, rabProfileSchema, type RabProfile, type WordMatcher } from '@laporan-proyek/shared';
import { buildDraft } from './build-draft';
import { detectRabColumns, readRabSheet } from './workbook/rab-sheet';
import { analysisBlock, rabSheet, recap, workbookOf, type SheetSpec } from './test-workbook';

const p = RAB_BUILTIN_PROFILE.rab;

/** Office RAB header in row 5, with one section and one item below. */
function sheetWith(words: { description?: string; analysis?: string; unit?: string; amount?: string }, extra: SheetSpec = {}): SheetSpec {
  return {
    A5: 'NO', B5: words.description ?? 'URAIAN PEKERJAAN', C5: words.analysis ?? 'NO. ANALISA', D5: 'VOLUME',
    E5: words.unit ?? 'SAT', F5: 'HARGA SATUAN', G5: 'PPN', H5: 'HARGA + PPN', I5: words.amount ?? 'JUMLAH',
    A6: 'A', B6: 'PEKERJAAN PERSIAPAN',
    A7: 1, B7: 'Pembersihan lokasi', C7: 'A.1', D7: 10, E7: 'm2', F7: 5000, G7: 11, H7: 5550, I7: 55500,
    ...extra,
  };
}

describe('RAB mapping profile (RAB_PLAYGROUND stage 1)', () => {
  it('accepts the built-in profile and rejects malformed ones', () => {
    expect(rabProfileSchema.parse(RAB_BUILTIN_PROFILE)).toEqual(RAB_BUILTIN_PROFILE);
    const withRab = (rab: Partial<RabProfile['rab']>) => ({ ...RAB_BUILTIN_PROFILE, rab: { ...p, ...rab } });
    expect(rabProfileSchema.safeParse({ ...RAB_BUILTIN_PROFILE, profileVersion: 2 }).success).toBe(false);
    expect(rabProfileSchema.safeParse(withRab({ unit: { match: 'EXACT', words: [] } })).success).toBe(false);
    expect(rabProfileSchema.safeParse(withRab({ unit: { match: 'EXACT', words: ['Satuan'] } })).success).toBe(false);
    expect(rabProfileSchema.safeParse(withRab({ unit: { match: 'REGEX' as 'EXACT', words: ['SAT'] } })).success).toBe(false);
    expect(rabProfileSchema.safeParse({ ...RAB_BUILTIN_PROFILE, sheets: { RAB: 'LAIN' } }).success).toBe(false);
  });

  // The regexes the office reader used before profiles; the built-in profile must answer exactly like them.
  const legacy: [keyof RabProfile['rab'], RegExp][] = [
    ['no', /^NO\.?$/],
    ['volume', /^VOLUME$/],
    ['analysis', /^NO\.? ?ANALISA/],
    ['description', /^(JENIS PEKERJAAN|URAIAN)/],
    ['unit', /^(SAT|SATUAN)$/],
    ['price', /^HARGA/],
    ['tax', /^PPN\b/],
    ['amount', /^(SUB ?JUMLAH|JUMLAH)\b/],
    ['totalLabels', /^(JUMLAH|DIBULATKAN|TOTAL|SUB ?TOTAL|REAL COST)\b/],
    ['grandTotal', /^JUMLAH TOTAL/],
    ['bareTotal', /^JUMLAH$/],
    ['rounded', /^DIBULATKAN/],
  ];
  const samples = [
    '', 'NO', 'NO.', 'NO..', 'NOX', 'NO. ANALISA', 'NO.ANALISA', 'NO ANALISA', 'NOANALISA', 'NO  ANALISA', 'NO. ANALISA HARGA',
    'VOLUME', 'VOLUMES', 'VOLUME (M3)', 'JENIS PEKERJAAN', 'JENIS', 'URAIAN PEKERJAAN', 'URAIANX', 'SAT', 'SATUAN', 'SAT.', 'SATUANNYA',
    'HARGA', 'HARGA SATUAN', 'HARGA SAT + PPN', 'HARGASAT', 'PPN', 'PPN 11%', 'PPN11', 'PPN-11', 'PPNX', 'JUMLAH', 'JUMLAH HARGA',
    'JUMLAHAN', 'SUB JUMLAH', 'SUBJUMLAH', 'SUB  JUMLAH', 'JUMLAH TOTAL', 'JUMLAH TOTALNYA', 'TOTAL', 'TOTALAN', 'SUB TOTAL', 'SUBTOTAL',
    'REAL COST', 'REAL COSTS', 'DIBULATKAN', 'DIBULATKANNYA', 'DIBULATKAN:', 'TOTAL (RP)', 'JUMLAH-HARGA',
  ];
  it.each(legacy)('built-in "%s" matches exactly what the old regex matched', (role, regex) => {
    for (const s of samples) expect([s, matchesWord(s, p[role])]).toEqual([s, regex.test(s)]);
  });

  // Same guard for the header-word reader (headerless-sheet.ts before profiles): a role matches when any regex did.
  const h = RAB_BUILTIN_PROFILE.headerless;
  const headerlessLegacy: [string, WordMatcher[], RegExp[]][] = [
    ['code', h.code, [/^NO\.? ?MATA/, /^KODE\b/, /^NO\.? ?ITEM/, /^ITEM PEMBAYARAN/, /^NO\.? ?PEMBAYARAN/]],
    ['description', h.description, [/^URAIAN/, /^JENIS PEKERJAAN/, /^ITEM PEKERJAAN/, /^NAMA PEKERJAAN/]],
    ['unit', h.unit, [/^SATUAN$/, /^SAT$/]],
    ['quantity', h.quantity, [/KUANTITAS/, /^VOLUME\b/, /^QTY\b/]],
    ['price', h.price, [/^HARGA SATUAN/, /^HARGA SAT\b/]],
    ['amount', h.amount, [/^JUMLAH/, /^TOTAL HARGA/, /^SUB ?JUMLAH/]],
  ];
  const headerlessSamples = [
    ...samples, 'NO. MATA PEMBAYARAN', 'NO.MATA', 'NO MATA', 'NOMATA', 'NO  MATA', 'KODE', 'KODE ITEM', 'KODEX', 'NO. ITEM', 'NOITEM',
    'ITEM PEMBAYARAN NO.', 'NO. PEMBAYARAN', 'NO PEMBAYARAN', 'ITEM PEKERJAAN', 'NAMA PEKERJAAN', 'TOTAL KUANTITAS', 'KUANTITAS', 'PERKIRAAN KUANTITAS',
    'VOLUME', 'VOLUMEX', 'QTY', 'QTY.', 'QTYS', 'HARGA SAT', 'HARGA SAT.', 'HARGA SATUAN (RP)', 'HARGA SATX', 'TOTAL HARGA (RP)', 'SUBJUMLAH', 'SUB JUMLAH',
  ];
  it.each(headerlessLegacy)('built-in headerless "%s" matches exactly what the old regexes matched', (_, role, regexes) => {
    for (const s of headerlessSamples) expect([s, role.some((m) => matchesWord(s, m))]).toEqual([s, regexes.some((r) => r.test(s))]);
  });
  it('built-in division label matches like the old case-insensitive regex on the uppercased description', () => {
    const values = ['DIVISI 1. UMUM', 'Divisi 2. Drainase', 'divisi', 'DIVISIONAL', 'Divisi-3', ' DIVISI 1', 'SUB DIVISI', 'divisi7'];
    for (const s of values) expect([s, matchesWord(s.toUpperCase(), h.division)]).toEqual([s, /^DIVISI\b/i.test(s)]);
  });

  // Same guard for the analysis forms (analysis-block.ts before profiles).
  const f = RAB_BUILTIN_PROFILE.analysisForm;
  const formLegacy: [string, WordMatcher, RegExp][] = [
    ['office.no', f.office.no, /^NO\.?$/],
    ['office.description', f.office.description, /^URAIAN/],
    ['office.unit', f.office.unit, /^SATUAN$/],
    ['office.coefficient', f.office.coefficient, /^KOEFISIEN$/],
    ['office.price', f.office.price, /^HARGA SATUAN/],
    ['office.amount', f.office.amount, /^JUMLAH HARGA/],
    ['binaMarga.component', f.binaMarga.component, /^KOMPONEN\b/],
    ['binaMarga.unit', f.binaMarga.unit, /^SATUAN$/],
    ['binaMarga.quantity', f.binaMarga.quantity, /^(PERKIRAAN )?KUANTITAS\b/],
    ['binaMarga.quantityFallback', f.binaMarga.quantityFallback, /^KOEF/],
    ['binaMarga.price', f.binaMarga.price, /^HARGA SATUAN/],
    ['binaMarga.amount', f.binaMarga.amount, /^JUMLAH HARGA/],
    ['binaMarga.totalRow', f.binaMarga.totalRow, /^(TOTAL HARGA|HARGA SATUAN PEKERJAAN)/],
    ['title.code', f.title.code, /^ITEM PEMBAYARAN/],
    ['title.name', f.title.name, /^JENIS PEKERJAAN/],
    ['title.unit', f.title.unit, /^SATUAN PEMBAYARAN/],
    ['categories.LABOR', f.categories.LABOR, /^(TENAGA( KERJA)?|UPAH|PEKERJA)$/],
    ['categories.MATERIAL', f.categories.MATERIAL, /^(BAHAN|MATERIAL)$/],
    ['categories.EQUIPMENT', f.categories.EQUIPMENT, /^(PERALATAN|ALAT)$/],
  ];
  const formSamples = [
    '', 'NO', 'NO.', 'NO. ', 'URAIAN', 'URAIAN ', ' URAIAN', 'SATUAN', 'SATUAN ', 'SATUAN PEMBAYARAN', 'KOEFISIEN', 'KOEFISIEN ', 'KOEF.',
    'KOEF', 'HARGA SATUAN', 'HARGA SATUAN (RP)', 'HARGA  SATUAN', 'HARGA SATUAN PEKERJAAN', 'JUMLAH HARGA', 'JUMLAH HARGA (RP)', 'KOMPONEN',
    'KOMPONEN ', 'KOMPONENX', 'KOMPONEN-1', 'KUANTITAS', 'KUANTITASNYA', 'PERKIRAAN KUANTITAS', 'PERKIRAAN  KUANTITAS', 'PERKIRAAN KUANTITAS.',
    'TOTAL HARGA', 'TOTAL HARGA PEKERJAAN', 'ITEM PEMBAYARAN NO.', 'JENIS PEKERJAAN', 'JENIS PEKERJAAN :', 'TENAGA', 'TENAGA KERJA', 'TENAGA  KERJA',
    'TENAGAKERJA', 'UPAH', 'UPAH ', 'PEKERJA', 'PEKERJAAN', 'BAHAN', 'BAHAN-BAHAN', 'MATERIAL', 'PERALATAN', 'ALAT', 'ALAT BERAT',
  ];
  it.each(formLegacy)('built-in form "%s" matches exactly what the old regex matched', (_, m, regex) => {
    for (const s of formSamples) expect([s, matchesWord(s, m)]).toEqual([s, regex.test(s)]);
  });
  it('built-in form labels match like the old case-insensitive regex on the uppercased value', () => {
    const old = /^(TOTAL HARGA|PERKIRAAN VOL|% THD|ITEM PEMBAYARAN|JENIS PEKERJAAN|SATUAN PEMBAYARAN|NO\. PAKET|NAMA PAKET)/i;
    const values = [...formSamples, 'total harga', 'Perkiraan Vol.', '% thd biaya', '%THD', 'No. Paket', 'No Paket', 'nama paket', 'Jalan Raya', '1.20.(1)'];
    for (const s of values) expect([s, matchesWord(s.toUpperCase(), f.title.formLabels)]).toEqual([s, old.test(s)]);
  });

  it.each([
    ['description', { description: 'JENIS PEKERJAAN' }, 2],
    ['analysis', { analysis: 'NOANALISA' }, 3],
    ['unit', { unit: 'SATUAN' }, 5],
    ['amount', { amount: 'SUB JUMLAH' }, 9],
  ] as const)('reader finds the %s column for %j', (role, words, col) => {
    const cols = detectRabColumns(workbookOf({ RAB: sheetWith(words) }), 'RAB', 'CONTRACT');
    expect(cols[role]).toBe(col);
    expect(cols).toMatchObject({ headerRow: 5, volume: 4, price: 6, tax: 7, priceWithTax: 8 });
  });

  it.each(['JUMLAH', 'TOTAL', 'SUB TOTAL', 'REAL COST'])('reader treats a "%s" row as a total, not an item', (label) => {
    const sheet = readRabSheet(workbookOf({ RAB: sheetWith({}, { B8: label, I8: 55500 }) }), 'RAB', 'CONTRACT');
    expect(sheet.rows.map((r) => r.description)).toEqual(['PEKERJAAN PERSIAPAN', 'Pembersihan lokasi']);
  });

  it('reads the grand and rounded totals and stops after the rounded one', () => {
    const sheet = readRabSheet(
      workbookOf({ RAB: sheetWith({}, { F8: 'JUMLAH TOTAL', I8: 55500, F9: 'DIBULATKAN', I9: 55000, A10: 2, B10: 'Sesudah', C10: 'A.2', D10: 1, F10: 1 }) }),
      'RAB',
      'CONTRACT',
    );
    expect(sheet.totals).toMatchObject({ value: '55500', rounded: '55000' });
    expect(sheet.rows.some((r) => r.description === 'Sesudah')).toBe(false);
  });

  it('reads a sheet the built-in profile does not know when the profile names its words', () => {
    const words: SheetSpec = { B5: 'NAMA PEKERJAAN', D5: 'KUANTITAS' };
    const model = workbookOf({ RAB: { ...sheetWith({}), ...words } });
    expect(() => detectRabColumns(model, 'RAB', 'CONTRACT')).toThrow();
    const custom: RabProfile = rabProfileSchema.parse({
      ...RAB_BUILTIN_PROFILE,
      name: 'Proyek X',
      origin: 'MANUAL',
      rab: { ...p, description: { match: 'PREFIX', words: ['NAMA PEKERJAAN'] }, volume: { match: 'EXACT', words: ['KUANTITAS'] } },
    });
    const sheet = readRabSheet(model, 'RAB', 'CONTRACT', 0, undefined, custom);
    expect(sheet.columns).toMatchObject({ description: 2, volume: 4 });
    expect(sheet.rows.find((r) => r.rowType === 'ITEM')).toMatchObject({ description: 'Pembersihan lokasi', volume: '10', sourceUnitPrice: '5000' });
  });

  it('buildDraft reads analysis forms with the run profile (D-094)', () => {
    const block = analysisBlock(5, {
      seq: 1,
      code: 'A.1',
      name: '1 M3 GALIAN TANAH BIASA MANUAL',
      unit: 'm3',
      components: [
        { category: 'TENAGA', name: 'Pekerja', unit: 'OH', coef: 0.75, price: ['VLOOKUP(C8,UPAH!B$2:C$20,2,FALSE)', 140000] },
        { category: 'TENAGA', name: 'Mandor', unit: 'OH', coef: 0.025, price: ['VLOOKUP(C9,UPAH!B$2:C$20,2,FALSE)', 220000] },
      ],
    });
    // A form the built-in profile does not know: "KOEF." over the coefficients, "TENAGA HARIAN" as the category.
    const analysis = { ...block.cells, F6: 'KOEF.', C7: 'TENAGA HARIAN' };
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN TANAH' },
        { no: 1, desc: 'Galian', vol: 10, unit: 'm3', code: 'A.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, Math.round(block.price)] },
      ]),
      'REKAP ANALISA': recap([{ seq: 1, code: 'A.1', price: block.price }]),
      ANALISA: analysis,
      UPAH: { B2: 'Pekerja', C2: 140000, B3: 'Mandor', C3: 220000 },
    });
    const sources = [{ model, documentId: 'd1', filename: 'f', sha256: 's' }];
    const ctx = { targetVersionType: 'CONTRACT' as const, officialAnalyses: [], previousItems: [] };
    expect(buildDraft(sources, ctx).analyses).toEqual([]);

    const form = RAB_BUILTIN_PROFILE.analysisForm;
    const profile = rabProfileSchema.parse({
      ...RAB_BUILTIN_PROFILE,
      origin: 'MANUAL',
      analysisForm: {
        ...form,
        office: { ...form.office, coefficient: { match: 'EXACT', words: ['KOEFISIEN', 'KOEF.'] } },
        categories: { ...form.categories, LABOR: { match: 'EXACT', words: [...form.categories.LABOR.words, 'TENAGA HARIAN'] } },
      },
    });
    const draft = buildDraft(sources, { ...ctx, profile });
    expect(draft.analyses).toHaveLength(1);
    expect(draft.analyses[0]!.components.map((c) => [c.category, c.coefficient])).toEqual([['LABOR', '0.75'], ['LABOR', '0.025']]);
    // 0.75×140000 + 0.025×220000 = 110500; +10% = 121550
    expect(draft.analyses[0]!.computed).toMatchObject({ directCost: '110500', price: '121550' });
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('reads a header-word sheet whose quantity title only a custom profile knows', () => {
    const estimate: SheetSpec = {
      B3: 'No. Mata Pembayaran', D3: 'Uraian', E3: 'Satuan', F3: 'Banyaknya', G3: 'Harga Satuan', H3: 'Jumlah Harga',
      B4: '1.2', D4: 'Mobilisasi', E4: 'LS', F4: 1, G4: 2500000, H4: ['F4*G4', 2500000],
    };
    const model = workbookOf({ BOQ: estimate });
    expect(() => readRabSheet(model, 'BOQ', 'CONTRACT')).toThrow();
    const custom = rabProfileSchema.parse({
      ...RAB_BUILTIN_PROFILE,
      origin: 'MANUAL',
      headerless: { ...RAB_BUILTIN_PROFILE.headerless, quantity: [{ match: 'PREFIX', words: ['BANYAKNYA'] }] },
    });
    const sheet = readRabSheet(model, 'BOQ', 'CONTRACT', 0, undefined, custom);
    expect(sheet.headerless).toMatchObject({ code: 2, description: 4, unit: 5, quantity: 6, price: 7, amount: 8 });
    expect(sheet.rows).toMatchObject([{ rowType: 'ITEM', displayNumber: '1.2', description: 'Mobilisasi', volume: '1', sourceUnitPrice: '2500000' }]);
  });
});
