import { SourceValue } from './source-value';
import { workbookSource } from '@/lib/value-source';
import type { PriceListDto, ProjectDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { RabBackLinks, RabTabs } from './rab-tabs';
import { Alert, EmptyState, PageTitle } from './ui';
import { formatRounded } from '@/lib/project-fields';
import { canChangeVersion } from '@/lib/rab-ui';
import { CorrectionBadge, CorrectionForm } from './corrections';
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
    project.status === 'ACTIVE' && !!owner && canChangeVersion(owner.status, project.permissions, 'ahsp.edit');
  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>
        {project.projectName}
      </PageTitle>
      <RabBackLinks projectId={projectId} permissions={project.permissions} />
      <h2 className="mb-3 text-lg font-semibold">
        {prices.data ? `RAB ${prices.data.rabVersion.label}` : 'Paket RAB'}
      </h2>
      <RabTabs
        projectId={projectId}
        versionId={versionId}
        active={resource}
        permissions={project.permissions}
      />
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        role="search"
        action={`${base}/rab/${encodeURIComponent(versionId)}/${resource}`}
      >
        <div className="w-full max-w-xs">
          <label htmlFor="search" className="field-label">
            Cari {label.toLowerCase()}
          </label>
          <input id="search" name="search" className="field" defaultValue={search} />
        </div>
        <button type="submit" className="btn btn-secondary">
          Tampilkan
        </button>
      </form>
      {prices.status !== 200 ? (
        <Alert>
          {prices.status === 403
            ? 'Role Anda tidak memiliki izin melihat daftar harga.'
            : 'Daftar harga tidak dapat dimuat.'}
        </Alert>
      ) : (
        <>
          <h3 className="mb-3 font-semibold">
            {label} ({prices.data?.items.length ?? 0})
          </h3>
          {!prices.data?.items.length ? (
            <EmptyState>
              {search
                ? 'Tidak ada harga yang cocok.'
                : `Paket RAB ini belum memiliki harga ${label.toLowerCase()}.`}
            </EmptyState>
          ) : (
            <>
              <p className="mb-4 text-sm text-slate-600">
                Harga dasar yang dipakai dalam analisa paket {prices.data.rabVersion.label}, sebelum
                PPN dan overhead &amp; profit.
              </p>
              <div className="panel data-panel">
                <table className="data-table" role="table">
                  <thead role="rowgroup">
                    <tr role="row">
                      {[
                        'No.',
                        `Nama ${label.toLowerCase()}`,
                        'Satuan',
                        'Harga satuan (Rp)',
                        'Sumber',
                        ...(canCorrect ? ['Koreksi'] : []),
                      ].map((t) => (
                        <th role="columnheader" scope="col" key={t} className="px-3 py-2 text-left">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {prices.data.items.map((p, index) => {
                      const source = p.sourceLocator as { sheet?: string; cell?: string } | null;
                      return (
                        <tr id={`price-${p.id}`} role="row" key={p.id}>
                          <td role="cell" data-label="No." className="px-3 py-2">
                            {index + 1}
                          </td>
                          <td
                            role="cell"
                            data-label={`Nama ${label.toLowerCase()}`}
                            className="px-3 py-2 font-medium"
                          >
                            {p.name}
                          </td>
                          <td role="cell" data-label="Satuan" className="px-3 py-2">
                            {p.unit ?? '–'}
                          </td>
                          <td
                            role="cell"
                            data-label="Harga satuan (Rp)"
                            className="px-3 py-2 tabular-nums"
                            title={p.price}
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
                            <CorrectionBadge locator={p.sourceLocator} />
                          </td>
                          <td
                            role="cell"
                            data-label="Sumber"
                            className="px-3 py-2 text-sm text-slate-600"
                          >
                            {source?.sheet ?? '–'}
                            {source?.cell && `!${source.cell}`}
                            {p.copiedFrom && (
                              <span className="block">Warisan {p.copiedFrom.rabVersion.label}</span>
                            )}
                          </td>
                          {canCorrect && (
                            <td role="cell" data-label="Koreksi" className="px-3 py-2">
                              <CorrectionForm
                                path={`${base}/rab-versions/${encodeURIComponent(versionId)}/price-items/${p.id}`}
                                reopened={owner!.status === 'REOPENED'}
                                title={`Koreksi harga ${p.name}`}
                                fields={[{ name: 'price', label: 'Harga dasar (Rp)', value: p.price, hint: 'Analisa dan item RAB yang memakainya dihitung ulang dalam paket ini.' }]}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
