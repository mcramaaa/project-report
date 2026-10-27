import type { ProjectDto, RabHistoryDto, RabVersionDetailDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RabBackLinks } from '@/components/rab-tabs';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { formatRupiah } from '@/lib/project-fields';
import { RAB_STATUS_BADGE } from '@/lib/rab-ui';
import { serverGet } from '@/lib/server-api';

const ACTION_LABEL: Record<string, string> = {
  CREATE_RAB_VERSION: 'Versi dibuat',
  UPDATE_RAB_VERSION: 'Data dokumen diubah',
  APPROVE_RAB_VERSION: 'Approve',
  DISCARD_RAB_VERSION: 'Draft dibatalkan',
  REOPEN_RAB_VERSION: 'Dibuka kembali untuk koreksi',
  CORRECT_RAB_ITEM: 'Koreksi baris RAB',
  CORRECT_RAB_WORK_ITEM: 'Koreksi identitas pekerjaan (WI)',
  CORRECT_PRICE_ITEM: 'Koreksi harga dasar',
  CORRECT_AHSP_COMPONENT: 'Koreksi komponen analisa',
  CORRECT_AHSP_ANALYSIS: 'Koreksi overhead/pembulatan analisa',
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

/** Before → after of a correction, without the long recalculation list (kept in the audit log). */
function changes(oldValue: unknown, newValue: unknown): string[] {
  const before = (oldValue ?? {}) as Record<string, unknown>;
  const after = (newValue ?? {}) as Record<string, unknown>;
  return Object.keys(after)
    .filter((k) => !['recalculated', 'itemId', 'componentId', 'analysisVersionId', 'priceItemId'].includes(k))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k in before)
    .map((k) => `${k}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(after[k] ?? null)}`);
}

export default async function RabHistoryPage({
  params,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
}) {
  const { projectId, versionId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const path = `${base}/rab-versions/${encodeURIComponent(versionId)}`;
  const [{ status, data: project }, detail, history] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<RabVersionDetailDto>(path),
    serverGet<RabHistoryDto>(`${path}/history`),
  ]);
  if (status === 404 || detail.status === 404 || history.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  if (!detail.data || !history.data)
    return <Alert>{history.status === 403 ? 'Role Anda tidak memiliki izin melihat RAB.' : 'Riwayat tidak dapat dimuat.'}</Alert>;
  const v = detail.data.version;
  const h = history.data;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <RabBackLinks projectId={project.id} permissions={project.permissions} />
      <Link href={`${base}/rab/${encodeURIComponent(versionId)}`} className="page-back">
        RAB {v.label}
      </Link>
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
        Riwayat RAB {v.label}
        <Badge tone={RAB_STATUS_BADGE[v.status].tone}>{RAB_STATUS_BADGE[v.status].label}</Badge>
      </h2>

      <section className="mb-6 space-y-2" aria-labelledby="snapshots">
        <h3 id="snapshots" className="font-semibold">Snapshot approved ({h.snapshots.length})</h3>
        <p className="text-sm text-slate-600">
          Setiap approval disimpan utuh (baris, WI, angka, analisa, harga, dan provenance) dengan checksum. Snapshot tidak
          dihitung ulang dari data sekarang dan tidak berubah oleh koreksi berikutnya.
        </p>
        {h.snapshots.length === 0 ? (
          <EmptyState>Belum ada snapshot. Versi approved sebelum fitur ini dibekukan saat pertama kali dibuka kembali.</EmptyState>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {h.snapshots.map((s) => (
              <li key={s.id}>
                <Link className="link-button" href={`${base}/rab/${encodeURIComponent(versionId)}/snapshots/${s.id}`}>
                  Snapshot #{s.sequence}
                </Link>{' '}
                — approved {s.approvedAt ? dateTime(s.approvedAt) : '–'} oleh {s.approvedBy?.name ?? '–'} · total{' '}
                {formatRupiah(s.totalValue)} · diarsipkan {dateTime(s.createdAt)} oleh {s.createdBy.name}
                <span className="block font-mono text-xs text-slate-500">sha256 {s.checksum}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="events">
        <h3 id="events" className="font-semibold">Kejadian ({h.events.length})</h3>
        <ol className="space-y-2 text-sm">
          {h.events.map((e) => (
            <li key={e.id} className="panel p-3">
              <strong>{ACTION_LABEL[e.action] ?? e.action}</strong> · {dateTime(e.createdAt)} · {e.actor?.name ?? 'sistem'}
              {e.reason && <span className="block">Alasan: {e.reason}</span>}
              {changes(e.oldValue, e.newValue).map((c) => (
                <span key={c} className="block font-mono text-xs text-slate-600">
                  {c}
                </span>
              ))}
              {Array.isArray((e.newValue as { recalculated?: unknown[] } | null)?.recalculated) && (
                <span className="block text-xs text-slate-500">
                  {(e.newValue as { recalculated: unknown[] }).recalculated.length} nilai turunan dihitung ulang (detail di log audit).
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
