import { z } from 'zod';
import { DECIMALS } from './format.js';
import { UPLOAD_MAX_BYTES } from './uploads.js';

/** D-082: report layout templates per project and report type. */
export const REPORT_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TYPE_LABELS: Record<ReportType, string> = { DAILY: 'Laporan harian', WEEKLY: 'Laporan mingguan', MONTHLY: 'Laporan bulanan' };

export const LOGO_KINDS = ['AGENCY', 'CONSULTANT', 'CONTRACTOR'] as const;
export type LogoKind = (typeof LOGO_KINDS)[number];
export const LOGO_LABELS: Record<LogoKind, string> = { AGENCY: 'Pemberi tugas / dinas', CONSULTANT: 'Konsultan pengawas', CONTRACTOR: 'Kontraktor (penyedia)' };
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const IDENTITY_KEYS = ['activityName', 'subActivityName', 'projectName', 'contract', 'spmk', 'contractor', 'consultant', 'location', 'fiscalYear'] as const;
export type IdentityKey = (typeof IDENTITY_KEYS)[number];
const IDENTITY_DEFAULTS: Record<IdentityKey, string> = {
  activityName: 'KEGIATAN',
  subActivityName: 'SUB. KEGIATAN',
  projectName: 'PEKERJAAN',
  contract: 'NO. KONTRAK / TANGGAL',
  spmk: 'NO. SPMK / TANGGAL',
  contractor: 'KONTRAKTOR PELAKSANA',
  consultant: 'KONSULTAN PENGAWAS',
  location: 'LOKASI PEKERJAAN',
  fiscalYear: 'TAHUN ANGGARAN',
};

type SectionDef = { key: string; title: string; columns: [key: string, label: string][] };
const period = (unit: 'MINGGU' | 'BULAN'): SectionDef[] => [
  // Office pack (D-085): cover C.n, rekap RM.n/RB.n, detail M.n/B.n, time schedule; summary/daily only in the stacked layout.
  { key: 'cover', title: `LAPORAN ${unit === 'MINGGU' ? 'MINGGUAN' : 'BULANAN'}`, columns: [] },
  { key: 'summary', title: 'RINGKASAN', columns: [] },
  {
    key: 'recap',
    title: `REKAP PROGRES ${unit === 'MINGGU' ? 'MINGGUAN' : 'BULANAN'}`,
    columns: [
      ['no', 'NO'],
      ['name', 'PEKERJAAN'],
      ['weight', 'BOBOT (%)'],
      ['previous', `S/D ${unit} LALU`],
      ['thisPeriod', `${unit} INI`],
      ['cumulative', `S/D ${unit} INI`],
      ['note', 'KETERANGAN'],
    ],
  },
  {
    key: 'items',
    title: `PROGRES ${unit === 'MINGGU' ? 'MINGGUAN' : 'BULANAN'}`,
    columns: [
      ['no', 'NO'],
      ['name', 'JENIS PEKERJAAN'],
      ['unit', 'SAT'],
      ['volume', 'VOLUME'],
      ['weight', 'BOBOT (%)'],
      ['previous', `S.D. ${unit} LALU`],
      ['thisPeriod', `DALAM ${unit} INI`],
      ['cumulative', `S/D ${unit} INI`],
      ['percent', 'PROGRES TERHADAP TIAP BAGIAN'],
      ['share', 'PROGRES TERHADAP SELURUH'],
      ['note', 'KETERANGAN'],
    ],
  },
  { key: 'curve', title: 'TIME SCHEDULE', columns: [] },
  { key: 'daily', title: 'RANGKUMAN LAPORAN HARIAN', columns: [] },
];
const qtyColumns = (name: string, qty: string): [string, string][] => [
  ['no', 'NO'],
  ['name', name],
  ['qty', qty],
  ['unit', 'SAT'],
];
/** Sections and their columns per report type, in the office workbooks' order. */
export const REPORT_SECTIONS: Record<ReportType, SectionDef[]> = {
  // Office format "04. LAPORAN HARIAN SMP NEGERI 5 MENGWI" (D-084): four tables side by side, in this order.
  DAILY: [
    { key: 'labor', title: 'TENAGA KERJA', columns: qtyColumns('KEAHLIAN', 'JUMLAH') },
    { key: 'equipment', title: 'JENIS ALAT', columns: qtyColumns('NAMA ALAT', 'JUMLAH') },
    { key: 'materials', title: 'PENGGUNAAN MATERIAL', columns: qtyColumns('JENIS MATERIAL', 'VOLUME') },
    { key: 'work', title: 'PEKERJAAN YANG DISELESAIKAN HARI INI', columns: qtyColumns('URAIAN PEKERJAAN', 'VOLUME') },
    { key: 'weather', title: 'KEADAAN CUACA', columns: [] },
    { key: 'note', title: 'CATATAN', columns: [] },
  ],
  WEEKLY: period('MINGGU'),
  MONTHLY: period('BULAN'),
};

