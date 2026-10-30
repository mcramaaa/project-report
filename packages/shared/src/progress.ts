import { z } from 'zod';

/** D-073: VOLUME_WEEK = this week's volume; PERCENT_CUMULATIVE = cumulative % of the week's baseline volume. */
export const PROGRESS_INPUT_MODES = ['VOLUME_WEEK', 'PERCENT_CUMULATIVE'] as const;
export type ProgressInputMode = (typeof PROGRESS_INPUT_MODES)[number];

const volume = z.string().trim().regex(/^\d{1,18}(\.\d{1,12})?$/, { message: 'Volume berupa angka ≥ 0, maks. 12 desimal, gunakan titik untuk desimal.' });
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, { message: 'Persen berupa angka 0–100, maks. 6 desimal, gunakan titik untuk desimal.' })
  .refine((v) => Number(v) <= 100, { message: 'Persen kumulatif maksimal 100.' });

/** Only the items sent change; the others in the week stay as they are. */
export const saveWeeklyProgressSchema = z.object({
  entries: z
    .array(
      z.discriminatedUnion('mode', [
        z.object({ workItemId: z.uuid(), mode: z.literal('VOLUME_WEEK'), volume, note: z.string().trim().max(1000).optional() }),
        z.object({ workItemId: z.uuid(), mode: z.literal('PERCENT_CUMULATIVE'), percentage: percent, note: z.string().trim().max(1000).optional() }),
      ]),
    )
    .min(1, { message: 'Tidak ada isian yang disimpan.' })
    .max(5000),
});
export type SaveWeeklyProgressInput = z.infer<typeof saveWeeklyProgressSchema>;

export interface ProgressWeekSummaryDto {
  weekNumber: number;
  startDate: string;
  endDate: string;
  /** Version in force on the last day of the week (D-073 butir 3); null without a baseline. */
  baseline: { rabVersionId: string; label: string } | null;
  /** Started (start date ≤ today) and the project is ACTIVE. */
  open: boolean;
  /** Work items with a progress row this week. */
  filledCount: number;
}

export interface ProgressRowDto {
  /** RAB row id in the baseline, or the work item id for an untracked row. */
  id: string;
  rowType: 'SECTION' | 'SUBSECTION' | 'PARENT_ITEM' | 'ITEM';
  depth: number;
  displayNumber: string | null;
  description: string;
  /** ITEM rows only from here on. */
  workItemId: string | null;
  workItemCode: string | null;
  unit: string | null;
  baselineVolume: string | null;
  /** In the baseline with a volume > 0 (D-073 butir 4). */
  trackable: boolean;
  previousCumulative: string;
  thisWeek: {
    volume: string;
    mode: ProgressInputMode;
    percentage: string | null;
    note: string | null;
    updatedBy: { id: string; name: string };
    updatedAt: string;
  } | null;
  cumulative: string;
  percent: string | null;
  remaining: string | null;
}

export interface WeeklyProgressDto {
  week: ProgressWeekSummaryDto;
  rows: ProgressRowDto[];
}

/** D-071 butir 5: work items whose reported progress exceeds the volume of the version being activated. */
export interface BaselineVolumeWarningDto {
  workItemId: string;
  workItemCode: string;
  description: string;
  reported: string;
  newVolume: string;
}
