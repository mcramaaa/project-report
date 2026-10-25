import type { AhspAnalysisSummaryDto, PriceListDto, ProjectDto, RabVersionSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { VERSION_LABEL } from '@/lib/import-ui';
import { formatRounded } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

/**
 * One combined analysis list per RAB version's package (D-056): each version owns its analyses and prices.
 * Inherited copies show the version they came from (D-058).
 */
export default async function AnalysesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ search?: string; version?: string }> }) {
  const [{ projectId }, { search = '', version: requested }] = await Promise.all([params, searchParams]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, versionsRes] = await Promise.all([serverGet<ProjectDto>(base), serverGet<RabVersionSummaryDto[]>(`${base}/rab-versions`)]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const versions = (versionsRes.data ?? []).filter((v) => v.status !== 'DISCARDED');
  const selected = versions.find((v) => v.id === requested) ?? versions.filter((v) => v.status === 'APPROVED').at(-1) ?? versions.at(-1);
  const pkg = selected ? `${base}/rab-versions/${selected.id}` : null;
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  const [list, prices] = pkg
    ? await Promise.all([serverGet<AhspAnalysisSummaryDto[]>(`${pkg}/analyses${q}`), serverGet<PriceListDto | null>(`${pkg}/price-list${q}`)])
    : [null, null];

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="analyses" permissions={project.permissions} />
      {!selected ? (
        <EmptyState>Belum ada versi RAB. Analisa dan harga dimiliki masing-masing versi RAB.</EmptyState>
      ) : (
        <>
          <form className="mb-4 flex flex-wrap items-end gap-2" role="search" action={`${base}/analyses`}>
            <div>
              <label htmlFor="version" className="field-label">
                Versi RAB
              </label>
              <select id="version" name="version" className="field" defaultValue={selected.id}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.status === 'APPROVED' ? 'approved' : 'draft'})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full max-w-xs">
              <label htmlFor="search" className="field-label">
                Cari kode, nama analisa, atau harga
              </label>
              <input id="search" name="search" className="field" defaultValue={search} />
            </div>
            <button type="submit" className="btn btn-secondary">
              Tampilkan
            </button>
          </form>
          <p className="mb-4 text-sm text-slate-600">
            Paket <strong>{selected.label}</strong>: analisa, upah, bahan, alat, dan harga milik versi ini saja; tidak dipakai bersama versi lain.
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
                  <EmptyState>{search ? 'Tidak ada analisa yang cocok.' : 'Paket versi ini belum memiliki analisa.'}</EmptyState>
                ) : (
                  <div className="panel data-panel">
                    <table role="table" className="data-table">
                      <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                        <tr role="row">
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Kode</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama analisa</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Harga satuan</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Dipakai</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Asal</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup" className="divide-y divide-slate-100">
                        {list.data.map((a) => (
                          <tr role="row" key={a.id}>
                            <td role="cell" data-label="Kode" className="px-3 py-2 font-mono">
                              {a.code ?? '–'}
                            </td>
                            <td role="cell" data-label="Nama analisa" className="px-3 py-2">
                              <Link className="link-button" href={`${base}/analyses/${a.id}?version=${selected.id}`}>
                                {a.name}
                              </Link>
                              <span className="block text-xs text-slate-500">{a.latestVersion.components} komponen</span>
                            </td>
                            <td role="cell" data-label="Harga satuan" className="px-3 py-2 tabular-nums">
                              Rp {formatRounded(a.latestVersion.price, 2)}/{a.unit}
                            </td>
                            <td role="cell" data-label="Dipakai" className="px-3 py-2 text-sm">
                              {a.latestVersion.rabItems} item RAB{a.latestVersion.usedAsSub > 0 && ` · subanalisa ${a.latestVersion.usedAsSub}×`}
                            </td>
                            <td role="cell" data-label="Asal" className="px-3 py-2 text-sm">
                              {a.latestVersion.copiedFrom ? (
                                <Badge tone="blue">Warisan {a.latestVersion.copiedFrom.rabVersion.label}</Badge>
                              ) : (
                                <Badge tone="green">Sumber baru</Badge>
                              )}
                              {a.latestVersion.source && (
                                <span className="block text-xs text-slate-500">
                                  Impor {VERSION_LABEL[a.latestVersion.source.versionType]}: {a.latestVersion.source.documents.join(', ')}
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
              <section className="space-y-3" aria-labelledby="prices-title">
                <h2 id="prices-title" className="text-base font-semibold">
                  Harga upah, bahan, dan alat ({prices?.data?.items.length ?? 0})
                </h2>
                {!prices?.data || prices.data.items.length === 0 ? (
                  <EmptyState>{search ? 'Tidak ada harga yang cocok.' : 'Paket versi ini belum memiliki daftar harga.'}</EmptyState>
                ) : (
                  <div className="panel data-panel">
                    <table role="table" className="data-table">
                      <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                        <tr role="row">
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Satuan</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Harga</th>
                          <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Sumber</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup" className="divide-y divide-slate-100">
                        {prices.data.items.map((p) => (
                          <tr role="row" key={p.id}>
                            <td role="cell" data-label="Nama" className="px-3 py-2">
                              {p.name}
                            </td>
                            <td role="cell" data-label="Satuan" className="px-3 py-2">
                              {p.unit ?? '–'}
                            </td>
                            <td role="cell" data-label="Harga" className="px-3 py-2 tabular-nums">
                              Rp {formatRounded(p.price, 2)}
                            </td>
                            <td role="cell" data-label="Sumber" className="px-3 py-2 text-sm">
                              {sheetOf(p.sourceLocator)}
                              {p.copiedFrom && <span className="block text-xs text-slate-500">warisan {p.copiedFrom.rabVersion.label}</span>}
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
      )}
    </>
  );
}

const sheetOf = (locator: unknown) => {
  const l = locator as { sheet?: string; cell?: string } | null;
  return l?.sheet ? `${l.sheet}${l.cell ? `!${l.cell}` : ''}` : '–';
};
