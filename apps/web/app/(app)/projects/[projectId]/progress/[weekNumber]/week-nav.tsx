import { projectWeeks } from '@laporan-proyek/calc';
import Link from 'next/link';
import { Icon } from '@/components/icon';
import { WeekJump } from './week-jump';

type WeekPage = 'progress' | 'daily' | 'report' | 'monthly';

const PAGES: { key: WeekPage; label: string; path: string }[] = [
  { key: 'progress', label: 'Isi progres', path: '' },
  { key: 'daily', label: 'Laporan harian', path: '/daily' },
  { key: 'report', label: 'Laporan mingguan', path: '/report' },
  { key: 'monthly', label: 'Laporan bulanan', path: '/monthly' },
];

/** Same "today" as the API (D-073: WIT, UTC+9); a server component renders per request, so it stays current. */
const todayWit = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** One header for a week's pages: back to the list, the page tabs, and week paging (same tab) with a jump list. */
export function WeekNav({
  project,
  weekNumber,
  active,
}: {
  project: { id: string; startDate: string; durationDays: number };
  weekNumber: string;
  active: WeekPage;
}) {
  const base = `/projects/${encodeURIComponent(project.id)}/progress`;
  const n = Number(weekNumber);
  const path = PAGES.find((p) => p.key === active)!.path;
  const weeks = projectWeeks(project.startDate, project.durationDays);
  const last = weeks.length;
  const today = todayWit();
  const now = weeks.find((w) => w.startDate <= today && today <= w.endDate)?.weekNumber;
  const step = (to: number, label: string, title: string) =>
    to >= 1 && to <= last && to !== n ? (
      <Link
        className="btn btn-secondary"
        href={`${base}/${to}${path}`}
        title={title}
        aria-label={title}
      >
        {label}
      </Link>
    ) : (
      <span className="btn btn-secondary" aria-disabled="true" title={title}>
        {label}
      </span>
    );
  return (
    <div className="week-nav mt-4">
      <Link className="page-back" href={base}>
        <Icon name="arrow-left" size={14} />
        Semua minggu
      </Link>
      <div className="week-nav-top">
        <nav className="access-tabs" aria-label={`Halaman minggu ${weekNumber}`}>
          {PAGES.map((p) => (
            <Link
              key={p.key}
              href={`${base}/${encodeURIComponent(weekNumber)}${p.path}`}
              aria-current={p.key === active ? 'page' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <div className="week-nav-step" role="group" aria-label="Pindah minggu">
          {step(1, '« M.1', 'Minggu pertama')}
          {step(n - 1, '‹', `Minggu sebelumnya (M.${n - 1})`)}
          <WeekJump weeks={weeks} current={n} now={now} hrefOf={`${base}/{n}${path}`} />
          {step(n + 1, '›', `Minggu berikutnya (M.${n + 1})`)}
          {step(last, `M.${last} »`, 'Minggu terakhir')}
        </div>
      </div>
    </div>
  );
}