const text = (max: number) => z.string().trim().max(max);
const columnSchema = z.object({ key: z.string().max(40), label: text(80), visible: z.boolean() });
const sectionSchema = z.object({
  key: z.string().max(40),
  title: text(120),
  visible: z.boolean(),
  columns: z.array(columnSchema).max(20),
  /** D-084: relative width of a table in the side-by-side daily layout. */
  width: z.number().int().min(10).max(400).optional(),
});
/** D-084: the fixed texts and sizes of the daily office form (sheet Har.n). */
const dailyFormSchema = z.object({
  minRows: z.number().int().min(0).max(60),
  fitToPage: z.boolean(),
  logoHeightMm: z.number().int().min(8).max(40),
  showAllStaff: z.boolean(),
  weekLabel: text(30),
  dayLabel: text(30),
  dateLabel: text(30),
  totalLabel: text(30),
  totalUnit: text(15),
  weatherLabels: z.object({ clear: text(30), cloudy: text(30), rain: text(30) }),
});
export type DailyFormSettings = z.infer<typeof dailyFormSchema>;
export const DAILY_FORM_DEFAULTS: DailyFormSettings = {
  minRows: 12,
  fitToPage: true,
  logoHeightMm: 18,
  showAllStaff: true,
  weekLabel: 'MINGGU KE',
  dayLabel: 'HARI',
  dateLabel: 'TANGGAL',
  totalLabel: 'JUMLAH',
  totalUnit: 'Org',
  weatherLabels: { clear: 'CERAH', cloudy: 'MENDUNG', rain: 'HUJAN' },
};
const DAILY_WIDTHS: Record<string, number> = { labor: 74, equipment: 62, materials: 73, work: 124 };
const signatureSchema = z.object({
  caption: text(80),
  role: text(120),
  organization: text(160),
  name: text(120),
  /** Jabatan rinci or NIP, printed under the name. */
  detail: text(120),
});
export const reportTemplateConfigSchema = z.object({
  page: z.object({
    size: z.enum(['A4', 'F4', 'LEGAL']),
    orientation: z.enum(['portrait', 'landscape']),
    marginMm: z.number().int().min(5).max(30),
    fontSizePt: z.number().min(6).max(14),
  }),
  header: z.object({
    showLogos: z.boolean(),
    logoCaptions: z.object({ AGENCY: text(60), CONSULTANT: text(60), CONTRACTOR: text(60) }),
    /** Kop lines, e.g. PEMERINTAH KOTA …, DINAS …, address. */
    lines: z.array(text(200)).max(6),
  }),
  title: text(120),
  identity: z.array(z.object({ key: z.enum(IDENTITY_KEYS), label: text(60), visible: z.boolean() })).max(IDENTITY_KEYS.length),
  sections: z.array(sectionSchema).max(12),
  signatures: z.array(signatureSchema).max(6),
  decimals: z.number().int().min(0).max(6),
  /** D-084: 'columns' = tables side by side (daily); D-085: 'office' = weekly/monthly pages as the office workbook; 'stacked' = one under another. */
  layout: z.enum(['stacked', 'columns', 'office']).default('stacked'),
  /** D-084: labor lines named here are listed under the staff heading, the rest under the worker heading. */
  laborGroups: z
    .object({ staffTitle: text(60), staffNames: z.array(text(80)).max(40), workerTitle: text(60) })
    .default({ staffTitle: '', staffNames: [], workerTitle: '' }),
  daily: dailyFormSchema.default(DAILY_FORM_DEFAULTS),
});
export type ReportTemplateConfig = z.infer<typeof reportTemplateConfigSchema>;
export type ReportSignature = ReportTemplateConfig['signatures'][number];

const sig = (caption: string, role: string, detail = ''): ReportSignature => ({ caption, role, organization: '', name: '', detail });
const SIGNATURE_DEFAULTS: Record<ReportType, ReportSignature[]> = {
  DAILY: [sig('Diperiksa Oleh :', 'Konsultan Pengawas', 'Pengawas Lapangan'), sig('Dibuat Oleh :', 'Kontraktor Pelaksana', 'Pelaksana Lapangan')],
  WEEKLY: [
    sig('Mengetahui / Disetujui Oleh :', 'Pejabat Pembuat Komitmen', 'NIP.'),
    sig('', 'Pejabat Pelaksana Teknis Kegiatan (PPTK)', 'NIP.'),
    sig('Diperiksa Oleh :', 'Konsultan Pengawas', 'Team Leader'),
    sig('Dibuat Oleh :', 'Kontraktor Pelaksana', 'Project Manager'),
  ],
  MONTHLY: [],
};
SIGNATURE_DEFAULTS.MONTHLY = SIGNATURE_DEFAULTS.WEEKLY.map((s) => ({ ...s }));

const TITLES: Record<ReportType, string> = { DAILY: 'LAPORAN HARIAN', WEEKLY: 'LAPORAN MINGGUAN', MONTHLY: 'LAPORAN BULANAN' };

