import { SourceValue } from '@/components/source-value';
import { workbookSource, rabRowHref } from '@/lib/value-source';
import { Fragment } from 'react';
import { Decimal } from '@laporan-proyek/calc';
import { rabVersionLabel, type AhspAnalysisDetailDto, type ProjectDto, type RabVersionType } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RabBackLinks, RabTabs } from '@/components/rab-tabs';
import { Alert, Badge, PageTitle } from '@/components/ui';
import { formatNumber, formatRounded } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';
import { canChangeVersion } from '@/lib/rab-ui';
import { CorrectionBadge, CorrectionForm } from '@/components/corrections';

/** The route keeps the owning RAB explicit, including when following sub-analysis links. */
/** No overhead in the price chain; a listed but unused overhead row (D-063) is named with its cells. */
function noOverheadText(locator: unknown): string {
  const u = (locator as { unusedOverhead?: { percent: string; overheadCell: string; directCell: string } } | null)
    ?.unusedOverhead;
  return u
    ? `Overhead ${u.percent}% tercantum di ${u.overheadCell}, tetapi harga sumber merujuk biaya langsung D (${u.directCell}); tidak dipakai`
    : 'Tidak ada overhead pada sumber';
}

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ projectId: string; versionId: string; analysisId: string }>;
}) {
  const { projectId, versionId: version, analysisId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, detail] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<AhspAnalysisDetailDto>(
      `${base}/rab-versions/${encodeURIComponent(version)}/analyses/${encodeURIComponent(analysisId)}`,
    ),
  ]);
  if (status === 404 || detail.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const a = detail.data;
  // D-068: source inputs of a DRAFT/REOPENED package are editable; derived values never are.
  const canCorrect =
    project.status === 'ACTIVE' && !!a && canChangeVersion(a.rabVersion.status, project.permissions, 'ahsp.edit');
  const reopened = a?.rabVersion.status === 'REOPENED';
  const versionPath = `${base}/rab-versions/${encodeURIComponent(version)}`;

  return (
    <>
      <PageTitle subtitle={<span className="font-mono">{project.code}</span>}>
        {project.projectName}
      </PageTitle>
      <RabBackLinks projectId={project.id} permissions={project.permissions} />
      <RabTabs
        projectId={project.id}
        versionId={version}
        active="analyses"
        permissions={project.permissions}
      />
      <Link
        href={`${base}/rab/${encodeURIComponent(version)}/analyses`}
        className="page-back"
      >
        Daftar analisa
      </Link>
      {!a ? (
        <Alert>
          {detail.status === 403
            ? 'Role Anda tidak memiliki izin melihat analisa.'
            : 'Analisa tidak dapat dimuat.'}
        </Alert>
      ) : (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">
            <span className="font-mono">{a.code}</span> {a.name}
          </h2>
          <p className="text-sm text-slate-600">
            Paket {a.rabVersion.label} — analisa, harga, dan subanalisa di bawah milik versi RAB ini
            saja.
          </p>
          {a.versions.map((v) => (
            <section
              id={`analysis-version-${v.id}`}
              key={v.id}
              className="space-y-3"
              aria-label={`Versi ${v.versionNumber}`}
            >
              <div className="panel rab-header">
                <div>
                  <h3 className="font-semibold">
                    Versi {v.versionNumber} <Badge tone="green">Resmi</Badge>{' '}
                    {v.copiedFrom ? (
                      <Badge tone="blue">Warisan {v.copiedFrom.rabVersion.label}</Badge>
                    ) : (
                      <Badge>Sumber baru</Badge>
                    )}
                  </h3>
                  {v.copiedFrom && (
                    <p className="text-sm text-slate-600">
                      Disalin dari{' '}
                      <Link
                        className="link-button"
                        href={`${base}/rab/${v.copiedFrom.rabVersion.id}/analyses/${v.copiedFrom.analysisId}#analysis-version-${v.copiedFrom.analysisVersionId}`}
                      >
                        paket {v.copiedFrom.rabVersion.label}
                      </Link>
                      ; perubahan di sini tidak mengubah asalnya.
                    </p>
                  )}
                  <p className="text-sm text-slate-600">
                    Daftar harga paket {a.rabVersion.label}
                    {v.priceList.location && ` · ${v.priceList.location}`}
                    {v.priceList.period && ` · ${v.priceList.period}`}
                    <CorrectionBadge locator={v.sourceLocator} />
                  </p>
                  {canCorrect && (
                    <CorrectionForm
                      path={`${versionPath}/analysis-versions/${v.id}`}
                      reopened={reopened}
                      title="Koreksi overhead dan pembulatan"
                      fields={[
                        { name: 'overheadPercent', label: 'Overhead & profit (%)', value: v.overheadPercent ?? '', hint: 'Kosongkan bila sumber tidak memakai overhead.' },
                        { name: 'roundingScale', label: 'Pembulatan harga (desimal)', value: v.roundingScale === null ? '' : String(v.roundingScale), number: true, hint: 'Kosongkan bila sumber tidak membulatkan.' },
                      ]}
                    />
                  )}
                </div>
                <dl className="calendar-preview">
                  <div>
                    <dt>Biaya langsung (D)</dt>
                    <dd className="tabular-nums">
                      <SourceValue
                        title="Biaya langsung (D)"
                        value={v.directCost}
                        formula="A + B + C (subtotal tenaga + bahan + peralatan)"
                        sources={(['LABOR', 'MATERIAL', 'EQUIPMENT'] as const).map((category) => ({
                          label: {
                            LABOR: 'A · Tenaga',
                            MATERIAL: 'B · Bahan',
                            EQUIPMENT: 'C · Peralatan',
                          }[category],
                          value: v.categoryTotals[category],
                          href: `#analysis-group-${v.id}-${category}`,
                        }))}
                      >
                        {formatRounded(v.directCost, 2)}
                      </SourceValue>
                    </dd>
                  </div>
                  <div>
                    <dt>Overhead {v.overheadPercent ?? 0}% (E)</dt>
                    <dd className="tabular-nums">
                      <SourceValue
                        title="Overhead & Profit (E)"
                        value={v.overheadAmount}
                        formula={
                          v.overheadPercent === null
                            ? noOverheadText(v.sourceLocator)
                            : `${v.overheadPercent}% × biaya langsung D`
                        }
                        sources={[
                          {
                            label: 'Biaya langsung (D)',
                            value: v.directCost,
                            href: `#analysis-direct-${v.id}`,
                          },
                          { label: 'Persentase pada versi analisa', value: v.overheadPercent },
                          ...workbookSource(projectId, v.sourceLocator),
                        ]}
                      >
                        {formatRounded(v.overheadAmount, 2)}
                      </SourceValue>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      Harga satuan
                      {v.roundingScale !== null && ` (bulat ${v.roundingScale} desimal)`}
                    </dt>
                    <dd className="tabular-nums">
                      Rp{' '}
                      <SourceValue
                        title="Harga satuan analisa"
                        value={v.price}
                        formula={
                          v.roundingScale === null
                            ? 'Harga eksak D + E; tanpa pembulatan sumber'
                            : `ROUND(D + E, ${v.roundingScale}), HALF_UP sesuai sumber`
                        }
                        sources={[
                          {
                            label: 'Harga eksak sebelum pembulatan',
                            value: v.priceExact,
                            href: `#analysis-exact-${v.id}`,
                          },
                          ...workbookSource(projectId, v.sourceLocator),
                          ...(v.copiedFrom
                            ? [
                                {
                                  label: `Asal warisan ${v.copiedFrom.rabVersion.label}`,
                                  href: `${base}/rab/${v.copiedFrom.rabVersion.id}/analyses/${v.copiedFrom.analysisId}#analysis-version-${v.copiedFrom.analysisVersionId}`,
                                },
                              ]
                            : []),
                        ]}
                      >
                        {formatNumber(v.price)}
                      </SourceValue>
                    </dd>
                  </div>
                </dl>
              </div>
              <div
                className="panel analysis-sheet-wrap"
                role="region"
                aria-label="Rincian perhitungan analisa"
                tabIndex={0}
              >
                <table className="analysis-sheet">
                  <caption>
                    <span className="font-mono">{v.code}</span> {v.name}
                    <span className="block text-sm font-normal">
                      Satuan pekerjaan: {v.unit ?? '–'}
                    </span>
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      <th scope="col">Uraian</th>
                      <th scope="col">Satuan</th>
                      <th scope="col" className="num">
                        Koefisien
                      </th>
                      <th scope="col" className="num">
                        Harga satuan (Rp)
                      </th>
                      <th scope="col" className="num">
                        Jumlah harga (Rp)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        {
                          category: 'LABOR',
                          letter: 'A',
                          label: 'Tenaga',
                          subtotal: 'Jumlah tenaga kerja',
                        },
                        {
                          category: 'MATERIAL',
                          letter: 'B',
                          label: 'Bahan',
                          subtotal: 'Jumlah harga bahan',
                        },
                        {
                          category: 'EQUIPMENT',
                          letter: 'C',
                          label: 'Peralatan',
                          subtotal: 'Jumlah harga alat',
                        },
                      ] as const
                    ).map((group) => (
                      <Fragment key={group.category}>
                        <tr
                          id={`analysis-group-${v.id}-${group.category}`}
                          className="analysis-group"
                        >
                          <th scope="row">{group.letter}.</th>
                          <th colSpan={5} scope="rowgroup">
                            {group.label}
                          </th>
                        </tr>
                        {v.components
                          .filter((c) => c.category === group.category)
                          .map((c, index) => (
                            <tr id={`component-${c.id}`} key={c.id}>
                              <td className="text-slate-500">{index + 1}</td>
                              <td>
                                {c.description}
                                {c.subAnalysis ? (
                                  <Link
                                    className="block text-xs text-blue-600"
                                    href={`${base}/rab/${encodeURIComponent(version)}/analyses/${c.subAnalysis.analysisId}`}
                                  >
                                    Subanalisa {c.subAnalysis.code} ·{' '}
                                    {c.subAnalysis.basis === 'EXACT'
                                      ? 'harga eksak'
                                      : 'harga dibulatkan'}
                                  </Link>
                                ) : (
                                  c.priceItem && (
                                    <span className="block text-xs text-slate-500">
                                      Daftar harga: {c.priceItem.name}
                                    </span>
                                  )
                                )}
                                <CorrectionBadge locator={c.sourceLocator} />
                                {canCorrect && (
                                  <CorrectionForm
                                    path={`${versionPath}/components/${c.id}`}
                                    reopened={reopened}
                                    title={`Koreksi komponen ${c.description}`}
                                    fields={[
                                      { name: 'coefficient', label: 'Koefisien', value: c.coefficient },
                                      // Linked prices follow the base price/sub-analysis; only a manual price is an input.
                                      ...(c.priceItem || c.subAnalysis
                                        ? []
                                        : [{ name: 'unitPrice', label: 'Harga komponen manual (Rp)', value: c.unitPrice }]),
                                    ]}
                                  />
                                )}
                              </td>
                              <td>{c.unit ?? '–'}</td>
                              <td className="num">
                                <SourceValue
                                  title={`Koefisien · ${c.description}`}
                                  value={c.coefficient}
                                  note="Koefisien yang tercatat pada komponen versi analisa ini."
                                  sources={workbookSource(projectId, c.sourceLocator)}
                                >
                                  {formatNumber(
                                    new Decimal(c.coefficient).toFixed(
                                      Math.max(4, new Decimal(c.coefficient).decimalPlaces()),
                                    ),
                                  )}
                                </SourceValue>
                              </td>
                              <td className="num" title={c.unitPrice}>
                                <SourceValue
                                  title={`Harga satuan · ${c.description}`}
                                  value={c.unitPrice}
                                  note="Harga efektif komponen mengikuti rumus sumber; bisa berbeda dari harga dasar bila ada faktor konversi (misalnya sewa per hari menjadi per jam)."
                                  sources={[
                                    ...(c.subAnalysis
                                      ? [
                                          {
                                            label: `Subanalisa ${c.subAnalysis.code ?? c.subAnalysis.name} · ${c.subAnalysis.basis === 'EXACT' ? 'eksak' : 'dibulatkan'}`,
                                            href: `${base}/rab/${version}/analyses/${c.subAnalysis.analysisId}#analysis-version-${c.subAnalysis.versionId}`,
                                          },
                                        ]
                                      : c.priceItem
                                        ? [
                                            {
                                              label: `Harga dasar ${c.priceItem.name}`,
                                              value: c.priceItem.price,
                                              href: `${base}/rab/${version}/${{ LABOR: 'labor', MATERIAL: 'materials', EQUIPMENT: 'equipment' }[c.category]}#price-${c.priceItem.id}`,
                                            },
                                          ]
                                        : []),
                                    ...workbookSource(projectId, c.sourceLocator),
                                  ]}
                                >
                                  {formatRounded(c.unitPrice, 2)}
                                </SourceValue>
                              </td>
                              <td className="num" title={c.amount}>
                                <SourceValue
                                  title={`Jumlah · ${c.description}`}
                                  value={c.amount}
                                  formula="Koefisien × harga satuan efektif, tanpa pembulatan"
                                  sources={[
                                    {
                                      label: 'Koefisien',
                                      value: c.coefficient,
                                      href: `#component-${c.id}`,
                                    },
                                    {
                                      label: 'Harga satuan efektif',
                                      value: c.unitPrice,
                                      href: `#component-${c.id}`,
                                    },
                                    ...workbookSource(projectId, c.sourceLocator),
                                  ]}
                                >
                                  {formatRounded(c.amount, 2)}
                                </SourceValue>
                              </td>
                            </tr>
                          ))}
                        {!v.components.some((c) => c.category === group.category) && (
                          <tr>
                            <td></td>
                            <td colSpan={5} className="text-slate-500">
                              Tidak ada komponen {group.label.toLowerCase()}.
                            </td>
                          </tr>
                        )}
                        <tr className="analysis-subtotal">
                          <td colSpan={5}>{group.subtotal}</td>
                          <td className="num" title={v.categoryTotals[group.category]}>
                            <SourceValue
                              title={group.subtotal}
                              value={v.categoryTotals[group.category]}
                              formula={`Σ jumlah komponen ${group.label.toLowerCase()}`}
                              sources={v.components
                                .filter((c) => c.category === group.category)
                                .map((c) => ({
                                  label: c.description,
                                  value: c.amount,
                                  href: `#component-${c.id}`,
                                }))}
                              note={
                                !v.components.some((c) => c.category === group.category)
                                  ? 'Kelompok ini tidak memiliki komponen; subtotal nol.'
                                  : undefined
                              }
                            >
                              {formatRounded(v.categoryTotals[group.category], 2)}
                            </SourceValue>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    <tr id={`analysis-direct-${v.id}`} className="analysis-summary">
                      <th scope="row">D.</th>
                      <td colSpan={4}>Jumlah (A + B + C)</td>
                      <td className="num" title={v.directCost}>
                        <SourceValue
                          title="Biaya langsung (D)"
                          value={v.directCost}
                          formula="A + B + C (subtotal tenaga + bahan + peralatan)"
                          sources={(['LABOR', 'MATERIAL', 'EQUIPMENT'] as const).map(
                            (category) => ({
                              label: {
                                LABOR: 'A · Tenaga',
                                MATERIAL: 'B · Bahan',
                                EQUIPMENT: 'C · Peralatan',
                              }[category],
                              value: v.categoryTotals[category],
                              href: `#analysis-group-${v.id}-${category}`,
                            }),
                          )}
                        >
                          {formatRounded(v.directCost, 2)}
                        </SourceValue>
                      </td>
                    </tr>
                    <tr id={`analysis-overhead-${v.id}`} className="analysis-summary">
                      <th scope="row">E.</th>
                      <td>Overhead &amp; Profit</td>
                      <td colSpan={3} className="num">
                        <SourceValue
                          title="Persentase Overhead & Profit"
                          value={v.overheadPercent}
                          note="Persentase per versi analisa sesuai dokumen; bukan tarif global."
                          sources={workbookSource(projectId, v.sourceLocator)}
                        >
                          {v.overheadPercent === null
                            ? noOverheadText(v.sourceLocator)
                            : `${formatNumber(v.overheadPercent)} % × D`}
                        </SourceValue>
                      </td>
                      <td className="num" title={v.overheadAmount}>
                        <SourceValue
                          title="Overhead & Profit (E)"
                          value={v.overheadAmount}
                          formula={
                            v.overheadPercent === null
                              ? noOverheadText(v.sourceLocator)
                              : `${v.overheadPercent}% × biaya langsung D`
                          }
                          sources={[
                            {
                              label: 'Biaya langsung (D)',
                              value: v.directCost,
                              href: `#analysis-direct-${v.id}`,
                            },
                            { label: 'Persentase pada versi analisa', value: v.overheadPercent },
                            ...workbookSource(projectId, v.sourceLocator),
                          ]}
                        >
                          {formatRounded(v.overheadAmount, 2)}
                        </SourceValue>
                      </td>
                    </tr>
                    <tr id={`analysis-exact-${v.id}`} className="analysis-total">
                      <th scope="row">F.</th>
                      <td colSpan={4}>Harga Satuan Pekerjaan (D + E)</td>
                      <td className="num" title={v.priceExact}>
                        <SourceValue
                          title="Harga satuan eksak (F)"
                          value={v.priceExact}
                          formula="D + E"
                          sources={[
                            {
                              label: 'Biaya langsung (D)',
                              value: v.directCost,
                              href: `#analysis-direct-${v.id}`,
                            },
                            {
                              label: 'Overhead & Profit (E)',
                              value: v.overheadAmount,
                              href: `#analysis-overhead-${v.id}`,
                            },
                          ]}
                        >
                          {formatRounded(v.priceExact, 2)}
                        </SourceValue>
                      </td>
                    </tr>
                    <tr className="analysis-final">
                      <td></td>
                      <td colSpan={4}>
                        Harga satuan yang dipakai
                        {v.roundingScale !== null
                          ? ` · pembulatan ${v.roundingScale} desimal`
                          : ' · tanpa pembulatan'}
                      </td>
                      <td className="num">
                        <SourceValue
                          title="Harga satuan analisa"
                          value={v.price}
                          formula={
                            v.roundingScale === null
                              ? 'Harga eksak D + E; tanpa pembulatan sumber'
                              : `ROUND(D + E, ${v.roundingScale}), HALF_UP sesuai sumber`
                          }
                          sources={[
                            {
                              label: 'Harga eksak sebelum pembulatan',
                              value: v.priceExact,
                              href: `#analysis-exact-${v.id}`,
                            },
                            ...workbookSource(projectId, v.sourceLocator),
                            ...(v.copiedFrom
                              ? [
                                  {
                                    label: `Asal warisan ${v.copiedFrom.rabVersion.label}`,
                                    href: `${base}/rab/${v.copiedFrom.rabVersion.id}/analyses/${v.copiedFrom.analysisId}#analysis-version-${v.copiedFrom.analysisVersionId}`,
                                  },
                                ]
                              : []),
                          ]}
                        >
                          {formatNumber(v.price)}
                        </SourceValue>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Harga sebelum PPN. Tampilan nilai uang memakai 2 desimal; perhitungan memakai nilai
                lengkap. Klik nilai untuk membuka rumus, presisi lengkap dan sumbernya. Di ponsel,
                geser tabel untuk melihat kolom lainnya.
              </p>
              <div className="text-sm">
                <h4 className="font-semibold">Dipakai oleh item RAB ({v.rabItems.length})</h4>
                <ul className="list-disc pl-5">
                  {v.rabItems.map((i) => (
                    <li key={i.id}>
                      <Link
                        className="link-button"
                        href={rabRowHref(projectId, i.rabVersion.id, i.id)}
                      >
                        {rabVersionLabel({ versionType: i.rabVersion.versionType as RabVersionType, revisionNumber: i.rabVersion.revisionNumber })}
                      </Link>{' '}
                      — {i.displayNumber ? `${i.displayNumber}. ` : ''}
                      {i.description}{' '}
                      <span className="text-xs text-slate-500">({i.rabVersion.status})</span>
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
