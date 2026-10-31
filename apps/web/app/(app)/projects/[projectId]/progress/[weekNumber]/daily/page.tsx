import type { DailyAllocationDto, ProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icon';
import { serverGet } from '@/lib/server-api';
import { DailyEditor } from './daily-editor';

export default async function DailyAllocationPage({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, daily] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<DailyAllocationDto>(`${base}/progress/weeks/${encodeURIComponent(weekNumber)}/daily`),
  ]);
  if (status === 404 || daily.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      <Link className="page-back mt-4" href={`${base}/progress/${encodeURIComponent(weekNumber)}`}>
        <Icon name="arrow-left" size={14} />
        Progres minggu {weekNumber}
      </Link>
      {daily.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat progres.</Alert>
      ) : !daily.data ? (
        <Alert>Alokasi harian minggu ini tidak dapat dimuat.</Alert>
      ) : (
        <DailyEditor
          projectId={project.id}
          initial={daily.data}
          canInput={project.permissions.includes('progress.input')}
        />
      )}
    </>
  );
}
