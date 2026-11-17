import type { DocumentDto, ProjectDto, RabProfileDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ProfilePlayground } from './profile-playground';

export default async function RabProfilesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const { status, data: project } = await serverGet<ProjectDto>(base);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const can = (p: string) => project.permissions.includes(p);
  if (!can('rabImport.review') || !can('document.read')) {
    return (
      <>
        <ProjectHeader project={project} active="imports" />
        <Alert>Profil pemetaan hanya untuk reviewer impor RAB.</Alert>
      </>
    );
  }
  const [documents, profiles] = await Promise.all([
    serverGet<DocumentDto[]>(`${base}/documents`),
    serverGet<RabProfileDto[]>(`${base}/rab-profiles`),
  ]);

  return (
    <>
      <ProjectHeader project={project} active="imports" />
      <Link href={`${base}/imports`} className="page-back">
        Impor RAB
      </Link>
      {documents.data && profiles.data ? (
        <ProfilePlayground
          projectId={project.id}
          closed={project.status === 'CLOSED'}
          canApprove={can('rabImport.approve')}
          documents={documents.data}
          initialProfiles={profiles.data}
        />
      ) : (
        <Alert>Dokumen atau profil pemetaan tidak dapat dimuat.</Alert>
      )}
    </>
  );
}
