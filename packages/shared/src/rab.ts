import { isValidIsoDate } from '@laporan-proyek/calc';
import { z } from 'zod';

export const RAB_VERSION_TYPES = ['CONTRACT', 'MC0', 'ADDENDUM'] as const;
export type RabVersionType = (typeof RAB_VERSION_TYPES)[number];
export const RAB_VERSION_STATUSES = ['DRAFT', 'APPROVED', 'DISCARDED'] as const;
export type RabVersionStatus = (typeof RAB_VERSION_STATUSES)[number];
/** Stored row types (D-040); SUBTOTAL/TOTAL are computed for display only. */
export const RAB_ROW_TYPES = ['SECTION', 'SUBSECTION', 'PARENT_ITEM', 'ITEM'] as const;
export type RabRowType = (typeof RAB_ROW_TYPES)[number];
export const RAB_CHANGE_TYPES = ['UNCHANGED', 'MODIFIED', 'NEW', 'REMOVED'] as const;
export type RabChangeType = (typeof RAB_CHANGE_TYPES)[number];

export function rabVersionLabel(v: { versionType: RabVersionType; revisionNumber: number }): string {
  return v.versionType === 'CONTRACT' ? 'Kontrak' : v.versionType === 'MC0' ? 'MC-0' : `Addendum ${v.revisionNumber}`;
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

export const createRabVersionSchema = z.object({
  versionType: z.enum(RAB_VERSION_TYPES, { message: 'Jenis versi tidak dikenal.' }),
  documentNumber: optionalText(100),
  documentDate: optionalDate,
});
export type CreateRabVersionInput = z.infer<typeof createRabVersionSchema>;

export const updateRabVersionSchema = z
  .object({ documentNumber: optionalText(100), documentDate: optionalDate })
  .refine((v) => v.documentNumber !== undefined || v.documentDate !== undefined, { message: 'Tidak ada perubahan.' });
export type UpdateRabVersionInput = z.infer<typeof updateRabVersionSchema>;

const rowFields = {
  displayNumber: optionalText(30),
  volume: decimal('Volume', 18, 12),
  unit: optionalText(30),
  analysisCode: optionalText(50),
  unitPrice: decimal('Harga satuan', 18, 2),
  taxPercent: decimal('PPN', 3, 2).refine((v) => v == null || Number(v) <= 100, { message: 'PPN 0–100%.' }),
};
const description = z.string({ message: 'Uraian wajib diisi.' }).trim().min(1, { message: 'Uraian wajib diisi.' }).max(1000);

export const createRabItemSchema = z.object({
  parentId: z.uuid().nullable().optional(),
  rowType: z.enum(RAB_ROW_TYPES, { message: 'Jenis baris tidak dikenal.' }),
  description,
  ...rowFields,
});
export type CreateRabItemInput = z.infer<typeof createRabItemSchema>;

export const updateRabItemSchema = z
  .object({ parentId: z.uuid().nullable().optional(), description: description.optional(), ...rowFields })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Tidak ada perubahan.' });
export type UpdateRabItemInput = z.infer<typeof updateRabItemSchema>;

export const moveRabItemSchema = z.object({ direction: z.enum(['up', 'down']) });
export type MoveRabItemInput = z.infer<typeof moveRabItemSchema>;

export const approveRabVersionSchema = z.object({ acknowledgeWarnings: z.boolean().default(false) });
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

export interface RabCompareRowDto {
  workItemId: string;
  workItemCode: string;
  change: RabChangeType;
  base: RabRowDto | null;
  target: RabRowDto | null;
}

export interface RabCompareDto {
  base: RabVersionSummaryDto;
  target: RabVersionSummaryDto;
  rows: RabCompareRowDto[];
}
