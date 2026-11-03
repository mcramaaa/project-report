import { z } from 'zod';
import type { ProgressRowDto } from './progress.js';
import type { SCurveDto } from './schedules.js';
import type { WeatherCondition } from './daily-reports.js';

/** D-081 laporan mingguan. */
export const WEEKLY_REPORT_STATUSES = ['DRAFT', 'REVIEWED', 'FINAL', 'REOPENED'] as const;
export type WeeklyReportStatus = (typeof WEEKLY_REPORT_STATUSES)[number];

export const reviewWeeklyReportSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  acknowledgeWarnings: z.boolean().optional(),
});
export type ReviewWeeklyReportInput = z.infer<typeof reviewWeeklyReportSchema>;
export const finalizeWeeklyReportSchema = z.object({ acknowledgeWarnings: z.boolean().optional() });

export interface WeeklyReportSummaryDto {
  weekNumber: number;
  startDate: string;
  endDate: string;
  status: WeeklyReportStatus | null;
  /** The week has ended, so it can be submitted (D-081 butir 1). */
  ended: boolean;
}

/** Everything the report shows; frozen as the snapshot payload when FINAL (D-081 butir 4). */
export interface WeeklyReportContent {
  project: {
    code: string;
    activityName: string;
    subActivityName: string;
    projectName: string;
    location: string;
    fiscalYear: number;
    contractorName: string;
    consultantName: string;
    contractNumber: string;
    contractDate: string;
    spmkNumber: string;
    spmkDate: string;
    startDate: string;
    durationDays: number;
    plannedFinishDate: string;
  };
  week: { weekNumber: number; startDate: string; endDate: string };
  baseline: { label: string } | null;
  /** RM sheet: schedule groups (headings have weight null), % of project weight. */
  recap: {
    id: string;
    displayNumber: string | null;
    description: string;
    weight: string | null;
    previous: string | null;
    thisWeek: string | null;
    cumulative: string | null;
  }[];
  totals: {
    actualThisWeek: string;
    actualCumulative: string;
    plannedThisWeek: string | null;
    plannedCumulative: string | null;
    deviation: string | null;
    durationDays: number;
    usedDays: number;
    remainingDays: number;
  };
  /** Curva S sheet as of this week: later weeks keep the plan, their actual is null. */
  curve: SCurveDto;
  /** M sheet: item progress of the week. */
  items: ProgressRowDto[];
  /** Bobot (% of project value) per ITEM row id of the baseline; absent in snapshots made before it existed. */
  itemWeights?: Record<string, string>;
  daily: {
    days: { date: string; status: 'DRAFT' | 'FINAL' | 'REOPENED' | null }[];
    /** Orang-hari per keahlian. */
    labor: { name: string; unit: string | null; total: string }[];
    resources: { category: 'MATERIAL' | 'EQUIPMENT'; name: string; unit: string | null; total: string }[];
    weather: { condition: WeatherCondition; days: number }[];
    rainDays: number;
  };
}

export interface WeeklyReportDto {
  summary: WeeklyReportSummaryDto;
  report: {
    id: string;
    status: WeeklyReportStatus;
    submittedBy: { id: string; name: string };
    submittedAt: string;
    reviewedBy: { id: string; name: string } | null;
    reviewedAt: string | null;
    reviewNote: string | null;
    finalizedBy: { id: string; name: string } | null;
    finalizedAt: string | null;
    updatedAt: string;
  } | null;
  content: WeeklyReportContent;
  /** True when the content is the FINAL snapshot rather than live data. */
  fromSnapshot: boolean;
  /** Users who entered or changed this week's progress; they may not review it (D-081 butir 2). */
  enteredBy: { id: string; name: string }[];
  issues: { errors: string[]; warnings: string[] };
  /** Project ACTIVE (actions are possible at all). */
  active: boolean;
}

/**
 * D-087 laporan bulanan B.n = minggu 4n−3..4n (D-010); read-only, built from its weeks (no own input or approval).
 * `content.week` holds the period: weekNumber = n, dates of its first and last week; "thisWeek" fields mean this period.
 */
export interface MonthlyReportDto {
  periodNumber: number;
  /** The weeks of the period with their weekly report status. */
  weeks: WeeklyReportSummaryDto[];
  content: WeeklyReportContent;
}
