import type { ProjectBaselinesDto, ProjectDto, RabVersionSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IMPORT_PERMISSIONS, ProjectHeader } from '@/components/project-tabs';
import { Alert, Badge, EmptyState, Section } from '@/components/ui';
import { formatDate, formatRupiah } from '@/lib/project-fields';
import { RAB_STATUS_BADGE } from '@/lib/rab-ui';
import { serverGet } from '@/lib/server-api';
import { BaselinePanel } from './baseline-panel';
import { CreateRabVersion } from './create-rab-version';

export default async function RabVersionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, versions, baselines] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<RabVersionSummaryDto[]>(`${base}/rab-versions`),
    serverGet<ProjectBaselinesDto>(`${base}/baselines`),
  ]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const canEdit = project.permissions.includes('rab.edit') && project.status === 'ACTIVE';
  const canActivate =
    project.permissions.includes('baseline.activate') && project.status === 'ACTIVE';

  return (
    <>
      <ProjectHeader project={project} active="rab" />
      {versions.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat RAB.</Alert>
      ) : !versions.data ? (
        <Alert>Versi RAB tidak dapat dimuat.</Alert>
      ) : (
        <div className="mt-4 stack">
          <Section
            id="rab-versions"
            title="Versi RAB"
            description="Kontrak dan setiap MC. Buka versi untuk melihat atau mengedit isinya."
            body={versions.data.length === 0}
            action={
              IMPORT_PERMISSIONS.some((p) => project.permissions.includes(p)) && (
                <Link className="btn btn-secondary" href={`${base}/imports`}>
                  Impor RAB dari Excel
                </Link>
              )
            }
          >
            {versions.data.length === 0 ? (
              <EmptyState>
                Belum ada versi RAB. Mulai dengan RAB Kontrak, ketik manual di bawah atau impor dari
                Excel.
              </EmptyState>
            ) : (
              <div className="data-panel">
                <table role="table" className="data-table">
                  <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                    <tr role="row">
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Versi
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Dokumen
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Status
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Total (real cost)
                      </th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup" className="divide-y divide-slate-100">
                    {versions.data.map((v) => (
                      <tr role="row" key={v.id}>
                        <td role="cell" data-label="Versi" className="px-3 py-2 font-medium">
                          {v.label}
                        </td>
                        <td role="cell" data-label="Dokumen" className="px-3 py-2">
                          {v.documentNumber ?? '–'}
                          {v.documentDate && (
                            <span className="block text-xs text-slate-500">
                              {formatDate(v.documentDate)}
                            </span>
                          )}
                        </td>
                        <td role="cell" data-label="Status" className="px-3 py-2">
                          <Badge tone={RAB_STATUS_BADGE[v.status].tone}>
                            {RAB_STATUS_BADGE[v.status].label}
                          </Badge>
                          {v.approvedBy && (
                            <span className="block text-xs text-slate-500">
                              oleh {v.approvedBy.name}
                            </span>
                          )}
                          {v.discardReason && (
                            <span className="block text-xs text-slate-500">{v.discardReason}</span>
                          )}
                        </td>
                        <td
                          role="cell"
                          data-label="Total (real cost)"
                          className="px-3 py-2 tabular-nums"
                        >
                          <Link
                            className="source-value"
                            href={`${base}/rab/${v.id}#rab-total`}
                            title="Buka rincian total RAB"
                          >
                            {formatRupiah(v.totals.realCost)}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            dibulatkan{' '}
                            <Link className="source-value" href={`${base}/rab/${v.id}#rab-total`}>
                              {formatRupiah(v.totals.rounded)}
                            </Link>{' '}
                            ·{' '}
                            <Link className="link-button" href={`${base}/rab/${v.id}`}>
                              {v.itemCount} item
                            </Link>
                          </span>
                        </td>
                        <td role="cell" data-label="Aksi">
                          <div className="row-actions">
                            <Link className="btn btn-secondary" href={`${base}/rab/${v.id}`}>
                              {(v.status === 'DRAFT' || v.status === 'REOPENED') && canEdit
                                ? 'Edit'
                                : 'Lihat'}
                            </Link>
                            {v.previousVersionId && (
                              <Link
                                className="btn btn-secondary"
                                href={`${base}/rab/compare?base=${v.previousVersionId}&target=${v.id}`}
                              >
                                Bandingkan
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {canEdit && <CreateRabVersion projectId={project.id} versions={versions.data} />}
          {baselines.data ? (
            <BaselinePanel
              projectId={project.id}
              initial={baselines.data}
              canActivate={canActivate}
            />
          ) : (
            <Alert>Baseline tidak dapat dimuat.</Alert>
          )}
        </div>
      )}
    </>
  );
}
