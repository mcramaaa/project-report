import { describe, expect, it } from 'vitest';
import { RAB_BUILTIN_PROFILE } from '@laporan-proyek/shared';
import { assistContext, proveChanges, type EditableProfile } from './profile-assist';
import { workbookOf } from './test-workbook';

const base = (): EditableProfile => {
  const copy: Partial<typeof RAB_BUILTIN_PROFILE> = structuredClone(RAB_BUILTIN_PROFILE);
  delete copy.origin;
  delete copy.name;
  return copy as EditableProfile;
};

/** BOQ with "Banyaknya" over the quantities, a two-row title in G3:G4, and a secret far below the sheet head. */
const model = () =>
  workbookOf({
    BOQ: {
      B3: 'No. Mata Pembayaran', D3: 'Uraian', E3: 'Satuan', F3: 'Banyaknya', G3: 'Perkiraan', H3: 'Jumlah Harga',
      G4: 'Volume',
      B5: '1.2', D5: 'Mobilisasi', E5: 'LS', F5: 1, G5: 2500000, H5: ['F5*G5', 2500000],
      D60: 'RAHASIA-BARIS-60',
    },
  });

describe('assistant proposals are proven against the cited cells (D-095)', () => {
  it('adds a proven word as a new rule of a multi-rule role; the two-row title counts', () => {
    const { profile, accepted, rejected } = proveChanges([model()], base(), [
      { role: 'headerless.quantity', match: 'PREFIX', words: [{ word: 'banyaknya', cell: 'BOQ!F3' }, { word: 'PERKIRAAN VOLUME', cell: 'BOQ!G3' }], reason: 'judul kuantitas' },
    ]);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { role: 'headerless.quantity', label: 'Kolom kuantitas', match: 'PREFIX', words: ['BANYAKNYA', 'PERKIRAAN VOLUME'], cells: ['BOQ!F3', 'BOQ!G3'], reason: 'judul kuantitas' },
    ]);
    expect(profile.headerless.quantity).toEqual([
      ...RAB_BUILTIN_PROFILE.headerless.quantity,
      { match: 'PREFIX', words: ['BANYAKNYA', 'PERKIRAAN VOLUME'] },
    ]);
  });

  it('rejects words the cited cell does not hold, unknown cells and roles, a changed mode, and words already there', () => {
    const { profile, accepted, rejected } = proveChanges([model()], base(), [
      { role: 'headerless.quantity', match: 'PREFIX', words: [{ word: 'BANYAKNYA', cell: 'BOQ!D3' }], reason: 'sel salah' },
      { role: 'headerless.quantity', match: 'PREFIX', words: [{ word: 'BANYAKNYA', cell: 'LAIN!F3' }], reason: 'sheet salah' },
      { role: 'rab.nonexistent', match: 'PREFIX', words: [{ word: 'BANYAKNYA', cell: 'BOQ!F3' }], reason: 'role salah' },
      { role: 'rab.volume', match: 'PREFIX', words: [{ word: 'BANYAKNYA', cell: 'BOQ!F3' }], reason: 'mode beda' },
      { role: 'headerless.unit', match: 'EXACT', words: [{ word: 'SATUAN', cell: 'BOQ!E3' }], reason: 'sudah ada' },
    ]);
    expect(accepted).toEqual([]);
    expect(profile).toEqual(base());
    expect(rejected.map((r) => r.reason)).toEqual([
      'sel BOQ!D3 tidak memuat "BANYAKNYA" dengan cara cocok PREFIX',
      'sel LAIN!F3 tidak ada di dokumen',
      'role tidak dikenal',
      'cara cocok PREFIX berbeda dari aturan yang ada (EXACT); ubah manual di editor',
      'kata sudah ada di profil',
    ]);
  });
});

describe('assistant context stays within RAB_PLAYGROUND §6 (D-095)', () => {
  const input = (problemCells: string[] = []) => ({
    sources: [{ model: model(), filename: 'boq.xlsx', role: 'RAB' as const, rabSheet: 'BOQ' }],
    profile: base(),
    machine: 'Pembaca berhenti: kolom kuantitas tidak dikenali',
    problemCells,
    message: 'Kolom kuantitas berjudul Banyaknya',
  });

  it('sends the message, the rules, the machine result and the sheet head, never rows beyond the head', () => {
    const { text, characters, sheets } = assistContext(input());
    expect(text).toContain('Kolom kuantitas berjudul Banyaknya');
    expect(text).toContain('headerless.quantity (many) · [CONTAINS: KUANTITAS] [WORD: VOLUME, QTY]');
    expect(text).toContain('Pembaca berhenti');
    expect(text).toContain('BOQ!F3: Banyaknya');
    expect(text).not.toContain('RAHASIA-BARIS-60');
    expect(characters).toBe(text.length);
    expect(sheets).toEqual(['BOQ']);
  });

  it('adds the formulas of a problem row, and the budget caps the request', () => {
    expect(assistContext(input(['BOQ!H5'])).text).toContain('BOQ!H5: =F5*G5 → 2500000');
    const small = assistContext(input(), 400);
    expect(small.characters).toBeLessThanOrEqual(400);
    expect(small.text).toContain('Kolom kuantitas berjudul Banyaknya');
    expect(small.text).not.toContain('ISI AWAL');
  });
});
