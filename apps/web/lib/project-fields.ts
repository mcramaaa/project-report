import type { CreateProjectInput } from '@laporan-proyek/shared';

export type ProjectField = keyof CreateProjectInput;

/** Wizard steps from docs/UI_UX.md §4; the edit form reuses the identity/contract/SPMK fields. */
export const PROJECT_STEPS: { title: string; fields: { name: ProjectField; label: string; type?: 'date' | 'number'; hint?: string }[] }[] = [
  {
    title: 'Identitas',
    fields: [
      { name: 'code', label: 'Kode proyek' },
      { name: 'activityName', label: 'Kegiatan' },
      { name: 'subActivityName', label: 'Sub kegiatan' },
      { name: 'projectName', label: 'Nama pekerjaan' },
      { name: 'location', label: 'Lokasi' },
      { name: 'fiscalYear', label: 'Tahun anggaran', type: 'number' },
    ],
  },
  {
    title: 'Kontrak',
    fields: [
      { name: 'contractorName', label: 'Kontraktor' },
      { name: 'consultantName', label: 'Konsultan' },
      { name: 'contractNumber', label: 'Nomor kontrak' },
      { name: 'contractDate', label: 'Tanggal kontrak', type: 'date' },
      { name: 'contractValue', label: 'Nilai kontrak (Rp)', hint: 'Angka tanpa pemisah ribuan, maks. 2 desimal. Contoh: 1250000000.50' },
    ],
  },
  {
    title: 'SPMK',
    fields: [
      { name: 'spmkNumber', label: 'Nomor SPMK' },
      { name: 'spmkDate', label: 'Tanggal SPMK', type: 'date' },
      { name: 'startDate', label: 'Tanggal mulai', type: 'date' },
      { name: 'durationDays', label: 'Masa pelaksanaan (hari kalender)', type: 'number' },
    ],
  },
];

export const SCHEDULE_FIELDS: ProjectField[] = ['startDate', 'durationDays'];
const NUMBER_FIELDS = new Set<ProjectField>(['fiscalYear', 'durationDays']);

/** Form strings -> API values (numbers stay numbers so zod reports type errors per field). */
export function toProjectInput(values: Record<string, string>, fields: ProjectField[]): Record<string, string | number> {
  return Object.fromEntries(fields.map((f) => [f, NUMBER_FIELDS.has(f) && values[f]?.trim() ? Number(values[f]) : (values[f] ?? '')]));
}

/** Decimal string -> Indonesian notation without float conversion ("1234567.50" -> "1.234.567,50"). */
export function formatNumber(value: string | null, { trim = false } = {}): string {
  if (value === null) return '–';
  const [int, frac = ''] = value.split('.');
  const shown = trim ? frac.replace(/0+$/, '') : frac;
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${shown ? `,${shown}` : ''}`;
}

export function formatRupiah(value: string | null): string {
  if (value === null) return 'Belum diisi';
  const [, frac] = value.split('.');
  return `Rp ${formatNumber(value, { trim: frac === '00' })}`;
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
