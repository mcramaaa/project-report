import type { ProjectDto, WeeklyProgressDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ProgressEditor } from './progress-editor';
import { WeekNav } from './week-nav';

export default async function WeekProgressPage({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, progress] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<WeeklyProgressDto>(`${base}/progress/weeks/${encodeURIComponent(weekNumber)}`),
  ]);
  if (status === 404 || progress.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      <WeekNav project={project} weekNumber={weekNumber} active="progress" />
      {progress.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat progres.</Alert>
      ) : !progress.data ? (
        <Alert>Progres minggu ini tidak dapat dimuat.</Alert>
      ) : (
        <ProgressEditor
          projectId={project.id}
          initial={progress.data}
          canInput={project.permissions.includes('progress.input')}
        />
      )}
    </>
  );
}
