import type { ProjectDto, RabImportSummaryDto, RabVersionDetailDto } from '@laporan-proyek/shared';
import type { ReactNode } from 'react';
import { RabAssistant } from '@/components/rab-assistant';
import { serverGet } from '@/lib/server-api';

/**
 * D-096: the floating assistant on every RAB page of this version. Shown only to reviewers, and only when the version came
 * from an import run; the API enforces the same rules on every call.
 */
export default async function RabVersionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string; versionId: string }>;
}) {
  const { projectId, versionId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const { data: project } = await serverGet<ProjectDto>(base);
  if (!project?.permissions.includes('rabImport.review')) return <>{children}</>;
  const [run, version] = await Promise.all([
    serverGet<{ run: RabImportSummaryDto | null }>(`${base}/rab-imports/by-version/${encodeURIComponent(versionId)}`),
    serverGet<RabVersionDetailDto>(`${base}/rab-versions/${encodeURIComponent(versionId)}`),
  ]);
  const importId = run.data?.run?.id;
  if (!importId || !version.data) return <>{children}</>;
  return (
    <>
      {children}
      <RabAssistant projectId={project.id} importId={importId} versionStatus={version.data.version.status} />
    </>
  );
}
