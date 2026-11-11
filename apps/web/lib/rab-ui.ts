import type { DailyReportStatus, RabRowType, RabVersionStatus, ScheduleStatus, WeeklyReportStatus } from '@laporan-proyek/shared';

export const RAB_STATUS_BADGE: Record<
  RabVersionStatus,
  { tone: 'blue' | 'green' | 'slate' | 'amber'; label: string }
> = {
  DRAFT: { tone: 'blue', label: 'Draft' },
  APPROVED: { tone: 'green', label: 'Approved' },
  DISCARDED: { tone: 'slate', label: 'Dibatalkan' },
  REOPENED: { tone: 'amber', label: 'Dibuka untuk koreksi' },
};

export const SCHEDULE_STATUS_BADGE: Record<ScheduleStatus, { tone: 'blue' | 'green' | 'amber'; label: string }> = {
  DRAFT: { tone: 'blue', label: 'Draft' },
  APPROVED: { tone: 'green', label: 'Approved' },
  REOPENED: { tone: 'amber', label: 'Dibuka untuk revisi' },
};

/** Project permissions that let a user change a version in this status (the API checks the same, D-068). */
export function canChangeVersion(
  status: RabVersionStatus | string,
  permissions: string[],
  needed: 'rab.edit' | 'ahsp.edit',
): boolean {
  if (status === 'DRAFT') return permissions.includes(needed);
  return (
    status === 'REOPENED' && permissions.includes(needed) && permissions.includes('rab.reopen')
  );
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

export const WEEKLY_STATUS_BADGE: Record<WeeklyReportStatus, { tone: 'blue' | 'green' | 'amber' | 'slate'; label: string }> = {
  DRAFT: { tone: 'blue', label: 'Diajukan' },
  REVIEWED: { tone: 'slate', label: 'Diperiksa' },
  FINAL: { tone: 'green', label: 'Final' },
  REOPENED: { tone: 'amber', label: 'Dibuka kembali' },
};

export const DAILY_STATUS_BADGE: Record<DailyReportStatus, { tone: 'blue' | 'green' | 'amber'; label: string }> = {
  DRAFT: { tone: 'blue', label: 'Draft' },
  FINAL: { tone: 'green', label: 'Final' },
  REOPENED: { tone: 'amber', label: 'Revisi' },
};
