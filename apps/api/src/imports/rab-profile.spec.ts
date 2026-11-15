import { describe, expect, it } from 'vitest';
import { matchesWord, RAB_BUILTIN_PROFILE, rabProfileSchema, type RabProfile } from '@laporan-proyek/shared';
import { detectRabColumns, readRabSheet } from './workbook/rab-sheet';
import { workbookOf, type SheetSpec } from './test-workbook';

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
});
