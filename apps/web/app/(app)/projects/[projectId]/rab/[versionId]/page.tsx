import type { ProjectDto, RabVersionDetailDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { RabBackLinks, RabTabs } from '@/components/rab-tabs';
import { Alert, PageTitle } from '@/components/ui';
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
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>
        {project.projectName}
      </PageTitle>
      <RabBackLinks projectId={project.id} permissions={project.permissions} />
      {detail.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat RAB.</Alert>
      ) : !detail.data ? (
        <Alert>Versi RAB tidak dapat dimuat.</Alert>
      ) : (
        <>
          <RabTabs
            projectId={project.id}
            versionId={versionId}
            active="recap"
            permissions={project.permissions}
          />
          <RabEditor
            projectId={project.id}
            initial={detail.data}
            permissions={project.status === 'ACTIVE' ? project.permissions : []}
          />
        </>
      )}
    </>
  );
}
