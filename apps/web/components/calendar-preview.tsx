import { SourceValue } from './source-value';
import {
  isValidIsoDate,
  plannedFinishDate,
  projectWeeks,
  reportPeriods,
} from '@laporan-proyek/calc';
import { PROJECT_DURATION_MAX_DAYS } from '@laporan-proyek/shared';
import { formatDate } from '@/lib/project-fields';

/** Same calculation as the backend (packages/calc), shown before saving. */
export function CalendarPreview({
  startDate = '',
  durationDays = '',
}: {
  startDate?: string;
  durationDays?: string;
}) {
  const duration = Number(durationDays);
  if (
    !isValidIsoDate(startDate) ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > PROJECT_DURATION_MAX_DAYS
  ) {
    return (
      <p className="text-sm text-slate-500">
        Isi tanggal mulai dan masa pelaksanaan untuk melihat pratinjau jadwal.
      </p>
    );
  }
  const weeks = projectWeeks(startDate, duration);
  const periods = reportPeriods(startDate, duration);
  const lastWeek = weeks.at(-1)!;
  const lastPeriod = periods.at(-1)!;
  return (
    <dl className="calendar-preview" aria-live="polite">
      <div>
        <dt>Tanggal selesai rencana</dt>
        <dd>
          <SourceValue
            title="Pratinjau tanggal selesai"
            value={plannedFinishDate(startDate, duration)}
            formula="Tanggal mulai + masa pelaksanaan − 1 hari"
            sources={[
              { label: 'Tanggal mulai', value: startDate },
              { label: 'Masa pelaksanaan (hari)', value: durationDays },
            ]}
          >
            {formatDate(plannedFinishDate(startDate, duration))}
          </SourceValue>
        </dd>
      </div>
      <div>
        <dt>Minggu proyek</dt>
        <dd>
          <SourceValue
            title="Jumlah minggu"
            value={String(weeks.length)}
            formula="ceil(masa pelaksanaan ÷ 7)"
            sources={[{ label: 'Masa pelaksanaan (hari)', value: durationDays }]}
          >
            {weeks.length}
          </SourceValue>{' '}
          minggu{lastWeek.days < 7 && ` (M${lastWeek.weekNumber}: ${lastWeek.days} hari)`}
        </dd>
      </div>
      <div>
        <dt>Periode 4 minggu</dt>
        <dd>
          <SourceValue
            title="Jumlah periode"
            value={String(periods.length)}
            formula="ceil(jumlah minggu ÷ 4)"
            sources={[{ label: 'Jumlah minggu', value: String(weeks.length) }]}
          >
            {periods.length}
          </SourceValue>{' '}
          periode{lastPeriod.days < 28 && ` (B${lastPeriod.periodNumber}: ${lastPeriod.days} hari)`}
        </dd>
      </div>
    </dl>
  );
}
