import { Decimal } from '@laporan-proyek/calc';
import type { WeeklyReportContent } from '@laporan-proyek/shared';

const d = (x: string | null | undefined) => new Decimal(x ?? 0);

/**
 * D-087: period B.n from the reports of its weeks (in order). "This week" fields become "this period" (sum of the
 * weeks); cumulative values come from the last week. Group recap and totals use the last week's curve, which holds
 * every week's actual against the baseline in force at the end of the period (D-076); items pair by work item, so a
 * baseline change inside the period still adds up.
 */
export function mergePeriod(n: number, weeks: WeeklyReportContent[]): WeeklyReportContent {
  const first = weeks[0]!;
  const last = weeks.at(-1)!;
  const from = first.week.weekNumber - 1;
  const to = last.week.weekNumber;
  const span = <T>(xs: T[]) => xs.slice(from, to);
  const sum = (xs: (string | null | undefined)[]) => xs.reduce((t, x) => t.plus(x ?? 0), new Decimal(0));

  const recap = last.curve.rows.map((r) => {
    if (r.weight === null) return { id: r.id, displayNumber: r.displayNumber, description: r.description, weight: null, previous: null, thisWeek: null, cumulative: null };
    const previous = sum(r.actual.slice(0, from));
    const period = sum(span(r.actual));
    return { id: r.id, displayNumber: r.displayNumber, description: r.description, weight: r.weight, previous: previous.toFixed(), thisWeek: period.toFixed(), cumulative: previous.plus(period).toFixed() };
  });
  const curveWeeks = span(last.curve.weeks);
  const planned = curveWeeks.some((w) => w.planned === null) ? null : sum(curveWeeks.map((w) => w.planned)).toFixed();

  // Period volume per work item = sum of its weekly volumes; the latest entry carries who changed it.
  const moved = new Map<string, { volume: Decimal; entry: NonNullable<WeeklyReportContent['items'][number]['thisWeek']> }>();
  for (const w of weeks)
    for (const r of w.items) {
      if (!r.workItemId || !r.thisWeek) continue;
      const m = moved.get(r.workItemId);
      moved.set(r.workItemId, { volume: (m?.volume ?? new Decimal(0)).plus(r.thisWeek.volume), entry: r.thisWeek });
    }
  const items = last.items.map((r) => {
    const m = r.workItemId ? moved.get(r.workItemId) : undefined;
    if (!r.workItemId) return r;
    return {
      ...r,
      previousCumulative: d(r.cumulative).minus(m?.volume ?? 0).toFixed(),
      thisWeek: m ? { ...m.entry, volume: m.volume.toFixed(), mode: 'VOLUME_WEEK' as const, percentage: null } : null,
    };
  });

  const norm = (s: string | null) => (s ?? '').trim().toLowerCase();
  const weather = new Map<string, number>();
  for (const w of weeks) for (const x of w.daily.weather) weather.set(x.condition, (weather.get(x.condition) ?? 0) + x.days);

  return {
    ...last,
    week: { weekNumber: n, startDate: first.week.startDate, endDate: last.week.endDate },
    recap,
    totals: {
      ...last.totals,
      actualThisWeek: sum(curveWeeks.map((w) => w.actual)).toFixed(),
      plannedThisWeek: planned,
    },
    items,
    daily: {
      days: weeks.flatMap((w) => w.daily.days),
      labor: addUp(weeks.flatMap((w) => w.daily.labor), (l) => `${norm(l.name)}|${norm(l.unit)}`).sort((a, b) => a.name.localeCompare(b.name, 'id')),
      resources: addUp(weeks.flatMap((w) => w.daily.resources), (l) => `${l.category}|${norm(l.name)}|${norm(l.unit)}`).sort(
        (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'id'),
      ),
      weather: [...weather].map(([condition, days]) => ({ condition, days })) as WeeklyReportContent['daily']['weather'],
      rainDays: weeks.reduce((t, w) => t + w.daily.rainDays, 0),
    },
  };
}

/** Lines with the same key summed (people per skill, materials per name and unit). */
function addUp<T extends { total: string }>(lines: T[], key: (l: T) => string): T[] {
  const out = new Map<string, T>();
  for (const l of lines) {
    const cur = out.get(key(l));
    out.set(key(l), cur ? { ...cur, total: d(cur.total).plus(l.total).toFixed() } : l);
  }
  return [...out.values()];
}
