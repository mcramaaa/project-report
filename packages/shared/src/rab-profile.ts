import { z } from 'zod';
import { createRabImportSchema, type ImportIssue, type RabImportDraft, type RabReconciliation } from './rab-import.js';

/**
 * Mapping profile of a RAB workbook (RAB_PLAYGROUND.md §4, stage 1). Declarative data: the office RAB reader
 * (rab-sheet.ts) and the analysis form reader (analysis-block.ts) take their header words and labels from it; the
 * built-in profile reproduces the words the readers matched before, so results do not change.
 */
export const RAB_PROFILE_VERSION = 1 as const;
export const RAB_PROFILE_ORIGINS = ['BAWAAN', 'MANUAL', 'AI'] as const;
export type RabProfileOrigin = (typeof RAB_PROFILE_ORIGINS)[number];
export const RAB_SHEET_ROLES = ['RAB', 'ANALISA', 'DAFTAR_HARGA', 'ABAIKAN'] as const;
export type RabSheetRole = (typeof RAB_SHEET_ROLES)[number];
/** EXACT: whole text; PREFIX: text starts with the word; WORD: starts with the word as a whole word; CONTAINS: anywhere. */
export const WORD_MATCHES = ['EXACT', 'PREFIX', 'WORD', 'CONTAINS'] as const;
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
/** One role named by words matched in different ways (e.g. "NO. MATA…" as prefix, "KODE" as a whole word). */
const matchers = z.array(wordMatcherSchema).min(1).max(10);

