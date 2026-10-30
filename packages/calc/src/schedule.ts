import { Decimal } from './decimal.js';
import type { RabRowType } from './rab.js';

// Time schedule math (D-072): % of project weight per RAB group per project week.
const D = Decimal;
/** Percentage points; absorbs the 15-digit decimals copied from the office workbook. */
export const SCHEDULE_TOLERANCE = '0.0001';

export interface ScheduleGroup {
  id: string;
  /** Display number and description, for messages. */
  label: string;
  /** Group weight in % of the RAB total (D-043). */
  weight: string;
}

export interface ScheduleEntryInput {
  groupId: string;
  weekNumber: number;
  weight: string;
}

export interface ScheduleIssue {
  groupId: string | null;
  message: string;
}

/** Schedule groups: SUBSECTION rows, and SECTION rows that have no SUBSECTION (the REKAP RAB rows). */
export function scheduleGroupIds(rows: { id: string; parentId: string | null; rowType: RabRowType }[]): Set<string> {
  const withSubsections = new Set(rows.filter((r) => r.rowType === 'SUBSECTION' && r.parentId).map((r) => r.parentId!));
  return new Set(rows.filter((r) => r.rowType === 'SUBSECTION' || (r.rowType === 'SECTION' && !withSubsections.has(r.id))).map((r) => r.id));
}

/** Approval checks of D-072 butir 5; an empty list means the schedule can be approved. */
export function validateSchedule(groups: ScheduleGroup[], entries: ScheduleEntryInput[], weekCount: number): ScheduleIssue[] {
  const tolerance = new D(SCHEDULE_TOLERANCE);
  const issues: ScheduleIssue[] = [];
  const sums = new Map(groups.map((g) => [g.id, new D(0)]));
  for (const e of entries) {
    const sum = sums.get(e.groupId);
    if (!sum) issues.push({ groupId: e.groupId, message: 'Isian merujuk baris yang bukan kelompok jadwal.' });
    else if (new D(e.weight).isNegative()) issues.push({ groupId: e.groupId, message: `Isian minggu ${e.weekNumber} negatif.` });
    else if (!Number.isInteger(e.weekNumber) || e.weekNumber < 1 || e.weekNumber > weekCount)
      issues.push({ groupId: e.groupId, message: `Minggu ${e.weekNumber} di luar masa proyek (1–${weekCount}).` });
    else sums.set(e.groupId, sum.plus(e.weight));
  }
  for (const g of groups) {
    const sum = sums.get(g.id)!;
    if (sum.minus(g.weight).abs().gt(tolerance))
      issues.push({ groupId: g.id, message: `${g.label}: jumlah rencana ${sum.toFixed(6)}% tidak sama dengan bobot ${new D(g.weight).toFixed(6)}%.` });
  }
  const total = groups.reduce((t, g) => t.plus(g.weight), new D(0));
  if (groups.length && total.minus(100).abs().gt(tolerance))
    issues.push({ groupId: null, message: `Jumlah bobot kelompok ${total.toFixed(6)}%, bukan 100%: ada item RAB di luar kelompok jadwal.` });
  return issues;
}

/** Planned weekly and cumulative % for weeks 1..weekCount (Kurva S rencana). */
export function plannedCurve(entries: Pick<ScheduleEntryInput, 'weekNumber' | 'weight'>[], weekCount: number): { weekNumber: number; planned: string; cumulative: string }[] {
  const perWeek = Array.from({ length: weekCount }, () => new D(0));
  for (const e of entries) if (e.weekNumber >= 1 && e.weekNumber <= weekCount) perWeek[e.weekNumber - 1] = perWeek[e.weekNumber - 1]!.plus(e.weight);
  let cumulative = new D(0);
  return perWeek.map((planned, i) => {
    cumulative = cumulative.plus(planned);
    return { weekNumber: i + 1, planned: planned.toFixed(), cumulative: cumulative.toFixed() };
  });
}

/**
 * D-074: imported weeks keep their spread but each group is scaled to its weight in this RAB version
 * (× weight ÷ sum, HALF_UP 18 decimals). Groups already within tolerance, or with no entries, are left as they are.
 */
export function scaleScheduleToWeights(
  groups: Pick<ScheduleGroup, 'id' | 'weight'>[],
  entries: ScheduleEntryInput[],
): { entries: ScheduleEntryInput[]; adjusted: { groupId: string; from: string; to: string }[] } {
  const tolerance = new D(SCHEDULE_TOLERANCE);
  const sums = new Map<string, Decimal>();
  for (const e of entries) sums.set(e.groupId, (sums.get(e.groupId) ?? new D(0)).plus(e.weight));
  const factors = new Map<string, Decimal>();
  const adjusted: { groupId: string; from: string; to: string }[] = [];
  for (const g of groups) {
    const sum = sums.get(g.id);
    if (!sum || sum.isZero() || sum.minus(g.weight).abs().lte(tolerance)) continue;
    factors.set(g.id, new D(g.weight).div(sum));
    adjusted.push({ groupId: g.id, from: sum.toFixed(), to: new D(g.weight).toFixed() });
  }
  return {
    entries: entries.map((e) => {
      const f = factors.get(e.groupId);
      return f ? { ...e, weight: new D(e.weight).times(f).toDecimalPlaces(18, D.ROUND_HALF_UP).toFixed() } : e;
    }),
    adjusted,
  };
}
