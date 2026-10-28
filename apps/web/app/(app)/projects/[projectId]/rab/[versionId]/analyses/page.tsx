import type {
  AhspAnalysisSummaryDto,
  ProjectDto,
  RabVersionSummaryDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, EmptyState } from '@/components/ui';
import { ListSearch } from '@/components/list-search';
import { RabWorkspaceHead } from '@/components/rab-tabs';
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
  const version = versions.data?.find((v) => v.id === versionId);
  const versionLabel = version?.label ?? 'yang dipilih';

  return (
    <>
      <RabWorkspaceHead
        project={project}
        versionId={versionId}
        version={version}
        active="analyses"
      />
      {list?.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat analisa.</Alert>
      ) : !list?.data ? (
        <Alert>Daftar analisa tidak dapat dimuat.</Alert>
      ) : (
        <section className="space-y-3" aria-labelledby="analyses-title">
          <div className="list-toolbar">
            <div className="list-toolbar-copy">
              <h2 id="analyses-title">
                Analisa <span className="list-count">{list.data.length}</span>
              </h2>
              <p>Analisa, harga, dan subanalisa milik paket {versionLabel} saja.</p>
            </div>
            <ListSearch
              action={`${rabBase}/analyses`}
              label="Cari kode atau nama analisa"
              value={search}
            />
          </div>
          {list.data.length === 0 ? (
            <EmptyState>
              {search ? 'Tidak ada analisa yang cocok.' : 'Paket versi ini belum memiliki analisa.'}
            </EmptyState>
          ) : (
            <div className="panel data-panel">
              <table role="table" className="data-table dense">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">
                      Kode
                    </th>
                    <th role="columnheader" scope="col">
                      Nama analisa
                    </th>
                    <th role="columnheader" scope="col" className="num">
                      Harga satuan (Rp)
                    </th>
                    <th role="columnheader" scope="col">
                      Dipakai
                    </th>
                    <th role="columnheader" scope="col">
                      Asal
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {list.data.map((a) => (
                    <tr role="row" key={a.id}>
                      <td role="cell" data-label="Kode" className="font-mono whitespace-nowrap">
                        {a.code ?? '–'}
                      </td>
                      <td role="cell" data-label="Nama analisa" className="cell-wide">
                        <Link className="link-button" href={`${rabBase}/analyses/${a.id}`}>
                          {a.name}
                        </Link>
                        <span className="cell-meta">{a.latestVersion.components} komponen</span>
                      </td>
                      <td
                        role="cell"
                        data-label="Harga satuan (Rp)"
                        className="num whitespace-nowrap"
                      >
                        <Link
                          className="source-value"
                          href={`${rabBase}/analyses/${a.id}#analysis-version-${a.latestVersion.id}`}
                          title="Buka perhitungan harga analisa"
                        >
                          {formatRounded(a.latestVersion.price, 2)}
                        </Link>
                        <span className="cell-meta">per {a.unit ?? '–'}</span>
                      </td>
                      <td role="cell" data-label="Dipakai" className="whitespace-nowrap">
                        {a.latestVersion.rabItems} item RAB
                        {a.latestVersion.usedAsSub > 0 && (
                          <span className="cell-meta">subanalisa {a.latestVersion.usedAsSub}×</span>
                        )}
                      </td>
                      <td role="cell" data-label="Asal">
                        {a.latestVersion.copiedFrom ? (
                          <Badge tone="blue">
                            Warisan {a.latestVersion.copiedFrom.rabVersion.label}
                          </Badge>
                        ) : (
                          <Badge tone="green">Sumber baru</Badge>
                        )}
                        {a.latestVersion.source && (
                          <span
                            className="cell-meta cell-clamp"
                            title={a.latestVersion.source.documents.join(', ')}
                          >
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
      )}
    </>
  );
}
