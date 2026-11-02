import type { DocumentDto, ProjectDto, ScheduleDetailDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ScheduleEditor } from './schedule-editor';

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ projectId: string; scheduleId: string }>;
}) {
  const { projectId, scheduleId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, schedule] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<ScheduleDetailDto>(`${base}/schedules/${encodeURIComponent(scheduleId)}`),
  ]);
  if (status === 404 || schedule.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const active = project.status === 'ACTIVE';
  const canEdit = active && project.permissions.includes('schedule.edit');
  const documents =
    canEdit && project.permissions.includes('document.read')
      ? (await serverGet<DocumentDto[]>(`${base}/documents`)).data
      : undefined;

  return (
    <>
      <ProjectHeader project={project} active="schedule" />
      {schedule.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat jadwal.</Alert>
      ) : !schedule.data ? (
        <Alert>Jadwal tidak dapat dimuat.</Alert>
      ) : (
        <ScheduleEditor
          projectId={project.id}
          initial={schedule.data}
          canEdit={canEdit}
          canApprove={active && project.permissions.includes('schedule.approve')}
          documents={
            documents?.filter((d) => d.originalFilename.toLowerCase().endsWith('.xlsx')) ?? []
          }
        />
      )}
    </>
  );
}
