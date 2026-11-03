import type { MonthlyReportDto, ProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert, Badge, Section } from '@/components/ui';
import { formatDate } from '@/lib/project-fields';
import { WEEKLY_STATUS_BADGE } from '@/lib/rab-ui';
import { serverGet } from '@/lib/server-api';
import { ReportBody } from '../report/weekly-report';
import { WeekNav } from '../week-nav';

/** D-087: monthly report B.n of the week's period, read-only and built from its weeks. */
export default async function MonthlyReportPage({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const period = Math.ceil(Number(weekNumber) / 4);
  if (!Number.isInteger(period) || period < 1) notFound();
  const [{ status, data: project }, report] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<MonthlyReportDto>(`${base}/monthly-reports/${period}`),
  ]);
  if (status === 404 || report.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const c = report.data?.content;
  const allFinal = report.data?.weeks.every((w) => w.status === 'FINAL');

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      <WeekNav project={project} weekNumber={weekNumber} active="monthly" />
      {report.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat laporan.</Alert>
      ) : !report.data || !c ? (
        <Alert>Laporan bulanan tidak dapat dimuat.</Alert>
      ) : (
        <div className="mt-3 space-y-4">
          <Section
            title={
              <>
                Laporan bulanan B.{period}{' '}
                {allFinal ? (
                  <Badge tone="green">Semua minggu final</Badge>
                ) : (
                  <Badge>Sementara</Badge>
                )}
              </>
            }
            description={`${formatDate(c.week.startDate)} – ${formatDate(c.week.endDate)} · Baseline ${c.baseline?.label ?? 'belum ada'}`}
            action={
              <div className="row-actions">
                <Link
                  className="btn btn-secondary"
                  href={`/print${base}/monthly/${period}`}
                  target="_blank"
                  prefetch={false}
                >
                  Ekspor PDF
                </Link>
                <a className="btn btn-secondary" href={`/api${base}/exports/monthly/${period}`}>
                  Ekspor Excel
                </a>
              </div>
            }
          >
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Dirangkum otomatis dari minggu-minggu berikut, jadi tidak perlu diisi atau diajukan.
                Angkanya tetap setelah semua minggunya final.
              </p>
              <ul className="flex flex-wrap gap-2">
                {report.data.weeks.map((w) => (
                  <li key={w.weekNumber}>
                    <Link
                      className="day-chip"
                      href={`${base}/progress/${w.weekNumber}/report`}
                      title={`${formatDate(w.startDate)} – ${formatDate(w.endDate)}`}
                    >
                      <b>M.{w.weekNumber}</b>
                      {w.status ? (
                        <Badge tone={WEEKLY_STATUS_BADGE[w.status].tone}>
                          {WEEKLY_STATUS_BADGE[w.status].label}
                        </Badge>
                      ) : (
                        <span>{w.ended ? 'belum diajukan' : 'berjalan / belum mulai'}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
          <ReportBody projectId={project.id} content={c} code="B" />
        </div>
      )}
    </>
  );
}
