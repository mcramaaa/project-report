import { SourceValue } from './source-value';
import { workbookSource } from '@/lib/value-source';
import type { PriceListDto, ProjectDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ListSearch } from './list-search';
import { RabWorkspaceHead } from './rab-tabs';
import { Alert, EmptyState } from './ui';
import { formatRounded } from '@/lib/project-fields';
import { canChangeVersion } from '@/lib/rab-ui';
import { CorrectionBadge, InlineEdit } from './corrections';
import { serverGet } from '@/lib/server-api';

const resources = {
  materials: { label: 'Bahan', category: 'MATERIAL' },
  equipment: { label: 'Alat', category: 'EQUIPMENT' },
  labor: { label: 'Upah', category: 'LABOR' },
} as const;

export async function RabResourcePage({
  projectId,
  versionId,
  resource,
  search = '',
}: {
  projectId: string;
  versionId: string;
  resource: keyof typeof resources;
  search?: string;
}) {
  const { label, category } = resources[resource];
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ data: project, status }, prices] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<PriceListDto | null>(
      `${base}/rab-versions/${encodeURIComponent(versionId)}/price-list?category=${category}&search=${encodeURIComponent(search)}`,
    ),
  ]);
  if (status === 404 || prices.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const owner = prices.data?.rabVersion;
  const canCorrect =
    project.status === 'ACTIVE' &&
    !!owner &&
    canChangeVersion(owner.status, project.permissions, 'ahsp.edit');
  const pricePath = `${base}/rab-versions/${encodeURIComponent(versionId)}/price-items`;
  return (
    <>
      <RabWorkspaceHead project={project} versionId={versionId} version={owner} active={resource} />
      {prices.status !== 200 ? (
        <Alert>
          {prices.status === 403
            ? 'Role Anda tidak memiliki izin melihat daftar harga.'
            : 'Daftar harga tidak dapat dimuat.'}
        </Alert>
      ) : (
        <section className="space-y-3" aria-labelledby="prices-title">
          <div className="list-toolbar">
            <div className="list-toolbar-copy">
              <h2 id="prices-title">
                Harga {label.toLowerCase()}{' '}
                <span className="list-count">{prices.data?.items.length ?? 0}</span>
              </h2>
              <p>
                Harga dasar yang dipakai analisa{owner ? ` paket ${owner.label}` : ''}, sebelum PPN
                dan overhead &amp; profit.
              </p>
            </div>
            <ListSearch
              action={`${base}/rab/${encodeURIComponent(versionId)}/${resource}`}
              label={`Cari ${label.toLowerCase()}`}
              value={search}
            />
          </div>
          {!prices.data?.items.length ? (
            <EmptyState>
              {search
                ? 'Tidak ada harga yang cocok.'
                : `Paket RAB ini belum memiliki harga ${label.toLowerCase()}.`}
            </EmptyState>
          ) : (
            <div className="panel data-panel">
              <table className="data-table dense" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col" className="cell-index">
                      No.
                    </th>
                    <th role="columnheader" scope="col">
                      Nama {label.toLowerCase()}
                    </th>
                    <th role="columnheader" scope="col">
                      Satuan
                    </th>
                    <th role="columnheader" scope="col" className="num">
                      Harga satuan (Rp)
                    </th>
                    <th role="columnheader" scope="col">
                      Sumber
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {prices.data.items.map((p, index) => {
                    const excel = workbookSource(projectId, p.sourceLocator)[0];
                    const source = p.sourceLocator as { sheet?: string; cell?: string } | null;
                    return (
                      <tr id={`price-${p.id}`} role="row" key={p.id}>
                        <td role="cell" data-label="No." className="cell-index">
                          {index + 1}
                        </td>
                        <td
                          role="cell"
                          data-label={`Nama ${label.toLowerCase()}`}
                          className="cell-wide font-medium"
                        >
                          {p.name}
                        </td>
                        <td role="cell" data-label="Satuan">
                          <InlineEdit
                            editable={canCorrect}
                            path={`${pricePath}/${p.id}`}
                            field="unit"
                            value={p.unit ?? ''}
                            label={`satuan ${p.name}`}
                            reopened={owner?.status === 'REOPENED'}
                            text
                            hint="Label saja; harga dan perhitungan tidak berubah"
                          >
                            {p.unit ?? '–'}
                          </InlineEdit>
                        </td>
                        <td
                          role="cell"
                          data-label="Harga satuan (Rp)"
                          className="num whitespace-nowrap"
                          title={p.price}
                        >
                          <InlineEdit
                            editable={canCorrect}
                            path={`${pricePath}/${p.id}`}
                            field="price"
                            value={p.price}
                            label={`harga ${p.name}`}
                            reopened={owner?.status === 'REOPENED'}
                            hint="Analisa dan item RAB yang memakainya dihitung ulang."
                          >
                            <SourceValue
                              title={`Harga ${label.toLowerCase()} · ${p.name}`}
                              value={p.price}
                              note="Harga dasar tersimpan dalam paket RAB ini, sebelum overhead dan PPN."
                              sources={[
                                ...workbookSource(projectId, p.sourceLocator),
                                ...(p.copiedFrom
                                  ? [
                                      {
                                        label: `Harga asal ${p.copiedFrom.rabVersion.label}`,
                                        href: `${base}/rab/${p.copiedFrom.rabVersion.id}/${resource}#price-${p.copiedFrom.priceItemId}`,
                                      },
                                    ]
                                  : []),
                              ]}
                            >
                              {formatRounded(p.price, 2)}
                            </SourceValue>
                          </InlineEdit>
                          <CorrectionBadge locator={p.sourceLocator} />
                        </td>
                        <td role="cell" data-label="Sumber" className="whitespace-nowrap">
                          {excel ? (
                            <Link className="link-button font-mono" href={excel.href!}>
                              {source?.sheet}
                              {source?.cell && `!${source.cell}`}
                            </Link>
                          ) : (
                            '–'
                          )}
                          {p.copiedFrom && (
                            <span className="cell-meta">
                              Warisan {p.copiedFrom.rabVersion.label}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