const isWordChar = (ch: string | undefined) => ch !== undefined && /\w/.test(ch);
/** Whether normalised (uppercase, single-spaced) cell text matches one of the words. Runs per cell: no RegExp build. */
export function matchesWord(text: string, m: WordMatcher): boolean {
  return m.words.some((w) => {
    if (m.match === 'EXACT') return text === w;
    if (m.match === 'CONTAINS') return text.includes(w);
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
   * RAB sheets read by header words (D-090, headerless-sheet.ts). A column matches when any matcher of its role does;
   * the rightmost matching column wins.
   */
  headerless: z.object({
    code: matchers,
    description: matchers,
    unit: matchers,
    quantity: matchers,
    price: matchers,
    amount: matchers,
    /** Division title rows without a code ("DIVISI 1. UMUM"), matched on the uppercased description. */
    division: wordMatcherSchema,
  }),
  /** Analysis (AHSP) forms read by analysis-block.ts. */
  analysisForm: z.object({
    /** Office form: label row "NO. | URAIAN | SATUAN | KOEFISIEN | HARGA SATUAN | JUMLAH HARGA". */
    office: z.object({
      no: wordMatcherSchema,
      description: wordMatcherSchema,
      unit: wordMatcherSchema,
      coefficient: wordMatcherSchema,
      price: wordMatcherSchema,
      amount: wordMatcherSchema,
    }),
    /** Bina Marga form (D-091): label row starting at KOMPONEN; titles may run over two rows. */
    binaMarga: z.object({
      component: wordMatcherSchema,
      unit: wordMatcherSchema,
      quantity: wordMatcherSchema,
      /** Tried only when no column matches `quantity`. */
      quantityFallback: wordMatcherSchema,
      price: wordMatcherSchema,
      amount: wordMatcherSchema,
      /** Label of the row holding the analysis price (F). */
      totalRow: wordMatcherSchema,
    }),
    /** Labels above a Bina Marga block whose neighbour cell holds the code, name and unit. */
    title: z.object({
      code: wordMatcherSchema,
      name: wordMatcherSchema,
      unit: wordMatcherSchema,
      /** Form labels that are never a title value. */
      formLabels: wordMatcherSchema,
    }),
    /** Category label rows above the components. */
    categories: z.object({ LABOR: wordMatcherSchema, MATERIAL: wordMatcherSchema, EQUIPMENT: wordMatcherSchema }),
  }),
});
export type RabProfile = z.infer<typeof rabProfileSchema>;

/**
 * D-094: saving a profile by hand. The server sets the origin (MANUAL): BAWAAN exists only in code and AI only comes
 * from the assistant (stage 3), so a client cannot claim either.
 */
export const createRabProfileSchema = z.object({ profile: rabProfileSchema.omit({ origin: true }) });
export type CreateRabProfileInput = z.infer<typeof createRabProfileSchema>;

/**
 * RAB_PLAYGROUND stage 2: read documents with an unsaved profile exactly like a run would, without storing anything
 * and without calling AI (no workbook content leaves the server).
 */
export const previewRabProfileSchema = createRabImportSchema
  .omit({ mappingProfileId: true })
  // A preview does not need a name: only saving does.
  .extend({ profile: rabProfileSchema.omit({ origin: true, name: true }) });
export type PreviewRabProfileInput = z.infer<typeof previewRabProfileSchema>;

export interface RabProfilePreviewDto {
  /** Input problem the reader stopped on (no RAB sheet, header not recognised); null when the documents were read. */
  error: string | null;
  sources: RabImportDraft['sources'];
  counts: { items: number; analysis: number; direct: number; unresolved: number; none: number; analyses: number };
  /** Totals against the workbook's own total (D-054); null when nothing was read. */
  reconciliation: RabReconciliation | null;
  /** Issues of the would-be run, each with the cell it came from ("RAB!F14") when known. */
  issues: (ImportIssue & { cell: string | null })[];
}

/** One editable role of a profile: where its matcher lives and what the reviewer reads. `many` = list of matchers. */
export interface RabProfileRole {
  path: string;
  label: string;
  many: boolean;
}
const roles = (list: [path: string, label: string, many?: true][]): RabProfileRole[] =>
  list.map(([path, label, many]) => ({ path, label, many: Boolean(many) }));
/** Every role a reviewer (playground) or the assistant (stage 3) may change, grouped as the editor shows them. */
export const RAB_PROFILE_SECTIONS: { title: string; description: string; roles: RabProfileRole[] }[] = [
  {
    title: 'Sheet RAB kantor',
    description: 'Sheet dengan judul kolom VOLUME dan NO. ANALISA.',
    roles: roles([
      ['rab.no', 'Kolom NO'],
      ['rab.volume', 'Kolom volume'],
      ['rab.analysis', 'Kolom no. analisa'],
      ['rab.description', 'Kolom uraian'],
      ['rab.unit', 'Kolom satuan'],
      ['rab.price', 'Kolom harga (yang juga memuat kata PPN = harga + PPN)'],
      ['rab.tax', 'Kolom PPN'],
      ['rab.amount', 'Kolom jumlah'],
      ['rab.totalLabels', 'Label baris total'],
      ['rab.grandTotal', 'Label total akhir'],
      ['rab.bareTotal', 'Label total tanpa keterangan'],
      ['rab.rounded', 'Label dibulatkan'],
    ]),
  },
  {
    title: 'Sheet berdasarkan kata header (HPS/BOQ)',
    description: 'Sheet tanpa VOLUME dan NO. ANALISA. Kolom cocok bila salah satu aturannya cocok; kolom paling kanan dipakai.',
    roles: roles([
      ['headerless.code', 'Kolom kode / no. mata pembayaran', true],
      ['headerless.description', 'Kolom uraian', true],
      ['headerless.unit', 'Kolom satuan', true],
      ['headerless.quantity', 'Kolom kuantitas', true],
      ['headerless.price', 'Kolom harga satuan', true],
      ['headerless.amount', 'Kolom jumlah', true],
      ['headerless.division', 'Label baris divisi'],
    ]),
  },
  {
    title: 'Formulir analisa kantor',
    description: 'Baris judul tepat di bawah kepala analisa.',
    roles: roles([
      ['analysisForm.office.no', 'Kolom NO'],
      ['analysisForm.office.description', 'Kolom uraian'],
      ['analysisForm.office.unit', 'Kolom satuan'],
      ['analysisForm.office.coefficient', 'Kolom koefisien'],
      ['analysisForm.office.price', 'Kolom harga satuan'],
      ['analysisForm.office.amount', 'Kolom jumlah harga'],
    ]),
  },
  {
    title: 'Formulir analisa Bina Marga',
    description: 'Baris judul diawali KOMPONEN; judul boleh dua baris.',
    roles: roles([
      ['analysisForm.binaMarga.component', 'Kolom komponen'],
      ['analysisForm.binaMarga.unit', 'Kolom satuan'],
      ['analysisForm.binaMarga.quantity', 'Kolom kuantitas'],
      ['analysisForm.binaMarga.quantityFallback', 'Kolom kuantitas cadangan'],
      ['analysisForm.binaMarga.price', 'Kolom harga satuan'],
      ['analysisForm.binaMarga.amount', 'Kolom jumlah harga'],
      ['analysisForm.binaMarga.totalRow', 'Label baris harga analisa'],
    ]),
  },
  {
    title: 'Judul blok analisa',
    description: 'Label di atas blok Bina Marga; nilainya ada di sel sebelah kanan.',
    roles: roles([
      ['analysisForm.title.code', 'Label kode'],
      ['analysisForm.title.name', 'Label nama pekerjaan'],
      ['analysisForm.title.unit', 'Label satuan'],
      ['analysisForm.title.formLabels', 'Label formulir (bukan nilai judul)'],
    ]),
  },
  {
    title: 'Kategori komponen',
    description: 'Baris kategori di atas komponen analisa.',
    roles: roles([
      ['analysisForm.categories.LABOR', 'Tenaga'],
      ['analysisForm.categories.MATERIAL', 'Bahan'],
      ['analysisForm.categories.EQUIPMENT', 'Alat'],
    ]),
  },
];
export const RAB_PROFILE_ROLES: RabProfileRole[] = RAB_PROFILE_SECTIONS.flatMap((s) => s.roles);

/** Stage 3 (D-095): the reviewer's question or instruction to the assistant, with the playground's documents and profile. */
export const assistRabProfileSchema = previewRabProfileSchema.extend({ message: z.string().trim().min(1).max(2000) });
export type AssistRabProfileInput = z.infer<typeof assistRabProfileSchema>;

export interface RabProfileAssistDto {
  /** The assistant's answer to the reviewer, in its own words (never numbers the system relies on). */
  reply: string;
  model: string;
  /** Proposed words whose cited cells hold them: applied to `profile`. */
  accepted: { role: string; label: string; match: WordMatch; words: string[]; cells: string[]; reason: string }[];
  /** Proposals the system could not prove, with why. */
  rejected: { role: string; words: string[]; reason: string }[];
  /** The playground profile with the accepted words (name left to the reviewer). */
  profile: Omit<RabProfile, 'origin' | 'name'>;
  before: RabProfilePreviewDto['counts'] | null;
  /** What a run would read with `profile`. */
  after: RabProfilePreviewDto;
  /** What left the server for this answer (D-095, RAB_PLAYGROUND §6). */
  sent: { characters: number; sheets: string[] };
}

export interface RabProfileDto {
  id: string;
  name: string;
  origin: RabProfileOrigin;
  /** D-096: the profile new runs use when they name none. */
  isDefault: boolean;
  profile: RabProfile;
  createdBy: { id: string; name: string };
  createdAt: string;
}

/** Built-in profile: exactly the words and match modes the readers used before profiles (D-044, D-051, D-091). */
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
  headerless: {
    code: [
      // = /^NO\.? ?MATA/, /^NO\.? ?ITEM/, /^NO\.? ?PEMBAYARAN/, /^ITEM PEMBAYARAN/
      {
        match: 'PREFIX',
        words: [
          ...['MATA', 'ITEM', 'PEMBAYARAN'].flatMap((w) => [`NO. ${w}`, `NO.${w}`, `NO ${w}`, `NO${w}`]),
          'ITEM PEMBAYARAN',
        ],
      },
      { match: 'WORD', words: ['KODE'] },
    ],
    description: [{ match: 'PREFIX', words: ['URAIAN', 'JENIS PEKERJAAN', 'ITEM PEKERJAAN', 'NAMA PEKERJAAN'] }],
    unit: [{ match: 'EXACT', words: ['SATUAN', 'SAT'] }],
    quantity: [
      { match: 'CONTAINS', words: ['KUANTITAS'] },
      { match: 'WORD', words: ['VOLUME', 'QTY'] },
    ],
    price: [
      { match: 'PREFIX', words: ['HARGA SATUAN'] },
      { match: 'WORD', words: ['HARGA SAT'] },
    ],
    amount: [{ match: 'PREFIX', words: ['JUMLAH', 'TOTAL HARGA', 'SUB JUMLAH', 'SUBJUMLAH'] }],
    division: { match: 'WORD', words: ['DIVISI'] },
  },
  analysisForm: {
    office: {
      no: { match: 'EXACT', words: ['NO', 'NO.'] },
      description: { match: 'PREFIX', words: ['URAIAN'] },
      unit: { match: 'EXACT', words: ['SATUAN'] },
      coefficient: { match: 'EXACT', words: ['KOEFISIEN'] },
      price: { match: 'PREFIX', words: ['HARGA SATUAN'] },
      amount: { match: 'PREFIX', words: ['JUMLAH HARGA'] },
    },
    binaMarga: {
      component: { match: 'WORD', words: ['KOMPONEN'] },
      unit: { match: 'EXACT', words: ['SATUAN'] },
      quantity: { match: 'WORD', words: ['PERKIRAAN KUANTITAS', 'KUANTITAS'] },
      quantityFallback: { match: 'PREFIX', words: ['KOEF'] },
      price: { match: 'PREFIX', words: ['HARGA SATUAN'] },
      amount: { match: 'PREFIX', words: ['JUMLAH HARGA'] },
      totalRow: { match: 'PREFIX', words: ['TOTAL HARGA', 'HARGA SATUAN PEKERJAAN'] },
    },
    title: {
      code: { match: 'PREFIX', words: ['ITEM PEMBAYARAN'] },
      name: { match: 'PREFIX', words: ['JENIS PEKERJAAN'] },
      unit: { match: 'PREFIX', words: ['SATUAN PEMBAYARAN'] },
      formLabels: {
        match: 'PREFIX',
        words: ['TOTAL HARGA', 'PERKIRAAN VOL', '% THD', 'ITEM PEMBAYARAN', 'JENIS PEKERJAAN', 'SATUAN PEMBAYARAN', 'NO. PAKET', 'NAMA PAKET'],
      },
    },
    categories: {
      LABOR: { match: 'EXACT', words: ['TENAGA', 'TENAGA KERJA', 'UPAH', 'PEKERJA'] },
      MATERIAL: { match: 'EXACT', words: ['BAHAN', 'MATERIAL'] },
      EQUIPMENT: { match: 'EXACT', words: ['PERALATAN', 'ALAT'] },
    },
  },
};

