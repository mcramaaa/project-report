import type { ProgressWeekSummaryDto, ProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, Badge, PageTitle } from '@/components/ui';
import { formatDate } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

export default async function ProgressWeeksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, weeks] = await Promise.all([serverGet<ProjectDto>(base), serverGet<ProgressWeekSummaryDto[]>(`${base}/progress/weeks`)]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  // The latest started week is the one users fill most.
  const current = weeks.data?.filter((w) => w.open).at(-1)?.weekNumber;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="progress" permissions={project.permissions} />
      {weeks.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat progres.</Alert>
      ) : !weeks.data ? (
        <Alert>Daftar minggu tidak dapat dimuat.</Alert>
      ) : (
        <div className="panel data-panel mt-4">
          <table role="table" className="data-table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Minggu</th>
                <th role="columnheader" scope="col">Tanggal</th>
                <th role="columnheader" scope="col">Baseline</th>
                <th role="columnheader" scope="col">Item terisi</th>
                <th role="columnheader" scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {weeks.data.map((w) => (
                <tr role="row" key={w.weekNumber}>
                  <td role="cell" data-label="Minggu" className="font-medium">
                    M.{w.weekNumber} {w.weekNumber === current && <Badge tone="blue">minggu berjalan</Badge>}
                  </td>
                  <td role="cell" data-label="Tanggal">
                    {formatDate(w.startDate)} – {formatDate(w.endDate)}
                  </td>
                  <td role="cell" data-label="Baseline">
                    {w.baseline?.label ?? <span className="text-slate-500">Belum ada</span>}
                  </td>
                  <td role="cell" data-label="Item terisi" className="tabular-nums">
                    {w.filledCount}
                  </td>
                  <td role="cell" data-label="Aksi">
                    {w.open || w.filledCount > 0 ? (
                      <Link className="btn btn-secondary" href={`${base}/progress/${w.weekNumber}`}>
                        {w.open && w.baseline && project.permissions.includes('progress.input') ? 'Isi' : 'Lihat'}
                      </Link>
                    ) : (
                      <span className="text-slate-500">Belum dimulai</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
