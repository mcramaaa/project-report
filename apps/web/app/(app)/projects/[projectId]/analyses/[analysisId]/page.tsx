import type { AhspAnalysisDetailDto, ProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectTabs } from '@/components/project-tabs';
import { Alert, Badge, PageTitle } from '@/components/ui';
import { CATEGORY_LABEL, VERSION_LABEL } from '@/lib/import-ui';
import { formatNumber, formatRounded } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';

/** An analysis is read in the context of the RAB version owning its package (D-056); `version` is required. */
export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ projectId: string; analysisId: string }>; searchParams: Promise<{ version?: string }> }) {
  const [{ projectId, analysisId }, { version }] = await Promise.all([params, searchParams]);
  if (!version) notFound();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, detail] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<AhspAnalysisDetailDto>(`${base}/rab-versions/${encodeURIComponent(version)}/analyses/${encodeURIComponent(analysisId)}`),
  ]);
  if (status === 404 || detail.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const a = detail.data;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>{project.projectName}</PageTitle>
      <ProjectTabs projectId={project.id} active="analyses" permissions={project.permissions} />
      <Link href={`${base}/analyses?version=${encodeURIComponent(version)}`} className="mb-4 inline-block text-sm text-slate-600 hover:text-slate-900">
        ← Daftar analisa
      </Link>
      {!a ? (
        <Alert>{detail.status === 403 ? 'Role Anda tidak memiliki izin melihat analisa.' : 'Analisa tidak dapat dimuat.'}</Alert>
      ) : (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">
            <span className="font-mono">{a.code}</span> {a.name}
          </h2>
          <p className="text-sm text-slate-600">Paket {a.rabVersion.label} — analisa, harga, dan subanalisa di bawah milik versi RAB ini saja.</p>
          {a.versions.map((v) => (
            <section key={v.id} className="space-y-3" aria-label={`Versi ${v.versionNumber}`}>
              <div className="panel rab-header">
                <div>
                  <h3 className="font-semibold">
                    Versi {v.versionNumber} <Badge tone="green">Resmi</Badge>{' '}
                    {v.copiedFrom ? <Badge tone="blue">Warisan {v.copiedFrom.rabVersion.label}</Badge> : <Badge>Sumber baru</Badge>}
                  </h3>
                  {v.copiedFrom && (
                    <p className="text-sm text-slate-600">
                      Disalin dari{' '}
                      <Link className="link-button" href={`${base}/rab/${v.copiedFrom.rabVersion.id}`}>
                        paket {v.copiedFrom.rabVersion.label}
                      </Link>
                      ; perubahan di sini tidak mengubah asalnya.
                    </p>
                  )}
                  <p className="text-sm text-slate-600">
                    Daftar harga paket {a.rabVersion.label}
                    {v.priceList.location && ` · ${v.priceList.location}`}
                    {v.priceList.period && ` · ${v.priceList.period}`}
                  </p>
                </div>
                <dl className="calendar-preview">
                  <div>
                    <dt>Biaya langsung (D)</dt>
                    <dd className="tabular-nums">{formatRounded(v.directCost, 2)}</dd>
                  </div>
                  <div>
                    <dt>Overhead {v.overheadPercent ?? 0}% (E)</dt>
                    <dd className="tabular-nums">{formatRounded(v.overheadAmount, 2)}</dd>
                  </div>
                  <div>
                    <dt>Harga satuan{v.roundingScale !== null && ` (bulat ${v.roundingScale} desimal)`}</dt>
                    <dd className="tabular-nums">Rp {formatNumber(v.price)}</dd>
                  </div>
                </dl>
              </div>
              <div className="panel rab-grid-wrap">
                <table className="rab-grid">
                  <thead>
                    <tr>
                      <th scope="col">Kategori</th>
                      <th scope="col">Komponen</th>
                      <th scope="col">Satuan</th>
                      <th scope="col" className="num">Koefisien</th>
                      <th scope="col" className="num">Harga</th>
                      <th scope="col" className="num">Nilai</th>
                      <th scope="col">Sumber harga</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.components.map((c) => (
                      <tr key={c.id}>
                        <td>{CATEGORY_LABEL[c.category]}</td>
                        <td>{c.description}</td>
                        <td>{c.unit}</td>
                        <td className="num">{formatNumber(c.coefficient, { trim: true })}</td>
                        <td className="num">{formatRounded(c.unitPrice, 2)}</td>
                        <td className="num">{formatRounded(c.amount, 2)}</td>
                        <td className="text-xs">
                          {c.subAnalysis ? (
                            <Link className="link-button" href={`${base}/analyses/${c.subAnalysis.analysisId}?version=${encodeURIComponent(version)}`}>
                              Subanalisa {c.subAnalysis.code} ({c.subAnalysis.basis === 'EXACT' ? 'eksak' : 'dibulatkan'})
                            </Link>
                          ) : c.priceItem ? (
                            `Daftar harga: ${c.priceItem.name}`
                          ) : (
                            'Nilai di analisa'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-sm">
                <h4 className="font-semibold">Dipakai oleh item RAB ({v.rabItems.length})</h4>
                <ul className="list-disc pl-5">
                  {v.rabItems.map((i) => (
                    <li key={i.id}>
                      <Link className="link-button" href={`${base}/rab/${i.rabVersion.id}`}>
                        {VERSION_LABEL[i.rabVersion.versionType]}
                        {i.rabVersion.versionType === 'ADDENDUM' && ` ${i.rabVersion.revisionNumber}`}
                      </Link>{' '}
                      — {i.displayNumber ? `${i.displayNumber}. ` : ''}
                      {i.description} <span className="text-xs text-slate-500">({i.rabVersion.status})</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
