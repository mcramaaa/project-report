import type { ProjectDto, ScheduleSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { SCHEDULE_STATUS_BADGE } from '@/lib/rab-ui';
import { serverGet } from '@/lib/server-api';
import { CreateSchedule } from './create-schedule';

export default async function SchedulesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, schedules] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<ScheduleSummaryDto[]>(`${base}/schedules`),
  ]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const canEdit = project.permissions.includes('schedule.edit') && project.status === 'ACTIVE';

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="schedule" permissions={project.permissions} />
      {schedules.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat jadwal.</Alert>
      ) : !schedules.data ? (
        <Alert>Jadwal tidak dapat dimuat.</Alert>
      ) : schedules.data.length === 0 ? (
        <div className="mt-4">
          <EmptyState>Belum ada versi RAB approved. Jadwal disusun per versi RAB approved.</EmptyState>
        </div>
      ) : (
        <div className="panel data-panel mt-4">
          <table role="table" className="data-table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Versi RAB</th>
                <th role="columnheader" scope="col">Jadwal</th>
                <th role="columnheader" scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {schedules.data.map(({ rabVersion, schedule }) => (
                <tr role="row" key={rabVersion.id}>
                  <td role="cell" data-label="Versi RAB" className="font-medium">
                    {rabVersion.label}
                  </td>
                  <td role="cell" data-label="Jadwal">
                    {schedule ? (
                      <Badge tone={SCHEDULE_STATUS_BADGE[schedule.status].tone}>{SCHEDULE_STATUS_BADGE[schedule.status].label}</Badge>
                    ) : (
                      'Belum dibuat'
                    )}
                  </td>
                  <td role="cell" data-label="Aksi">
                    {schedule ? (
                      <Link className="btn btn-secondary" href={`${base}/schedule/${schedule.id}`}>
                        Buka
                      </Link>
                    ) : canEdit ? (
                      <CreateSchedule projectId={project.id} rabVersionId={rabVersion.id} label={rabVersion.label} />
                    ) : (
                      '–'
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
