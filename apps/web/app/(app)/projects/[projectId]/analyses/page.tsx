import { redirect } from 'next/navigation';

/** Preserve saved links while keeping analysis navigation within a specific RAB. */
export default async function LegacyAnalysesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ version?: string; search?: string }>;
}) {
  const [{ projectId }, { version, search }] = await Promise.all([params, searchParams]);
  const base = `/projects/${encodeURIComponent(projectId)}/rab`;
  if (!version) redirect(base);
  redirect(
    `${base}/${encodeURIComponent(version)}/analyses${search ? `?search=${encodeURIComponent(search)}` : ''}`,
  );
}