/** Identity rows the daily office format shows (D-084); the others stay available but hidden. */
const DAILY_IDENTITY = new Set<IdentityKey>(['subActivityName', 'projectName', 'contractor', 'consultant', 'fiscalYear']);

export function defaultReportTemplate(type: ReportType): ReportTemplateConfig {
  const daily = type === 'DAILY';
  return {
    page: { size: 'A4', orientation: 'landscape', marginMm: daily ? 8 : 10, fontSizePt: 8 },
    header: {
      showLogos: true,
      // An empty caption hides that logo; the daily format shows the consultant and the contractor only.
      logoCaptions: { AGENCY: daily ? '' : 'PEMBERI TUGAS', CONSULTANT: 'KONSULTAN PENGAWAS', CONTRACTOR: 'KONTRAKTOR PELAKSANA' },
      lines: [],
    },
    title: TITLES[type],
    identity: IDENTITY_KEYS.map((key) => ({ key, label: IDENTITY_DEFAULTS[key], visible: !daily || DAILY_IDENTITY.has(key) })),
    sections: REPORT_SECTIONS[type].map((s) => ({
      key: s.key,
      title: s.title,
      visible: true,
      columns: s.columns.map(([key, label]) => ({ key, label, visible: true })),
      ...(daily && DAILY_WIDTHS[s.key] ? { width: DAILY_WIDTHS[s.key] } : {}),
    })),
    signatures: SIGNATURE_DEFAULTS[type].map((s) => ({ ...s })),
    decimals: DECIMALS.volume,
    layout: daily ? 'columns' : 'office',
    laborGroups: daily
      ? { staffTitle: 'Staff Kantor', staffNames: ['Project Manager', 'Engineering', 'QC / HSE', 'Spv / Admin Teknik', 'Drafter', 'Logistik'], workerTitle: 'Tenaga Kerja' }
      : { staffTitle: '', staffNames: [], workerTitle: '' },
    daily: { ...DAILY_FORM_DEFAULTS, weatherLabels: { ...DAILY_FORM_DEFAULTS.weatherLabels } },
  };
}

/**
 * Keeps the stored order and labels, drops keys this report type does not know, and appends sections/columns/identity
 * fields added since the template was saved, so old templates keep working when the report grows.
 */
export function normalizeReportTemplate(type: ReportType, config: ReportTemplateConfig): ReportTemplateConfig {
  const base = defaultReportTemplate(type);
  const merge = <T extends { key: string }>(saved: T[], defaults: T[], fix: (s: T, d: T) => T = (s) => s) => [
    ...saved.flatMap((s) => {
      const d = defaults.find((x) => x.key === s.key);
      return d ? [fix(s, d)] : [];
    }),
    ...defaults.filter((d) => !saved.some((s) => s.key === d.key)),
  ];
  const seen = new Set<string>();
  const unique = <T extends { key: string }>(xs: T[]) => xs.filter((x) => !seen.has(x.key) && seen.add(x.key));
  return {
    ...config,
    // Templates saved before D-084 have no layout or labor groups.
    layout: config.layout ?? base.layout,
    laborGroups: config.laborGroups ?? base.laborGroups,
    daily: { ...base.daily, ...config.daily, weatherLabels: { ...base.daily.weatherLabels, ...config.daily?.weatherLabels } },
    identity: unique(merge(config.identity, base.identity)),
    sections: merge(config.sections, base.sections, (s, d) => {
      const cols = new Set<string>();
      return { ...s, width: s.width ?? d.width, columns: merge(s.columns, d.columns).filter((c) => !cols.has(c.key) && cols.add(c.key)) };
    }).filter((s, i, all) => all.findIndex((x) => x.key === s.key) === i),
  };
}

export const importReportTemplatesSchema = z.object({ sourceProjectId: z.uuid({ message: 'Proyek sumber tidak valid.' }), includeLogos: z.boolean().default(true) });
export type ImportReportTemplatesInput = z.infer<typeof importReportTemplatesSchema>;

export interface ReportTemplateDto {
  reportType: ReportType;
  config: ReportTemplateConfig;
  /** Null while the project still uses the default layout. */
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface ProjectLogoDto {
  kind: LogoKind;
  mimeType: string;
  fileSize: number;
  updatedAt: string;
}

/** D-086: the office workbook a report type's Excel/PDF export fills. */
export interface ReportWorkbookDto {
  reportType: ReportType;
  originalName: string;
  fileSize: number;
  updatedAt: string;
  updatedBy: { id: string; name: string };
}
export const REPORT_WORKBOOK_MAX_BYTES = UPLOAD_MAX_BYTES;

export interface ReportTemplatesDto {
  templates: ReportTemplateDto[];
  logos: ProjectLogoDto[];
  workbooks: ReportWorkbookDto[];
  /** The server can print an office workbook to PDF (LibreOffice installed). */
  workbookPdf: boolean;
}
