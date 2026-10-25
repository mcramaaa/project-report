import type { ProjectDto, RabImportDetailDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, PageTitle } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ImportReview } from './import-review';

export default async function ImportReviewPage({ params }: { params: Promise<{ projectId: string; importId: string }> }) {
  const { projectId, importId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, detail] = await Promise.all([serverGet<ProjectDto>(base), serverGet<RabImportDetailDto>(`${base}/rab-imports/${encodeURIComponent(importId)}`)]);
  if (status === 404 || detail.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="imports" permissions={project.permissions} />
      <Link href={`${base}/imports`} className="mb-4 inline-block text-sm text-slate-600 hover:text-slate-900">
        ← Impor RAB
      </Link>
      {detail.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat impor.</Alert>
      ) : !detail.data ? (
        <Alert>Impor tidak dapat dimuat.</Alert>
      ) : (
        <ImportReview
          projectId={project.id}
          initial={detail.data}
          canReview={project.permissions.includes('rabImport.review')}
          canApprove={project.permissions.includes('rabImport.approve')}
        />
      )}
    </>
  );
}
