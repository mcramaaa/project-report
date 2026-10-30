import { z } from 'zod';

/** D-072: one time schedule per approved RAB version; DRAFT → APPROVED, REOPENED for revision. */
export const SCHEDULE_STATUSES = ['DRAFT', 'APPROVED', 'REOPENED'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const createScheduleSchema = z.object({ rabVersionId: z.uuid({ message: 'Versi RAB tidak valid.' }) });
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

/** The whole grid; replaces every entry of the draft. Zero cells are left out. */
export const saveScheduleEntriesSchema = z.object({
  entries: z
    .array(
      z.object({
        groupId: z.uuid(),
        weekNumber: z.number().int().min(1).max(1000),
        weight: z.string().trim().regex(/^\d{1,3}(\.\d{1,18})?$/, { message: 'Isian berupa % ≥ 0, maks. 18 desimal, gunakan titik untuk desimal.' }),
      }),
    )
    .max(50_000),
});
export type SaveScheduleEntriesInput = z.infer<typeof saveScheduleEntriesSchema>;

export const importScheduleSchema = z.object({
  documentId: z.uuid({ message: 'Dokumen tidak valid.' }),
  /** Defaults to `Master Curva S`. */
  sheet: z.string().trim().min(1).max(100).optional(),
});
export type ImportScheduleInput = z.infer<typeof importScheduleSchema>;

export interface ScheduleSummaryDto {
  rabVersion: { id: string; label: string };
  schedule: { id: string; status: ScheduleStatus } | null;
}

export interface ScheduleDetailDto {
  id: string;
  status: ScheduleStatus;
  rabVersion: { id: string; label: string };
  sourceDocument: { id: string; filename: string } | null;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  weeks: { weekNumber: number; startDate: string; endDate: string }[];
  /** Schedule groups in RAB order with their weight (% of the RAB total) and the sum of their entries. */
  groups: { id: string; displayNumber: string | null; description: string; weight: string; planned: string }[];
  entries: { groupId: string; weekNumber: number; weight: string }[];
  /** Kurva S rencana. */
  curve: { weekNumber: number; planned: string; cumulative: string }[];
  /** Approval blockers (D-072 butir 5); empty when the schedule can be approved. */
  issues: { groupId: string | null; message: string }[];
  /** Import response only: groups scaled to this version's weight (D-074). */
  importAdjustments?: { group: string; from: string; to: string }[];
}

/** D-076: Kurva S rencana vs realisasi on the weights of the reference baseline. */
export interface SCurveDto {
  /** Baseline in force at the end of the current week; null without any baseline. */
  baseline: { rabVersionId: string; label: string } | null;
  /** The reference version's schedule; the plan is shown only when APPROVED. */
  schedule: { id: string; status: ScheduleStatus } | null;
  /** Curva S sheet rows (SECTION headings have weight null) with the planned % per week; empty without an approved plan. */
  rows: {
    id: string;
    displayNumber: string | null;
    description: string;
    weight: string | null;
    planned: (string | null)[];
    /** D-077: realised % of project weight per week from this group's items; null for headings and weeks not started. */
    actual: (string | null)[];
  }[];
  /** Week the project is in now (clamped to the project), for the "today" marker. */
  currentWeek: number;
  weeks: {
    weekNumber: number;
    startDate: string;
    endDate: string;
    planned: string | null;
    plannedCumulative: string | null;
    /** Null for weeks that have not started. */
    actual: string | null;
    actualCumulative: string | null;
    deviation: string | null;
  }[];
}
