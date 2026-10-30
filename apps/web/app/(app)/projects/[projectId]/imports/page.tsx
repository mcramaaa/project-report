import type { DocumentDto, ProjectDto, RabImportSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
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
      <ProjectHeader project={project} active="imports" />
      {project.permissions.includes('rab.read') && (
        <Link href={`${base}/rab`} className="page-back">
          Versi RAB
        </Link>
      )}
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
