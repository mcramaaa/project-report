import { RabResourcePage } from '@/components/rab-resource-page';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const [ids, query] = await Promise.all([params, searchParams]);
  return <RabResourcePage {...ids} resource="equipment" search={query.search} />;
}
