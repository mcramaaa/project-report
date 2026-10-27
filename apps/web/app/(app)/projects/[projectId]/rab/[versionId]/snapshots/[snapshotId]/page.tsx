import type { ProjectDto, RabSnapshotDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CorrectionBadge } from '@/components/corrections';
import { RabBackLinks } from '@/components/rab-tabs';
import { Alert, Badge, PageTitle } from '@/components/ui';
import { formatNumber, formatRounded, formatRupiah } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

/** Read-only view of an archived approval (D-068): every figure comes from the stored payload. */
export default async function RabSnapshotPage({
  params,
}: {
  params: Promise<{ projectId: string; versionId: string; snapshotId: string }>;
}) {
  const { projectId, versionId, snapshotId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, snapshot] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<RabSnapshotDto>(
      `${base}/rab-versions/${encodeURIComponent(versionId)}/snapshots/${encodeURIComponent(snapshotId)}`,
    ),
  ]);
  if (status === 404 || snapshot.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  if (!snapshot.data)
    return <Alert>{snapshot.status === 403 ? 'Role Anda tidak memiliki izin melihat RAB.' : 'Snapshot tidak dapat dimuat.'}</Alert>;
  const s = snapshot.data;
  const p = s.payload;
  const prices = new Map(p.package.priceItems.map((i) => [i.id, i]));

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <RabBackLinks projectId={project.id} permissions={project.permissions} />
      <Link href={`${base}/rab/${encodeURIComponent(versionId)}/history`} className="page-back">
        Riwayat RAB {p.version.label}
      </Link>
      <h2 className="mb-1 flex flex-wrap items-center gap-2 text-lg font-semibold">
        Snapshot #{s.sequence} · RAB {p.version.label}
        {s.checksumValid ? <Badge tone="green">Checksum cocok</Badge> : <Badge tone="red">Checksum tidak cocok</Badge>}
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Approved {s.approvedAt ? new Date(s.approvedAt).toLocaleString('id-ID') : '–'} oleh {s.approvedBy?.name ?? '–'} ·
        dokumen {p.version.documentNumber ?? '–'} · total real cost Rp {formatNumber(p.totals.realCost)} (dibulatkan{' '}
        {formatRupiah(p.totals.rounded)}). Arsip ini hanya-baca dan tidak mengikuti data sekarang.
      </p>

      <div className="panel rab-grid-wrap mb-6">
        <table className="rab-grid">
          <thead>
            <tr>
              {['No', 'Uraian', 'Volume', 'Satuan', 'Harga satuan', 'PPN %', 'Harga + PPN', 'Jumlah', 'Bobot %'].map((h) => (
                <th key={h} scope="col" className={['No', 'Uraian', 'Satuan'].includes(h) ? '' : 'num'}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.id} className={r.rowType === 'ITEM' ? '' : `rab-group rab-${r.rowType.toLowerCase()}`}>
                <td>{r.displayNumber}</td>
                <td style={{ paddingLeft: `${12 + r.depth * 18}px` }}>
                  {r.description}
                  {r.workItemCode && <span className="rab-code">{r.workItemCode}</span>}
                  {r.analysis && <span className="rab-code">{r.analysis.code ?? r.analysis.name}</span>}
                  <CorrectionBadge locator={r.sourceLocator} />
                </td>
                <td className="num">{formatNumber(r.volume, { trim: true })}</td>
                <td>{r.unit ?? ''}</td>
                <td className="num" title={r.unitPrice ?? undefined}>{r.unitPrice === null ? '' : formatRounded(r.unitPrice, 2)}</td>
                <td className="num">{r.taxPercent === null ? '' : formatNumber(r.taxPercent, { trim: true })}</td>
                <td className="num" title={r.unitPriceWithTax ?? undefined}>{r.unitPriceWithTax === null ? '' : formatRounded(r.unitPriceWithTax, 2)}</td>
                <td className="num" title={r.subtotal ?? undefined}>{r.subtotal === null ? '' : formatRounded(r.subtotal, 2)}</td>
                <td className="num">{formatRounded(r.weight, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-2" aria-labelledby="snapshot-package">
        <h3 id="snapshot-package" className="font-semibold">
          Paket analisa saat approval ({p.package.analyses.length} analisa, {p.package.priceItems.length} harga dasar)
        </h3>
        {p.package.analyses.map((a) => (
          <details key={a.id} className="panel p-3 text-sm">
            <summary>
              <span className="font-mono">{a.code}</span> {a.name} · harga {formatNumber(a.price)}
              {a.roundingScale !== null && ` (bulat ${a.roundingScale})`} · overhead {a.overheadPercent ?? '0'}%
              <CorrectionBadge locator={a.sourceLocator} />
            </summary>
            <ul className="mt-2 list-disc pl-5">
              {a.components.map((c) => (
                <li key={c.id}>
                  {c.description}: {c.coefficient} × {c.unitPrice} = {c.amount}
                  {c.priceItemId && ` · harga dasar ${prices.get(c.priceItemId)?.price ?? '–'}`}
                  {c.subAnalysisVersionId && ` · subanalisa (${c.subPriceBasis === 'EXACT' ? 'eksak' : 'dibulatkan'})`}
                  <CorrectionBadge locator={c.sourceLocator} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </>
  );
}
