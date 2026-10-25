import { describe, expect, it } from 'vitest';
import { addDays, daysInclusive, isValidIsoDate, plannedFinishDate, projectWeeks, reportPeriods } from './index.js';

describe('plannedFinishDate (inclusive)', () => {
  it.each([
    ['2026-05-26', 1, '2026-05-26'],
    ['2026-05-26', 7, '2026-06-01'],
    ['2026-05-26', 8, '2026-06-02'],
    ['2026-01-31', 1, '2026-01-31'],
    ['2026-12-25', 10, '2027-01-03'],
    ['2028-02-28', 2, '2028-02-29'],
    ['2027-02-28', 2, '2027-03-01'],
    ['2026-01-05', 120, '2026-05-04'],
  ])('%s + %i days -> %s', (start, duration, finish) => {
    expect(plannedFinishDate(start, duration)).toBe(finish);
  });

  it('rejects invalid durations and dates', () => {
    expect(() => plannedFinishDate('2026-05-26', 0)).toThrow(RangeError);
    expect(() => plannedFinishDate('2026-05-26', 1.5)).toThrow(RangeError);
    expect(() => plannedFinishDate('2026-02-30', 1)).toThrow(RangeError);
    expect(() => plannedFinishDate('2027-02-29', 1)).toThrow(RangeError);
    expect(() => plannedFinishDate('26-05-2026', 1)).toThrow(RangeError);
  });
});

describe('isValidIsoDate / addDays', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-1-01')).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInclusive('2028-02-28', '2028-03-01')).toBe(3);
    expect(daysInclusive('2026-05-26', '2026-05-26')).toBe(1);
  });
});

describe('projectWeeks', () => {
  it('matches the PRD §12 example', () => {
    expect(projectWeeks('2026-05-26', 21)).toEqual([
      { weekNumber: 1, periodNumber: 1, startDate: '2026-05-26', endDate: '2026-06-01', days: 7 },
      { weekNumber: 2, periodNumber: 1, startDate: '2026-06-02', endDate: '2026-06-08', days: 7 },
      { weekNumber: 3, periodNumber: 1, startDate: '2026-06-09', endDate: '2026-06-15', days: 7 },
    ]);
  });

  it.each([
    [1, 1, 1],
    [7, 1, 7],
    [8, 2, 1],
    [28, 4, 7],
    [29, 5, 1],
  ])('duration %i -> %i weeks, last week %i days', (duration, count, lastDays) => {
    const weeks = projectWeeks('2026-05-26', duration);
    expect(weeks).toHaveLength(count);
    expect(weeks.at(-1)!.days).toBe(lastDays);
    expect(weeks.at(-1)!.endDate).toBe(plannedFinishDate('2026-05-26', duration));
    expect(weeks.reduce((sum, w) => sum + w.days, 0)).toBe(duration);
  });

  it('weeks are contiguous across a leap day and a year change', () => {
    const weeks = projectWeeks('2027-12-20', 80);
    for (let i = 1; i < weeks.length; i++) expect(weeks[i]!.startDate).toBe(addDays(weeks[i - 1]!.endDate, 1));
    expect(weeks.find((w) => w.startDate <= '2028-02-29' && w.endDate >= '2028-02-29')).toMatchObject({ weekNumber: 11, startDate: '2028-02-28', endDate: '2028-03-05' });
    expect(weeks.at(-1)).toMatchObject({ weekNumber: 12, startDate: '2028-03-06', endDate: '2028-03-08', days: 3 });
  });
});

describe('reportPeriods', () => {
  it.each([
    [1, [[1, 1, 1, 1]]],
    [7, [[1, 1, 1, 7]]],
    [8, [[1, 1, 2, 8]]],
    [28, [[1, 1, 4, 28]]],
    [29, [[1, 1, 4, 28], [2, 5, 5, 1]]],
  ])('duration %i', (duration, expected) => {
    expect(reportPeriods('2026-05-26', duration).map((p) => [p.periodNumber, p.firstWeekNumber, p.lastWeekNumber, p.days])).toEqual(expected);
  });

  it('B.n spans weeks 4n−3..4n and the last period is short and ends on the finish date', () => {
    const periods = reportPeriods('2026-05-26', 180);
    expect(periods).toHaveLength(7);
    expect(periods[1]).toEqual({ periodNumber: 2, startDate: '2026-06-23', endDate: '2026-07-20', firstWeekNumber: 5, lastWeekNumber: 8, days: 28 });
    expect(periods.at(-1)).toEqual({ periodNumber: 7, startDate: '2026-11-10', endDate: '2026-11-21', firstWeekNumber: 25, lastWeekNumber: 26, days: 12 });
    expect(periods.at(-1)!.endDate).toBe(plannedFinishDate('2026-05-26', 180));
  });

  it('crosses February of a leap year', () => {
    const [first, second] = reportPeriods('2028-02-01', 60);
    expect(first).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-28', days: 28 });
    expect(second).toMatchObject({ startDate: '2028-02-29', endDate: '2028-03-27', days: 28 });
  });
});
