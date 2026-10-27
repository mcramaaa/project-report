import type { RabImportStatus } from '@laporan-proyek/shared';

export const IMPORT_STATUS: Record<RabImportStatus, { label: string; tone: 'slate' | 'blue' | 'green' | 'red' }> = {
  UPLOADED: { label: 'Menunggu proses', tone: 'slate' },
  PROCESSING: { label: 'Diproses', tone: 'blue' },
  NEEDS_REVIEW: { label: 'Perlu review', tone: 'blue' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED: { label: 'Ditolak', tone: 'red' },
  FAILED: { label: 'Gagal', tone: 'red' },
};

export const CATEGORY_LABEL: Record<string, string> = { LABOR: 'Tenaga', MATERIAL: 'Bahan', EQUIPMENT: 'Alat' };
