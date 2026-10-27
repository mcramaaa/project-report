import type {
  AhspAnalysisSummaryDto,
  ProjectDto,
  RabVersionSummaryDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { RabBackLinks, RabTabs } from '@/components/rab-tabs';
import { formatRounded } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

/** Analyses and prices are opened inside the explicitly selected RAB package (D-059). */
export default async function AnalysesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const [{ projectId, versionId }, { search = '' }] = await Promise.all([params, searchParams]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const rabBase = `${base}/rab/${encodeURIComponent(versionId)}`;
  const pkg = `${base}/rab-versions/${encodeURIComponent(versionId)}`;
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  const [{ status, data: project }, list, versions] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<AhspAnalysisSummaryDto[]>(`${pkg}/analyses${q}`),
    serverGet<RabVersionSummaryDto[]>(`${base}/rab-versions`),
  ]);
  if (status === 404 || list.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const versionLabel = versions.data?.find((v) => v.id === versionId)?.label ?? 'yang dipilih';

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>
        {project.projectName}
      </PageTitle>
      <RabBackLinks projectId={project.id} permissions={project.permissions} />
      <h2 className="mb-3 text-lg font-semibold">RAB {versionLabel}</h2>
      <RabTabs
        projectId={project.id}
        versionId={versionId}
        active="analyses"
        permissions={project.permissions}
      />
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        role="search"
        action={`${rabBase}/analyses`}
      >
        <div className="w-full max-w-xs">
          <label htmlFor="search" className="field-label">
            Cari kode atau nama analisa
          </label>
          <input id="search" name="search" className="field" defaultValue={search} />
        </div>
        <button type="submit" className="btn btn-secondary">
          Tampilkan
        </button>
      </form>
      <p className="mb-4 text-sm text-slate-600">
        Paket <strong>{versionLabel}</strong>: analisa, upah, bahan, alat, dan harga milik versi ini
        saja; tidak dipakai bersama versi lain.
      </p>
      {list?.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat analisa.</Alert>
      ) : !list?.data ? (
        <Alert>Daftar analisa tidak dapat dimuat.</Alert>
      ) : (
        <div className="space-y-6">
          <section className="space-y-3" aria-labelledby="analyses-title">
            <h2 id="analyses-title" className="text-base font-semibold">
              Analisa ({list.data.length})
            </h2>
            {list.data.length === 0 ? (
              <EmptyState>
                {search
                  ? 'Tidak ada analisa yang cocok.'
                  : 'Paket versi ini belum memiliki analisa.'}
              </EmptyState>
            ) : (
              <div className="panel data-panel">
                <table role="table" className="data-table">
                  <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                    <tr role="row">
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Kode
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Nama analisa
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Harga satuan
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Dipakai
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Asal
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup" className="divide-y divide-slate-100">
                    {list.data.map((a) => (
                      <tr role="row" key={a.id}>
                        <td role="cell" data-label="Kode" className="px-3 py-2 font-mono">
                          {a.code ?? '–'}
                        </td>
                        <td role="cell" data-label="Nama analisa" className="px-3 py-2">
                          <Link className="link-button" href={`${rabBase}/analyses/${a.id}`}>
                            {a.name}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {a.latestVersion.components} komponen
                          </span>
                        </td>
                        <td
                          role="cell"
                          data-label="Harga satuan"
                          className="px-3 py-2 tabular-nums"
                        >
                          <Link
                            className="source-value"
                            href={`${rabBase}/analyses/${a.id}#analysis-version-${a.latestVersion.id}`}
                            title="Buka perhitungan harga analisa"
                          >
                            Rp {formatRounded(a.latestVersion.price, 2)}/{a.unit}
                          </Link>
                        </td>
                        <td role="cell" data-label="Dipakai" className="px-3 py-2 text-sm">
                          {a.latestVersion.rabItems} item RAB
                          {a.latestVersion.usedAsSub > 0 &&
                            ` · subanalisa ${a.latestVersion.usedAsSub}×`}
                        </td>
                        <td role="cell" data-label="Asal" className="px-3 py-2 text-sm">
                          {a.latestVersion.copiedFrom ? (
                            <Badge tone="blue">
                              Warisan {a.latestVersion.copiedFrom.rabVersion.label}
                            </Badge>
                          ) : (
                            <Badge tone="green">Sumber baru</Badge>
                          )}
                          {a.latestVersion.source && (
                            <span className="block text-xs text-slate-500">
                              Impor {a.latestVersion.source.label}:{' '}
                              {a.latestVersion.source.documents.join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
