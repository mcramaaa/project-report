import type {
  ProgressWeekSummaryDto,
  ProjectDto,
  WeeklyReportSummaryDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert, Badge, Section } from '@/components/ui';
import { formatDate } from '@/lib/project-fields';
import { WEEKLY_STATUS_BADGE } from '@/lib/rab-ui';
import { serverGet } from '@/lib/server-api';

export default async function ProgressWeeksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, weeks, reports] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<ProgressWeekSummaryDto[]>(`${base}/progress/weeks`),
    serverGet<WeeklyReportSummaryDto[]>(`${base}/weekly-reports`),
  ]);
  const report = new Map(reports.data?.map((r) => [r.weekNumber, r]));
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  // The latest started week is the one users fill most.
  const current = weeks.data?.filter((w) => w.open).at(-1)?.weekNumber;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      {weeks.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat progres.</Alert>
      ) : !weeks.data ? (
        <Alert>Daftar minggu tidak dapat dimuat.</Alert>
      ) : (
        <Section
          className="mt-4"
          title="Progres mingguan"
          description="Pilih minggu untuk mengisi progres, alokasi harian, dan laporan mingguan. Minggu dikelompokkan per periode bulanan B.n (4 minggu)."
          body={false}
          action={
            current && (
              <Link className="btn btn-primary" href={`${base}/progress/${current}`}>
                {project.permissions.includes('progress.input') ? 'Isi' : 'Lihat'} minggu berjalan
                (M.{current})
              </Link>
            )
          }
        >
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Minggu
                  </th>
                  <th role="columnheader" scope="col">
                    Progres
                  </th>
                  <th role="columnheader" scope="col">
                    Baseline
                  </th>
                  <th role="columnheader" scope="col">
                    Laporan mingguan
                  </th>
                  <th role="columnheader" scope="col">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {weeks.data.map((w, i, all) => (
                  <Fragment key={w.weekNumber}>
                    {/* D-037: period B.n = weeks 4n−3..4n. */}
                    {w.weekNumber % 4 === 1 && (
                      <tr role="row" className="period-row">
                        <th role="cell" scope="colgroup" colSpan={5}>
                          B{(w.weekNumber + 3) / 4} · {formatDate(w.startDate)} –{' '}
                          {formatDate(all[Math.min(i + 3, all.length - 1)]!.endDate)}
                        </th>
                      </tr>
                    )}
                    <tr role="row" className={w.weekNumber === current ? 'is-current' : undefined}>
                      <td role="cell" data-label="Minggu" className="font-medium">
                        M.{w.weekNumber}{' '}
                        {w.weekNumber === current && <Badge tone="blue">minggu berjalan</Badge>}
                        <span className="block text-xs font-normal text-slate-500">
                          {formatDate(w.startDate)} – {formatDate(w.endDate)}
                        </span>
                      </td>
                      <td role="cell" data-label="Progres">
                        <WeekState week={w} />
                      </td>
                      <td role="cell" data-label="Baseline">
                        {w.baseline?.label ?? <span className="text-slate-500">Belum ada</span>}
                      </td>
                      <td role="cell" data-label="Laporan mingguan">
                        <WeekReportCell
                          base={base}
                          week={w.weekNumber}
                          summary={report.get(w.weekNumber)}
                        />
                      </td>
                      <td role="cell" data-label="Aksi">
                        {w.open || w.locked || w.filledCount > 0 ? (
                          <Link
                            className="btn btn-secondary"
                            href={`${base}/progress/${w.weekNumber}`}
                          >
                            {w.open && w.baseline && project.permissions.includes('progress.input')
                              ? 'Isi'
                              : 'Lihat'}
                          </Link>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

/** One status per week, so the list answers "can I still fill this week?" at a glance. */
function WeekState({ week: w }: { week: ProgressWeekSummaryDto }) {
  const items = w.filledCount > 0 && (
    <span className="ml-1.5 text-xs text-slate-500 tabular-nums">{w.filledCount} item</span>
  );
  if (w.locked)
    return (
      <>
        <Badge tone="slate">Terkunci</Badge>
        {items}
      </>
    );
  if (!w.open)
    return w.filledCount > 0 ? (
      <>
        <Badge>Hanya lihat</Badge>
        {items}
      </>
    ) : (
      <span className="text-slate-500">Belum dimulai</span>
    );
  return (
    <>
      <Badge tone={w.filledCount > 0 ? 'green' : 'amber'}>
        {w.filledCount > 0 ? 'Terisi' : 'Belum diisi'}
      </Badge>
      {items}
    </>
  );
}

function WeekReportCell({
  base,
  week,
  summary,
}: {
  base: string;
  week: number;
  summary?: WeeklyReportSummaryDto;
}) {
  if (!summary?.ended) return <span className="text-slate-500">–</span>;
  return (
    <Link
      className="link-button inline-flex items-center gap-1.5"
      href={`${base}/progress/${week}/report`}
    >
      {summary.status ? (
        <Badge tone={WEEKLY_STATUS_BADGE[summary.status].tone}>
          {WEEKLY_STATUS_BADGE[summary.status].label}
        </Badge>
      ) : (
        <Badge>Belum diajukan</Badge>
      )}
    </Link>
  );
}
