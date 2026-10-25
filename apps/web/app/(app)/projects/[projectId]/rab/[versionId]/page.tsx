import type { ProjectDto, RabVersionDetailDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, PageTitle } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { RabEditor } from './rab-editor';

export default async function RabVersionPage({ params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  const { projectId, versionId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, detail] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<RabVersionDetailDto>(`${base}/rab-versions/${encodeURIComponent(versionId)}`),
  ]);
  if (status === 404 || detail.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="rab" permissions={project.permissions} />
      <Link href={`${base}/rab`} className="mb-4 inline-block text-sm text-slate-600 hover:text-slate-900">
        ← Versi RAB
      </Link>
      {detail.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat RAB.</Alert>
      ) : !detail.data ? (
        <Alert>Versi RAB tidak dapat dimuat.</Alert>
      ) : (
        <RabEditor
          projectId={project.id}
          initial={detail.data}
          canEdit={project.permissions.includes('rab.edit') && project.status === 'ACTIVE'}
          canApprove={project.permissions.includes('rab.approve') && project.status === 'ACTIVE'}
        />
      )}
    </>
  );
}
