import { isValidIsoDate } from '@laporan-proyek/calc';
import { z } from 'zod';

/** A project's RAB documents: one Kontrak, then MC-0 … MC-100 (D-069). */
export const RAB_VERSION_TYPES = ['CONTRACT', 'MC'] as const;
export type RabVersionType = (typeof RAB_VERSION_TYPES)[number];
/** REOPENED: an approved version opened again for correction (D-068); it keeps its id, type and number. */
export const RAB_VERSION_STATUSES = ['DRAFT', 'APPROVED', 'DISCARDED', 'REOPENED'] as const;
export type RabVersionStatus = (typeof RAB_VERSION_STATUSES)[number];
/** Statuses whose rows and package may change. */
export const RAB_EDITABLE_STATUSES: readonly RabVersionStatus[] = ['DRAFT', 'REOPENED'];

/** Highest MC number a project may reach (D-069). */
export const MC_MAX_NUMBER = 100;

/** Domain order Kontrak → MC-0 → MC-1 … MC-100; never the (re)approval time (D-068). */
export const rabVersionRank = (v: { versionType: RabVersionType; revisionNumber: number }): number =>
  v.versionType === 'CONTRACT' ? 0 : 1 + v.revisionNumber;

/** Lowest number a new MC may take: 0 when none exists yet, else one past the highest live MC (D-069). */
export const nextMcNumber = (versions: { versionType: RabVersionType; revisionNumber: number }[]): number =>
  Math.max(-1, ...versions.filter((v) => v.versionType === 'MC').map((v) => v.revisionNumber)) + 1;

/** Why `n` cannot be the next MC, or null. Numbers may skip (MC-1 → MC-30) but only go up, up to MC-100 (D-069). */
export function mcNumberError(versions: { versionType: RabVersionType; revisionNumber: number }[], n: number): string | null {
  const min = nextMcNumber(versions);
  if (min > MC_MAX_NUMBER) return `Batas MC tercapai: MC-${MC_MAX_NUMBER} adalah MC terakhir.`;
  if (n < min) return `Nomor MC harus lebih besar dari MC-${min - 1} yang sudah ada (minimal MC-${min}).`;
  if (n > MC_MAX_NUMBER) return `Nomor MC maksimal ${MC_MAX_NUMBER}.`;
  return null;
}

/** MC number field of the create forms: optional (defaults to the lowest allowed), only for MC. */
export const mcNumberSchema = z
  .number({ message: 'Nomor MC berupa angka bulat 0–100.' })
  .int({ message: 'Nomor MC berupa angka bulat 0–100.' })
  .min(0, { message: 'Nomor MC berupa angka bulat 0–100.' })
  .max(MC_MAX_NUMBER, { message: `Nomor MC maksimal ${MC_MAX_NUMBER}.` })
  .optional();

/** The last version in domain order, or undefined. */
export const latestInDomainOrder = <T extends { versionType: RabVersionType; revisionNumber: number }>(
  versions: T[],
): T | undefined => versions.reduce<T | undefined>((a, v) => (!a || rabVersionRank(v) > rabVersionRank(a) ? v : a), undefined);
/** Stored row types (D-040); SUBTOTAL/TOTAL are computed for display only. */
export const RAB_ROW_TYPES = ['SECTION', 'SUBSECTION', 'PARENT_ITEM', 'ITEM'] as const;
export type RabRowType = (typeof RAB_ROW_TYPES)[number];
export const RAB_CHANGE_TYPES = ['UNCHANGED', 'MODIFIED', 'NEW', 'REMOVED'] as const;
export type RabChangeType = (typeof RAB_CHANGE_TYPES)[number];

export function rabVersionLabel(v: {
  versionType: RabVersionType;
  revisionNumber: number;
}): string {
  return v.versionType === 'CONTRACT' ? 'Kontrak' : `MC-${v.revisionNumber}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Maksimal ${max} karakter.` })
    .transform((v) => v || null)
    .nullable()
    .optional();
