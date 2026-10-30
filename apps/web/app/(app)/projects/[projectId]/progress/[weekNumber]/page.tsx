import type { ProjectDto, WeeklyProgressDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, PageTitle } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ProgressEditor } from './progress-editor';

export default async function WeekProgressPage({ params }: { params: Promise<{ projectId: string; weekNumber: string }> }) {
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
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="progress" permissions={project.permissions} />
      <p className="mt-3 text-sm">
        <Link className="link-button" href={`${base}/progress`}>
          ← Semua minggu
        </Link>
      </p>
      {progress.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat progres.</Alert>
      ) : !progress.data ? (
        <Alert>Progres minggu ini tidak dapat dimuat.</Alert>
      ) : (
        <ProgressEditor projectId={project.id} initial={progress.data} canInput={project.permissions.includes('progress.input')} />
      )}
    </>
  );
}
