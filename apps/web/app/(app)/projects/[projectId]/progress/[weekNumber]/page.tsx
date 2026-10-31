import type { DailyReportDayDto, ProjectDto, WeeklyProgressDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icon';
import { serverGet } from '@/lib/server-api';
import { DayStrip } from './day-strip';
import { ProgressEditor } from './progress-editor';

export default async function WeekProgressPage({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, progress, days] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<WeeklyProgressDto>(`${base}/progress/weeks/${encodeURIComponent(weekNumber)}`),
    serverGet<DailyReportDayDto[]>(`${base}/daily-reports/weeks/${encodeURIComponent(weekNumber)}`),
  ]);
  if (status === 404 || progress.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      <Link className="page-back mt-4" href={`${base}/progress`}>
        <Icon name="arrow-left" size={14} />
        Semua minggu
      </Link>
      {days.data && <DayStrip projectId={project.id} days={days.data} />}
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
