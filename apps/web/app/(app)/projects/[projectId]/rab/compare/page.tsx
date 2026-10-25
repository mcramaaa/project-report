import type { ProjectDto, RabChangeType, RabCompareDto, RabRowDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { formatNumber } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

const CHANGE: Record<RabChangeType, { label: string; tone: 'slate' | 'blue' | 'green' | 'red' }> = {
  UNCHANGED: { label: 'Tetap', tone: 'slate' },
  MODIFIED: { label: 'Berubah', tone: 'blue' },
  NEW: { label: 'Baru', tone: 'green' },
  REMOVED: { label: 'Dihapus', tone: 'red' },
};
const FILTERS: { key: string; label: string; match: (c: RabChangeType) => boolean }[] = [
  { key: 'all', label: 'Semua', match: () => true },
  { key: 'changed', label: 'Berubah', match: (c) => c !== 'UNCHANGED' },
  { key: 'new', label: 'Baru', match: (c) => c === 'NEW' },
  { key: 'removed', label: 'Dihapus', match: (c) => c === 'REMOVED' },
];

/** Decimal-string difference without floats: target − base, both scaled to `scale` digits. */
function delta(base: string | null, target: string | null, scale: number): string {
  const toInt = (v: string | null) => {
    const [i, f = ''] = (v ?? '0').split('.');
    return BigInt(i! + f.padEnd(scale, '0').slice(0, scale));
  };
  const diff = toInt(target) - toInt(base);
  const sign = diff < 0n ? '-' : diff > 0n ? '+' : '';
  const digits = (diff < 0n ? -diff : diff).toString().padStart(scale + 1, '0');
  return `${sign}${formatNumber(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`, { trim: true })}`;
}

const value = (row: RabRowDto | null, key: 'volume' | 'unitPrice' | 'subtotal') => (row ? formatNumber(row[key], { trim: key === 'volume' }) : '–');

export default async function RabComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ base?: string; target?: string; filter?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const { status, data: project } = await serverGet<ProjectDto>(projectPath);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  if (!query.base || !query.target) return <Alert>Pilih dua versi untuk dibandingkan.</Alert>;
  const { status: cmpStatus, data } = await serverGet<RabCompareDto>(
    `${projectPath}/rab-versions/${encodeURIComponent(query.base)}/compare/${encodeURIComponent(query.target)}`,
  );
  if (cmpStatus === 404) notFound();
  const filter = FILTERS.find((f) => f.key === query.filter) ?? FILTERS[0]!;
  const href = (key: string) => `${projectPath}/rab/compare?base=${query.base}&target=${query.target}${key === 'all' ? '' : `&filter=${key}`}`;
  const counts = data ? Object.fromEntries(Object.keys(CHANGE).map((c) => [c, data.rows.filter((r) => r.change === c).length])) : {};

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="rab" permissions={project.permissions} />
      <Link href={`${projectPath}/rab`} className="mb-4 inline-block text-sm text-slate-600 hover:text-slate-900">
        ← Versi RAB
      </Link>
      {cmpStatus === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat RAB.</Alert>
      ) : !data ? (
        <Alert>Perbandingan tidak dapat dimuat.</Alert>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {data.base.label} → {data.target.label}
          </h2>
          <p className="text-sm text-slate-600">
            {counts.MODIFIED} berubah · {counts.NEW} baru · {counts.REMOVED} dihapus · {counts.UNCHANGED} tetap. Pekerjaan dicocokkan dengan kode pekerjaan permanen.
          </p>
          <nav className="access-tabs" aria-label="Filter perubahan">
            {FILTERS.map((f) => (
              <Link key={f.key} href={href(f.key)} aria-current={f.key === filter.key ? 'page' : undefined}>
                {f.label}
              </Link>
            ))}
          </nav>
          {data.rows.filter((r) => filter.match(r.change)).length === 0 ? (
            <EmptyState>Tidak ada pekerjaan pada filter ini.</EmptyState>
          ) : (
            <div className="panel rab-grid-wrap">
              <table className="rab-grid">
                <thead>
                  <tr>
                    <th scope="col" className="rab-sticky-no">Kode</th>
                    <th scope="col" className="rab-sticky-desc">Uraian</th>
                    <th scope="col">Perubahan</th>
                    <th scope="col" className="num">Volume {data.base.label}</th>
                    <th scope="col" className="num">Volume {data.target.label}</th>
                    <th scope="col" className="num">Δ volume</th>
                    <th scope="col" className="num">Harga {data.base.label}</th>
                    <th scope="col" className="num">Harga {data.target.label}</th>
                    <th scope="col" className="num">Jumlah {data.base.label}</th>
                    <th scope="col" className="num">Jumlah {data.target.label}</th>
                    <th scope="col" className="num">Δ jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows
                    .filter((r) => filter.match(r.change))
                    .map((r) => (
                      <tr key={r.workItemId} className={`rab-change-${r.change.toLowerCase()}`}>
                        <td className="rab-sticky-no font-mono text-xs">{r.workItemCode}</td>
                        <td className="rab-sticky-desc">
                          {(r.target ?? r.base)!.description}
                          {r.base && r.target && r.base.description !== r.target.description && <span className="block text-xs text-slate-500">sebelumnya: {r.base.description}</span>}
                        </td>
                        <td>
                          <Badge tone={CHANGE[r.change].tone}>{CHANGE[r.change].label}</Badge>
                        </td>
                        <td className="num">{value(r.base, 'volume')}</td>
                        <td className="num">{value(r.target, 'volume')}</td>
                        <td className="num">{delta(r.base?.volume ?? null, r.target?.volume ?? null, 4)}</td>
                        <td className="num">{value(r.base, 'unitPrice')}</td>
                        <td className="num">{value(r.target, 'unitPrice')}</td>
                        <td className="num">{value(r.base, 'subtotal')}</td>
                        <td className="num">{value(r.target, 'subtotal')}</td>
                        <td className="num">{delta(r.base?.subtotal ?? null, r.target?.subtotal ?? null, 2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