const optionalDate = z
  .string()
  .refine((v) => v === '' || isValidIsoDate(v), { message: 'Tanggal harus valid (YYYY-MM-DD).' })
  .transform((v) => v || null)
  .nullable()
  .optional();
/** Non-negative decimal string with at most `scale` decimals and `integer` integer digits; '' / null clears it. */
const decimal = (label: string, integer: number, scale: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^(|\\d{1,${integer}}(\\.\\d{1,${scale}})?)$`), {
      message: `${label} berupa angka ≥ 0, maks. ${scale} desimal, tanpa pemisah ribuan (gunakan titik untuk desimal).`,
    })
    .transform((v) => v || null)
    .nullable()
    .optional();

export const createRabVersionSchema = z
  .object({
    versionType: z.enum(RAB_VERSION_TYPES, { message: 'Jenis versi tidak dikenal.' }),
    /** MC only; absent = lowest allowed number (D-069). */
    revisionNumber: mcNumberSchema,
    documentNumber: optionalText(100),
    documentDate: optionalDate,
  })
  .refine((v) => v.versionType === 'MC' || v.revisionNumber === undefined, { message: 'Nomor hanya untuk MC.', path: ['revisionNumber'] });
export type CreateRabVersionInput = z.infer<typeof createRabVersionSchema>;

/** Required by the server for every change to a REOPENED version (D-068); optional on drafts. */
const correctionReason = z.string().trim().max(1000).optional();
/** Optional body (e.g. DELETE without a body on a draft). */
export const correctionReasonSchema = z.object({ reason: correctionReason }).optional();
export type CorrectionReasonInput = z.infer<typeof correctionReasonSchema>;

export const updateRabVersionSchema = z
  .object({ documentNumber: optionalText(100), documentDate: optionalDate, reason: correctionReason })
  .refine((v) => v.documentNumber !== undefined || v.documentDate !== undefined, {
    message: 'Tidak ada perubahan.',
  });
export type UpdateRabVersionInput = z.infer<typeof updateRabVersionSchema>;

const rowFields = {
  displayNumber: optionalText(30),
  volume: decimal('Volume', 18, 12),
  unit: optionalText(30),
  analysisCode: optionalText(50),
  unitPrice: decimal('Harga satuan', 18, 2),
  taxPercent: decimal('PPN', 3, 2).refine((v) => v == null || Number(v) <= 100, {
    message: 'PPN 0–100%.',
  }),
};
const description = z
  .string({ message: 'Uraian wajib diisi.' })
  .trim()
  .min(1, { message: 'Uraian wajib diisi.' })
  .max(1000);

export const createRabItemSchema = z.object({
  parentId: z.uuid().nullable().optional(),
  rowType: z.enum(RAB_ROW_TYPES, { message: 'Jenis baris tidak dikenal.' }),
  description,
  ...rowFields,
  reason: correctionReason,
});
export type CreateRabItemInput = z.infer<typeof createRabItemSchema>;

export const updateRabItemSchema = z
  .object({
    parentId: z.uuid().nullable().optional(),
    description: description.optional(),
    ...rowFields,
    reason: correctionReason,
  })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== 'reason' && x !== undefined), {
    message: 'Tidak ada perubahan.',
  });
export type UpdateRabItemInput = z.infer<typeof updateRabItemSchema>;

export const moveRabItemSchema = z.object({ direction: z.enum(['up', 'down']), reason: correctionReason });
export type MoveRabItemInput = z.infer<typeof moveRabItemSchema>;

/** Reorders the complete sibling list in one request so a drag gesture is atomic. */
export const reorderRabItemsSchema = z
  .object({ parentId: z.uuid().nullable(), itemIds: z.array(z.uuid()).min(1).max(5000), reason: correctionReason })
  .superRefine(({ itemIds }, ctx) => {
    if (new Set(itemIds).size !== itemIds.length)
      ctx.addIssue({ code: 'custom', path: ['itemIds'], message: 'Daftar baris memuat item yang sama lebih dari sekali.' });
  });
export type ReorderRabItemsInput = z.infer<typeof reorderRabItemsSchema>;

const required = <T>(v: T | null | undefined) => v != null;
const reasonOf = { reason: correctionReason };

/** Base price of the version's package (D-068). */
export const correctPriceItemSchema = z.object({
  price: decimal('Harga dasar', 28, 12).refine(required, { message: 'Harga dasar wajib diisi.' }),
  ...reasonOf,
});
export type CorrectPriceItemInput = z.infer<typeof correctPriceItemSchema>;

/** Coefficient, or the price of a component that has no base price/sub-analysis behind it. */
export const correctComponentSchema = z
  .object({
    coefficient: decimal('Koefisien', 18, 12).refine((v) => v !== null, { message: 'Koefisien wajib diisi.' }),
    unitPrice: decimal('Harga komponen', 28, 12).refine((v) => v !== null, { message: 'Harga komponen wajib diisi.' }),
    ...reasonOf,
  })
  .refine((v) => v.coefficient !== undefined || v.unitPrice !== undefined, { message: 'Tidak ada perubahan.' });
export type CorrectComponentInput = z.infer<typeof correctComponentSchema>;

/** Overhead % (empty = no overhead) and the rounding of the analysis price (null = no rounding). */
export const correctAnalysisSchema = z
  .object({
    overheadPercent: decimal('Overhead', 5, 4),
    roundingScale: z.number().int().min(0).max(12).nullable().optional(),
    ...reasonOf,
  })
  .refine((v) => v.overheadPercent !== undefined || v.roundingScale !== undefined, { message: 'Tidak ada perubahan.' });
export type CorrectAnalysisInput = z.infer<typeof correctAnalysisSchema>;

/** Points an item at the right work item of the previous version (D-068); the old work item stays. */
export const correctWorkItemSchema = z.object({ workItemId: z.uuid(), ...reasonOf });
export type CorrectWorkItemInput = z.infer<typeof correctWorkItemSchema>;

/** One entry appended to `source_locator.corrections` of every row a correction changed. */
export interface CorrectionMark {
  at: string;
  by: string;
  reason: string | null;
  /** MANUAL = the edited input; RECALCULATED = derived from an edited input. */
  kind: 'MANUAL' | 'RECALCULATED';
  changes: Record<string, [string | number | null, string | number | null]>;
}

export const correctionsOf = (locator: unknown): CorrectionMark[] => {
  const list = (locator as { corrections?: unknown } | null)?.corrections;
  return Array.isArray(list) ? (list as CorrectionMark[]) : [];
};

export interface RabSnapshotSummaryDto {
  id: string;
  sequence: number;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  totalValue: string | null;
  checksum: string;
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface RabSnapshotPayload {
  schema: 1;
  version: {
    id: string;
    projectId: string;
    versionType: RabVersionType;
    revisionNumber: number;
    label: string;
    documentNumber: string | null;
    documentDate: string | null;
    previousVersionId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  };
  totals: RabTotalsDto;
  rows: (RabRowDto & { previousVersionItemId: string | null })[];
  package: {
    priceList: { id: string; versionNumber: number; location: string | null; period: string | null } | null;
    priceItems: { id: string; name: string; unit: string | null; price: string; copiedFromId: string | null; sourceLocator: unknown }[];
    analyses: {
      id: string;
      analysisId: string;
      versionNumber: number;
      code: string | null;
      name: string;
      unit: string | null;
      overheadPercent: string | null;
      roundingScale: number | null;
      directCost: string;
      overheadAmount: string;
      priceExact: string;
      price: string;
      copiedFromId: string | null;
      sourceImportId: string | null;
      sourceLocator: unknown;
      components: {
        id: string;
        sortOrder: number;
        category: string;
        description: string;
        unit: string | null;
        coefficient: string;
        unitPrice: string;
        amount: string;
        priceItemId: string | null;
        subAnalysisVersionId: string | null;
        subPriceBasis: string | null;
        sourceLocator: unknown;
      }[];
    }[];
  };
}

export interface RabSnapshotDto extends RabSnapshotSummaryDto {
  /** Checksum recomputed from the stored payload equals the stored one. */
  checksumValid: boolean;
  payload: RabSnapshotPayload;
}

export interface RabHistoryDto {
  snapshots: RabSnapshotSummaryDto[];
  events: {
    id: string;
    action: string;
    actor: { id: string; name: string } | null;
    createdAt: string;
    reason: string | null;
    oldValue: unknown;
    newValue: unknown;
  }[];
}

export const approveRabVersionSchema = z.object({
  acknowledgeWarnings: z.boolean().default(false),
});
export type ApproveRabVersionInput = z.infer<typeof approveRabVersionSchema>;

/** Exact sums (D-043) plus the workbook's REAL COST (2 decimals) and DIBULATKAN (whole rupiah). */
export interface RabTotalsDto {
  beforeTax: string;
  tax: string;
  value: string;
  realCost: string;
  rounded: string;
}

export interface RabVersionSummaryDto {
  id: string;
  versionType: RabVersionType;
  revisionNumber: number;
  label: string;
  status: RabVersionStatus;
  documentNumber: string | null;
  documentDate: string | null;
  previousVersionId: string | null;
  /** Snapshot for APPROVED; computed for DRAFT/DISCARDED. */
  totals: RabTotalsDto;
  itemCount: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  discardedAt: string | null;
  discardReason: string | null;
}

export interface RabRowDto {
  id: string;
  parentId: string | null;
  depth: number;
  rowType: RabRowType;
  workItemId: string | null;
  workItemCode: string | null;
  displayNumber: string | null;
  description: string;
  volume: string | null;
  unit: string | null;
  analysisCode: string | null;
  unitPrice: string | null;
  taxPercent: string | null;
  unitPriceWithTax: string | null;
  subtotalBeforeTax: string | null;
  subtotal: string | null;
  weight: string | null;
  /** MANUAL | ANALYSIS | SOURCE_OVERRIDE | DIRECT (D-051). */
  priceSource: 'MANUAL' | 'ANALYSIS' | 'SOURCE_OVERRIDE' | 'DIRECT';
  /** `rabVersionId` owns the analysis; it differs from the row's version only on legacy links (D-057). */
  analysis: {
    analysisId: string;
    versionId: string;
    rabVersionId: string;
    code: string | null;
    name: string;
  } | null;
  priceNote: string | null;
  sourceLocator: unknown;
  sourceUnitPrice: string | null;
  analysisUnitPrice: string | null;
  priceDecidedAt: string | null;
}

export interface RabIssue {
  itemId?: string;
  message: string;
}

export interface RabVersionDetailDto {
  version: RabVersionSummaryDto;
  rows: RabRowDto[];
  totals: RabTotalsDto;
  issues: { errors: RabIssue[]; warnings: RabIssue[] };
}

export const RAB_COMPARE_FIELDS = [
  'description',
  'unit',
  'analysisCode',
  'volume',
  'unitPrice',
  'taxPercent',
  'group',
] as const;
export type RabCompareField = (typeof RAB_COMPARE_FIELDS)[number];

export interface RabCompareRowDto {
  workItemId: string;
  workItemCode: string;
  change: RabChangeType;
  /** What differs for MODIFIED rows; 'group' = moved to another section/sub-section/parent item. */
  changes: RabCompareField[];
  /** Ancestor path such as "B › B.II" in each version. */
  baseGroup: string | null;
  targetGroup: string | null;
  base: RabRowDto | null;
  target: RabRowDto | null;
}

export interface RabCompareDto {
  base: RabVersionSummaryDto;
  target: RabVersionSummaryDto;
  rows: RabCompareRowDto[];
}
