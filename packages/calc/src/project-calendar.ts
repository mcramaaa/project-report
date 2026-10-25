// Project calendar (D-036, D-037). Dates are calendar dates 'YYYY-MM-DD'; UTC day arithmetic avoids timezone shifts.

export const WEEK_DAYS = 7;
export const WEEKS_PER_PERIOD = 4;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDay(date: string): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Tanggal tidak valid: ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(y, m - 1, d);
  if (fromDay(time / DAY_MS) !== date) throw new RangeError(`Tanggal tidak valid: ${date}`);
  return time / DAY_MS;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function assertDuration(durationDays: number): void {
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new RangeError(`Durasi harus bilangan bulat ≥ 1: ${durationDays}`);
}

export function isValidIsoDate(date: string): boolean {
  try {
    toDay(date);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  return fromDay(toDay(date) + days);
}

/** Number of calendar days from start to end, both included. */
export function daysInclusive(startDate: string, endDate: string): number {
  return toDay(endDate) - toDay(startDate) + 1;
}

/** Inclusive: the start date is day 1, so finish = start + duration − 1. */
export function plannedFinishDate(startDate: string, durationDays: number): string {
  assertDuration(durationDays);
  return addDays(startDate, durationDays - 1);
}

export interface CalendarWeek {
  weekNumber: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  days: number;
}

export interface CalendarPeriod {
  periodNumber: number;
  startDate: string;
  endDate: string;
  firstWeekNumber: number;
  lastWeekNumber: number;
  days: number;
}

/** 7-day blocks from the start date; the last week ends on the planned finish date. */
export function projectWeeks(startDate: string, durationDays: number): CalendarWeek[] {
  assertDuration(durationDays);
  const start = toDay(startDate);
  const weeks: CalendarWeek[] = [];
  for (let offset = 0, n = 1; offset < durationDays; offset += WEEK_DAYS, n++) {
    const days = Math.min(WEEK_DAYS, durationDays - offset);
    weeks.push({
      weekNumber: n,
      periodNumber: Math.ceil(n / WEEKS_PER_PERIOD),
      startDate: fromDay(start + offset),
      endDate: fromDay(start + offset + days - 1),
      days,
    });
  }
  return weeks;
}

/** 4-week blocks (B.n = weeks 4n−3..4n); the last period ends on the planned finish date. */
export function reportPeriods(startDate: string, durationDays: number): CalendarPeriod[] {
  const periods: CalendarPeriod[] = [];
  for (const week of projectWeeks(startDate, durationDays)) {
    const current = periods[week.periodNumber - 1];
    if (current) {
      current.endDate = week.endDate;
      current.lastWeekNumber = week.weekNumber;
      current.days += week.days;
    } else {
      periods.push({
        periodNumber: week.periodNumber,
        startDate: week.startDate,
        endDate: week.endDate,
        firstWeekNumber: week.weekNumber,
        lastWeekNumber: week.weekNumber,
        days: week.days,
      });
    }
  }
  return periods;
}
