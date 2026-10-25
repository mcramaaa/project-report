import type { DocumentDto, ProjectDto, RabImportSummaryDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, PageTitle } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ImportsManager } from './imports-manager';

export default async function ImportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const { status, data: project } = await serverGet<ProjectDto>(base);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const can = (p: string) => project.permissions.includes(p);
  const [documents, imports] = await Promise.all([
    can('document.read') ? serverGet<DocumentDto[]>(`${base}/documents`) : Promise.resolve({ status: 403, data: undefined }),
    can('rabImport.review') || can('rabImport.approve') ? serverGet<RabImportSummaryDto[]>(`${base}/rab-imports`) : Promise.resolve({ status: 403, data: undefined }),
  ]);

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="imports" permissions={project.permissions} />
      <ImportsManager
        projectId={project.id}
        closed={project.status === 'CLOSED'}
        documents={documents.data ?? null}
        imports={imports.data ?? null}
        canUpload={can('document.upload')}
        canReview={can('rabImport.review')}
      />
    </>
  );
}
