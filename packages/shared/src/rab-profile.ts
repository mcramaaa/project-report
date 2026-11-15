import { z } from 'zod';

/**
 * Mapping profile of a RAB workbook (RAB_PLAYGROUND.md §4, stage 1). Declarative data: the office RAB reader
 * (rab-sheet.ts) takes its header words and total labels from it; the built-in profile reproduces the words the
 * reader matched before, so results do not change.
 */
export const RAB_PROFILE_VERSION = 1 as const;
export const RAB_PROFILE_ORIGINS = ['BAWAAN', 'MANUAL', 'AI'] as const;
export type RabProfileOrigin = (typeof RAB_PROFILE_ORIGINS)[number];
export const RAB_SHEET_ROLES = ['RAB', 'ANALISA', 'DAFTAR_HARGA', 'ABAIKAN'] as const;
export type RabSheetRole = (typeof RAB_SHEET_ROLES)[number];
/** EXACT: whole text; PREFIX: text starts with the word; WORD: starts with the word as a whole word. */
export const WORD_MATCHES = ['EXACT', 'PREFIX', 'WORD'] as const;
export type WordMatch = (typeof WORD_MATCHES)[number];

/** Header words are stored uppercase, single-spaced (as the readers normalise cell text). */
const headerWord = z
  .string()
  .min(1)
  .max(60)
  .refine((v) => v === v.toUpperCase().replace(/\s+/g, ' ').trim(), { message: 'Kata header harus huruf besar dan satu spasi.' });
const synonyms = z.array(headerWord).min(1).max(20);
export const wordMatcherSchema = z.object({ match: z.enum(WORD_MATCHES), words: synonyms });
export type WordMatcher = z.infer<typeof wordMatcherSchema>;

const isWordChar = (ch: string | undefined) => ch !== undefined && /\w/.test(ch);
/** Whether normalised (uppercase, single-spaced) cell text matches one of the words. Runs per cell: no RegExp build. */
export function matchesWord(text: string, m: WordMatcher): boolean {
  return m.words.some((w) => {
    if (m.match === 'EXACT') return text === w;
    if (!text.startsWith(w)) return false;
    // WORD = regex /^w\b/: a word boundary right after w.
    return m.match === 'PREFIX' || isWordChar(w[w.length - 1]) !== isWordChar(text[w.length]);
  });
}

export const rabProfileSchema = z.object({
  profileVersion: z.literal(RAB_PROFILE_VERSION),
  name: z.string().min(1).max(120),
  origin: z.enum(RAB_PROFILE_ORIGINS),
  /** Role per sheet name. Not read yet: sheets are still chosen by the import request. */
  sheets: z.record(z.string().min(1).max(64), z.enum(RAB_SHEET_ROLES)).default({}),
  /** Office RAB layout (header row with VOLUME and NO. ANALISA). */
  rab: z.object({
    no: wordMatcherSchema,
    volume: wordMatcherSchema,
    analysis: wordMatcherSchema,
    description: wordMatcherSchema,
    unit: wordMatcherSchema,
    /** Price column; a price header that also contains a tax word is the price + PPN column. */
    price: wordMatcherSchema,
    tax: wordMatcherSchema,
    amount: wordMatcherSchema,
    /** Rows labelled with these are totals, never items. */
    totalLabels: wordMatcherSchema,
    /** Grand total of the chosen block; a bare total label outside the description column counts too. */
    grandTotal: wordMatcherSchema,
    bareTotal: wordMatcherSchema,
    /** Rounded total ("DIBULATKAN"): reading stops after it. */
    rounded: wordMatcherSchema,
  }),
  /**
   * Analysis (AHSP) form words (analysis-block.ts). Not read yet.
   * shortcut: plain word lists; one role mixes match modes (URAIAN prefix, KOMPONEN whole word), so give each form
   * its own matchers when analysis-block.ts is switched to the profile.
   */
  analysisForm: z.object({
    componentHeader: synonyms,
    quantityHeader: synonyms,
    unitHeader: synonyms,
    priceHeader: synonyms,
    amountHeader: synonyms,
    titleLabels: synonyms,
  }),
});
export type RabProfile = z.infer<typeof rabProfileSchema>;

/** Built-in profile: exactly the words and match modes the office reader used before profiles (D-044). */
export const RAB_BUILTIN_PROFILE: RabProfile = {
  profileVersion: RAB_PROFILE_VERSION,
  name: 'Bawaan (kantor)',
  origin: 'BAWAAN',
  sheets: {},
  rab: {
    no: { match: 'EXACT', words: ['NO', 'NO.'] },
    volume: { match: 'EXACT', words: ['VOLUME'] },
    // = /^NO\.? ?ANALISA/
    analysis: { match: 'PREFIX', words: ['NO. ANALISA', 'NO.ANALISA', 'NO ANALISA', 'NOANALISA'] },
    description: { match: 'PREFIX', words: ['JENIS PEKERJAAN', 'URAIAN'] },
    unit: { match: 'EXACT', words: ['SAT', 'SATUAN'] },
    price: { match: 'PREFIX', words: ['HARGA'] },
    tax: { match: 'WORD', words: ['PPN'] },
    amount: { match: 'WORD', words: ['SUB JUMLAH', 'SUBJUMLAH', 'JUMLAH'] },
    totalLabels: { match: 'WORD', words: ['JUMLAH', 'DIBULATKAN', 'TOTAL', 'SUB TOTAL', 'SUBTOTAL', 'REAL COST'] },
    grandTotal: { match: 'PREFIX', words: ['JUMLAH TOTAL'] },
    bareTotal: { match: 'EXACT', words: ['JUMLAH'] },
    rounded: { match: 'PREFIX', words: ['DIBULATKAN'] },
  },
  analysisForm: {
    componentHeader: ['URAIAN', 'KOMPONEN'],
    quantityHeader: ['KOEFISIEN', 'KUANTITAS', 'PERKIRAAN KUANTITAS', 'KOEF'],
    unitHeader: ['SATUAN'],
    priceHeader: ['HARGA SATUAN'],
    amountHeader: ['JUMLAH HARGA'],
    titleLabels: ['ITEM PEMBAYARAN', 'JENIS PEKERJAAN'],
  },
};
