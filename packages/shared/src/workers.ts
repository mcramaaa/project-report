import { z } from 'zod';

/** D-080 worker database (global). */
export const workerInputSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nama wajib diisi.' }).max(150),
  position: z.string().trim().min(1, { message: 'Posisi wajib diisi.' }).max(150),
  nik: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{16}$/, { message: 'NIK harus 16 digit angka.' })),
});
export type WorkerInput = z.infer<typeof workerInputSchema>;

export const updateWorkerSchema = workerInputSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateWorkerInput = z.infer<typeof updateWorkerSchema>;

export const listWorkersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListWorkersQuery = z.infer<typeof listWorkersQuerySchema>;

export const KTP_MAX_BYTES = 5 * 1024 * 1024;

/** 3578••••••••0001: what users without workers.manage see. */
export const maskNik = (nik: string) => `${nik.slice(0, 4)}${'•'.repeat(8)}${nik.slice(-4)}`;

export interface WorkerDto {
  id: string;
  name: string;
  position: string;
  /** Full NIK only for workers.manage; masked otherwise. */
  nik: string;
  hasKtp: boolean;
  isActive: boolean;
  updatedAt: string;
}

export const WORKER_IMPORT_MAX_ROWS = 2000;

export interface WorkerImportResult {
  created: number;
  updated: number;
}
