import type { AhspAnalysisSummaryDto, ProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, EmptyState, PageTitle } from '@/components/ui';
import { VERSION_LABEL } from '@/lib/import-ui';
import { formatRounded } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

/** One combined analysis list per project (D-045); source documents are metadata, not separate lists. */
export default async function AnalysesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ search?: string }> }) {
  const [{ projectId }, { search = '' }] = await Promise.all([params, searchParams]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, list] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<AhspAnalysisSummaryDto[]>(`${base}/analyses${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  ]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="analyses" permissions={project.permissions} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search" action={`${base}/analyses`}>
        <div className="w-full max-w-xs">
          <label htmlFor="search" className="field-label">
            Cari kode atau nama analisa
          </label>
          <input id="search" name="search" className="field" defaultValue={search} />
        </div>
        <button type="submit" className="btn btn-secondary">
          Cari
        </button>
      </form>
      {list.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat analisa.</Alert>
      ) : !list.data ? (
        <Alert>Daftar analisa tidak dapat dimuat.</Alert>
      ) : list.data.length === 0 ? (
        <EmptyState>{search ? 'Tidak ada analisa yang cocok.' : 'Belum ada analisa resmi. Analisa dibuat saat impor RAB di-approve.'}</EmptyState>
      ) : (
        <div className="panel data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Kode</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama analisa</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Harga satuan</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Dipakai</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Sumber</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {list.data.map((a) => (
                <tr role="row" key={a.id}>
                  <td role="cell" data-label="Kode" className="px-3 py-2 font-mono">
                    {a.code ?? '–'}
                  </td>
                  <td role="cell" data-label="Nama analisa" className="px-3 py-2">
                    <Link className="link-button" href={`${base}/analyses/${a.id}`}>
                      {a.name}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {a.latestVersion.components} komponen · versi {a.latestVersion.versionNumber}
                      {a.versionCount > 1 && ` dari ${a.versionCount}`}
                    </span>
                  </td>
                  <td role="cell" data-label="Harga satuan" className="px-3 py-2 tabular-nums">
                    Rp {formatRounded(a.latestVersion.price, 2)}/{a.unit}
                  </td>
                  <td role="cell" data-label="Dipakai" className="px-3 py-2 text-sm">
                    {a.latestVersion.rabItems} item RAB{a.latestVersion.usedAsSub > 0 && ` · subanalisa ${a.latestVersion.usedAsSub}×`}
                  </td>
                  <td role="cell" data-label="Sumber" className="px-3 py-2 text-sm">
                    Impor {VERSION_LABEL[a.latestVersion.source.versionType]}
                    <span className="block text-xs text-slate-500">{a.latestVersion.source.documents.join(', ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
