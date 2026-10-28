import { isValidIsoDate } from '@laporan-proyek/calc';
import { z } from 'zod';

/** D-071 / PRD §7: from the first project week after the document date, or from an exact date. */
export const BASELINE_ACTIVATION_MODES = ['NEXT_WEEK', 'EXACT_DATE'] as const;
export type BaselineActivationMode = (typeof BASELINE_ACTIVATION_MODES)[number];

export const activateBaselineSchema = z
  .object({
    rabVersionId: z.uuid({ message: 'Versi RAB tidak valid.' }),
    activationMode: z.enum(BASELINE_ACTIVATION_MODES, { message: 'Mode aktivasi tidak dikenal.' }),
    /** EXACT_DATE only; defaults to the document date. */
    effectiveFrom: z
      .string()
      .refine(isValidIsoDate, { message: 'Tanggal efektif harus tanggal valid (YYYY-MM-DD).' })
      .optional(),
    reason: z.string().trim().max(1000, { message: 'Maksimal 1000 karakter.' }).optional(),
  })
  .refine((v) => v.activationMode === 'EXACT_DATE' || v.effectiveFrom === undefined, {
    message: 'Tanggal efektif hanya untuk mode tanggal pasti.',
    path: ['effectiveFrom'],
  });
export type ActivateBaselineInput = z.infer<typeof activateBaselineSchema>;

export interface BaselineAssignmentDto {
  id: string;
  rabVersion: { id: string; label: string; documentNumber: string | null; documentDate: string | null };
  effectiveFrom: string;
  /** Day before the next assignment, or the planned finish date (not stored, D-071). */
  effectiveTo: string;
  activationMode: BaselineActivationMode;
  reason: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  /** Only the latest assignment can be revoked. */
  revocable: boolean;
}

/** An approved version that may be activated next, with the dates each mode would give. */
export interface BaselineCandidateDto {
  rabVersion: { id: string; label: string; documentNumber: string | null; documentDate: string | null };
  /** First project week after the document date; null when there is no document date or no later week. */
  nextWeek: { effectiveFrom: string; weekNumber: number } | null;
  /** Default EXACT_DATE (document date, or the project start for Kontrak); null when outside the project. */
  exactDefault: string | null;
  /** Kontrak always starts on the project start date. */
  fixedDate: string | null;
}

/** One stretch of a week under one version (a mid-week change splits the week). */
export interface BaselineWeekDto {
  weekNumber: number;
  startDate: string;
  endDate: string;
  segments: { rabVersionId: string; label: string; startDate: string; endDate: string }[];
}

export interface ProjectBaselinesDto {
  assignments: BaselineAssignmentDto[];
  candidates: BaselineCandidateDto[];
  weeks: BaselineWeekDto[];
}
