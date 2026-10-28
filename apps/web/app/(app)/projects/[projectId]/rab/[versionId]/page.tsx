import type { ProjectDto, RabVersionDetailDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { RabWorkspaceHead } from '@/components/rab-tabs';
import { Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { RabEditor } from './rab-editor';

export default async function RabVersionPage({
  params,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
}) {
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
      <RabWorkspaceHead
        project={project}
        versionId={versionId}
        version={detail.data?.version}
        active="recap"
      />
      {detail.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat RAB.</Alert>
      ) : !detail.data ? (
        <Alert>Versi RAB tidak dapat dimuat.</Alert>
      ) : (
        <RabEditor
          projectId={project.id}
          initial={detail.data}
          permissions={project.status === 'ACTIVE' ? project.permissions : []}
        />
      )}
    </>
  );
}
