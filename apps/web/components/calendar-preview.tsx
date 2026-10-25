import { isValidIsoDate, plannedFinishDate, projectWeeks, reportPeriods } from '@laporan-proyek/calc';
import { PROJECT_DURATION_MAX_DAYS } from '@laporan-proyek/shared';
import { formatDate } from '@/lib/project-fields';

/** Same calculation as the backend (packages/calc), shown before saving. */
export function CalendarPreview({ startDate = '', durationDays = '' }: { startDate?: string; durationDays?: string }) {
  const duration = Number(durationDays);
  if (!isValidIsoDate(startDate) || !Number.isInteger(duration) || duration < 1 || duration > PROJECT_DURATION_MAX_DAYS) {
    return <p className="text-sm text-slate-500">Isi tanggal mulai dan masa pelaksanaan untuk melihat pratinjau jadwal.</p>;
  }
  const weeks = projectWeeks(startDate, duration);
  const periods = reportPeriods(startDate, duration);
  const lastWeek = weeks.at(-1)!;
  const lastPeriod = periods.at(-1)!;
  return (
    <dl className="calendar-preview" aria-live="polite">
      <div>
        <dt>Tanggal selesai rencana</dt>
        <dd>{formatDate(plannedFinishDate(startDate, duration))}</dd>
      </div>
      <div>
        <dt>Minggu proyek</dt>
        <dd>
          {weeks.length} minggu{lastWeek.days < 7 && ` (M${lastWeek.weekNumber}: ${lastWeek.days} hari)`}
        </dd>
      </div>
      <div>
        <dt>Periode 4 minggu</dt>
        <dd>
          {periods.length} periode{lastPeriod.days < 28 && ` (B${lastPeriod.periodNumber}: ${lastPeriod.days} hari)`}
        </dd>
      </div>
    </dl>
  );
}
