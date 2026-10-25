import { notFound, redirect } from 'next/navigation';

export default async function LegacyAnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; analysisId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const [{ projectId, analysisId }, { version }] = await Promise.all([params, searchParams]);
  if (!version) notFound();
  redirect(
    `/projects/${encodeURIComponent(projectId)}/rab/${encodeURIComponent(version)}/analyses/${encodeURIComponent(analysisId)}`,
  );
}
