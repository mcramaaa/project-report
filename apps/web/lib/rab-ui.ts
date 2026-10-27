import type { RabRowType, RabVersionStatus } from '@laporan-proyek/shared';

export const RAB_STATUS_BADGE: Record<RabVersionStatus, { tone: 'blue' | 'green' | 'slate'; label: string }> = {
  DRAFT: { tone: 'blue', label: 'Draft' },
  APPROVED: { tone: 'green', label: 'Approved' },
  DISCARDED: { tone: 'slate', label: 'Dibatalkan' },
  REOPENED: { tone: 'blue', label: 'Dibuka untuk koreksi' },
};

/** Project permissions that let a user change a version in this status (the API checks the same, D-068). */
export function canChangeVersion(status: RabVersionStatus | string, permissions: string[], needed: 'rab.edit' | 'ahsp.edit'): boolean {
  if (status === 'DRAFT') return permissions.includes(needed);
  return status === 'REOPENED' && permissions.includes(needed) && permissions.includes('rab.reopen');
}

export const RAB_ROW_TYPE_LABEL: Record<RabRowType, string> = {
  SECTION: 'Bagian',
  SUBSECTION: 'Sub-bagian',
  PARENT_ITEM: 'Induk pekerjaan',
  ITEM: 'Pekerjaan (item)',
};

/** Selectable grid columns (UI_UX §9); No and Uraian are always shown. */
export const RAB_COLUMNS = [
  { key: 'volume', label: 'Volume' },
  { key: 'unit', label: 'Satuan' },
  { key: 'analysisCode', label: 'No analisa' },
  { key: 'unitPrice', label: 'Harga satuan' },
  { key: 'taxPercent', label: 'PPN %' },
  { key: 'unitPriceWithTax', label: 'Harga + PPN' },
  { key: 'subtotal', label: 'Jumlah' },
  { key: 'weight', label: 'Bobot %' },
] as const;
export type RabColumn = (typeof RAB_COLUMNS)[number]['key'];
