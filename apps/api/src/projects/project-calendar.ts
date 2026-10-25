import { projectWeeks, reportPeriods } from '@laporan-proyek/calc';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { isForeignKeyViolation } from '../prisma/errors';

/** Calendar date 'YYYY-MM-DD' <-> Prisma @db.Date (stored as UTC midnight). */
export const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

export interface CalendarCounts {
  weeks: number;
  periods: number;
}

/**
 * Brings weeks and report periods in line with start date + duration (D-037, D-038).
 * Same number keeps its row id; trailing rows are deleted only while nothing references them
 * (RESTRICT foreign keys), otherwise the whole transaction is rolled back with 409.
 * Callers must hold the project row lock.
 */
export async function syncProjectCalendar(
  tx: Prisma.TransactionClient,
  projectId: string,
  startDate: string,
  durationDays: number,
): Promise<CalendarCounts> {
  const periods = reportPeriods(startDate, durationDays);
  const weeks = projectWeeks(startDate, durationDays);

  const periodIds = await syncRows(
    periods.map((p) => ({ number: p.periodNumber, startDate: p.startDate, endDate: p.endDate })),
    async () => (await tx.reportPeriod.findMany({ where: { projectId }, select: { id: true, periodNumber: true, startDate: true, endDate: true } })).map((r) => ({ ...r, number: r.periodNumber })),
    (id, row) => tx.reportPeriod.update({ where: { id }, data: { startDate: toDbDate(row.startDate), endDate: toDbDate(row.endDate) } }),
    (rows) => tx.reportPeriod.createMany({ data: rows.map((row) => ({ projectId, periodNumber: row.number, startDate: toDbDate(row.startDate), endDate: toDbDate(row.endDate) })) }),
  );

  await syncRows(
    weeks.map((w) => ({ number: w.weekNumber, startDate: w.startDate, endDate: w.endDate, reportPeriodId: periodIds.get(w.periodNumber)! })),
    async () =>
      (await tx.projectWeek.findMany({ where: { projectId }, select: { id: true, weekNumber: true, startDate: true, endDate: true, reportPeriodId: true } })).map((r) => ({
        ...r,
        number: r.weekNumber,
      })),
    (id, row) =>
      tx.projectWeek.update({ where: { id }, data: { startDate: toDbDate(row.startDate), endDate: toDbDate(row.endDate), reportPeriodId: row.reportPeriodId } }),
    (rows) =>
      tx.projectWeek.createMany({
        data: rows.map((row) => ({ projectId, weekNumber: row.number, reportPeriodId: row.reportPeriodId, startDate: toDbDate(row.startDate), endDate: toDbDate(row.endDate) })),
      }),
    (current, row) => current.reportPeriodId !== row.reportPeriodId,
  );

  try {
    await tx.projectWeek.deleteMany({ where: { projectId, weekNumber: { gt: weeks.length } } });
    await tx.reportPeriod.deleteMany({ where: { projectId, periodNumber: { gt: periods.length } } });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ConflictException('Minggu/periode di akhir jadwal sudah memiliki data terkait; durasi tidak dapat dipersingkat.');
    throw err;
  }
  return { weeks: weeks.length, periods: periods.length };
}

interface CalendarRow {
  number: number;
  startDate: string;
  endDate: string;
}

/** Updates rows whose dates changed, creates missing numbers, and returns number -> id. */
async function syncRows<T extends CalendarRow, C extends { id: string; number: number; startDate: Date; endDate: Date }>(
  target: T[],
  load: () => Promise<C[]>,
  update: (id: string, row: T) => Promise<unknown>,
  createMany: (rows: T[]) => Promise<unknown>,
  otherwiseChanged: (current: C, row: T) => boolean = () => false,
): Promise<Map<number, string>> {
  const existing = new Map((await load()).map((row) => [row.number, row]));
  const missing: T[] = [];
  for (const row of target) {
    const current = existing.get(row.number);
    if (!current) missing.push(row);
    else if (fromDbDate(current.startDate) !== row.startDate || fromDbDate(current.endDate) !== row.endDate || otherwiseChanged(current, row)) {
      await update(current.id, row);
    }
  }
  if (missing.length === 0) return new Map([...existing].map(([n, row]) => [n, row.id]));
  await createMany(missing);
  return new Map((await load()).map((row) => [row.number, row.id]));
}
