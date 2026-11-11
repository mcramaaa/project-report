import type { DailyReportDayDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { DAILY_STATUS_BADGE } from '@/lib/rab-ui';

/** D-079: the week's daily reports, one chip per project day. */
export function DayStrip({ projectId, days }: { projectId: string; days: DailyReportDayDto[] }) {
  return (
    <nav className="day-strip" aria-label="Laporan harian minggu ini">
      <span className="day-strip-label">Laporan harian</span>
      {days.map((d) => {
        const label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('id-ID', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          timeZone: 'UTC',
        });
        const status = d.status ? DAILY_STATUS_BADGE[d.status] : null;
        return d.open || d.status ? (
          <Link
            key={d.date}
            className={`day-chip ${status ? `day-chip-${status.tone}` : ''}`}
            href={`/projects/${projectId}/daily/${d.date}`}
          >
            <b>H{d.day}</b> {label}
            <span>{status?.label ?? 'belum'}</span>
          </Link>
        ) : (
          <span key={d.date} className="day-chip day-chip-off" title="Tanggal belum tiba">
            <b>H{d.day}</b> {label}
            <span>–</span>
          </span>
        );
      })}
    </nav>
  );
}