/** D-096: chat about one import run. The reviewer writes; the assistant answers and may propose profile words. */
export const rabImportChatSchema = z.object({ message: z.string().trim().min(1).max(2000) });
export type RabImportChatInput = z.infer<typeof rabImportChatSchema>;

/** Applying a proposal creates a new run with a saved profile; the name labels that profile. */
export const applyRabImportChatSchema = z.object({ name: z.string().trim().min(1).max(120).optional() });
export type ApplyRabImportChatInput = z.infer<typeof applyRabImportChatSchema>;

/** A proposal as the server proved it: accepted words with their cells, rejected ones with the reason. */
/** D-096: a change to one RAB item the workbook cell proves. Applied one by one by the reviewer (rab.edit). */
export const RAB_CHAT_EDIT_FIELDS = ['volume', 'unit', 'taxPercent', 'description'] as const;
export type RabChatEditField = (typeof RAB_CHAT_EDIT_FIELDS)[number];
export interface RabChatEdit {
  /** The item's code as the RAB shows it (displayNumber), e.g. "1.2". */
  itemCode: string;
  field: RabChatEditField;
  value: string;
  /** The cell that holds the value in the workbook ("BOQ!F5"). */
  cell: string;
  reason: string;
  applied: boolean;
}

export interface RabChatProposals {
  accepted: RabProfileAssistDto['accepted'];
  rejected: RabProfileAssistDto['rejected'];
  /** The profile with the accepted words (name and origin are added when a run is created). */
  profile: Omit<RabProfile, 'origin' | 'name'>;
  model: string | null;
  /** Item changes the workbook proves; empty when the answer proposes none. */
  edits: RabChatEdit[];
  rejectedEdits: { itemCode: string; field: string; value: string; reason: string }[];
}

export interface RabImportChatMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  proposals: RabChatProposals | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface RabImportChatTurnDto {
  user: RabImportChatMessageDto;
  assistant: RabImportChatMessageDto;
}


/** D-096: applying one proven item change; the reason is optional (the proposal's own reason is used otherwise). */
export const applyRabChatEditSchema = z.object({ reason: z.string().trim().max(1000).optional() });
export type ApplyRabChatEditInput = z.infer<typeof applyRabChatEditSchema>;
