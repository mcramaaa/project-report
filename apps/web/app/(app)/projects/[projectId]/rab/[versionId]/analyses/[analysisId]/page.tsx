import { SourceValue } from '@/components/source-value';
import { workbookSource, rabRowHref } from '@/lib/value-source';
import { Fragment } from 'react';
import { Decimal } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  type AhspAnalysisDetailDto,
  type ProjectDto,
  type RabVersionType,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RabWorkspaceHead } from '@/components/rab-tabs';
import { Alert, Badge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { formatNumber, formatRounded } from '@/lib/project-fields';
import { serverGet } from '@/lib/server-api';
import { canChangeVersion } from '@/lib/rab-ui';
import { CorrectionBadge, InlineEdit } from '@/components/corrections';

/** The route keeps the owning RAB explicit, including when following sub-analysis links. */
/** No overhead in the price chain; a listed but unused overhead row (D-063) is named with its cells. */
function noOverheadText(locator: unknown): string {
  const u = (
    locator as {
      unusedOverhead?: { percent: string; overheadCell: string; directCell: string };
    } | null
  )?.unusedOverhead;
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
    project.status === 'ACTIVE' &&
    !!a &&
    canChangeVersion(a.rabVersion.status, project.permissions, 'ahsp.edit');
  const reopened = a?.rabVersion.status === 'REOPENED';
  const versionPath = `${base}/rab-versions/${encodeURIComponent(version)}`;

  return (
    <>
      <RabWorkspaceHead
        project={project}
        versionId={version}
        version={a?.rabVersion}
        active="analyses"
      />
      {!a ? (
        <Alert>
          {detail.status === 403
            ? 'Role Anda tidak memiliki izin melihat analisa.'
            : 'Analisa tidak dapat dimuat.'}
        </Alert>
      ) : (
        <div className="space-y-5">
          <div className="list-toolbar">
            <div className="list-toolbar-copy">
              <Link
                href={`${base}/rab/${encodeURIComponent(version)}/analyses`}
                className="page-back"
              >
                <Icon name="arrow-left" size={14} />
                Daftar analisa
              </Link>
              <h2>
                <span className="font-mono">{a.code}</span> {a.name}
              </h2>
              <p>Analisa, harga, dan subanalisa di bawah milik paket {a.rabVersion.label} saja.</p>
            </div>
          </div>
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
                    <span className="sr-only">
                      {v.code} {v.name}.{' '}
                    </span>
                    Satuan pekerjaan: <strong>{v.unit ?? '–'}</strong>
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
                              </td>
                              <td>{c.unit ?? '–'}</td>
                              <td className="num">
                                <InlineEdit
                                  editable={canCorrect}
                                  path={`${versionPath}/components/${c.id}`}
                                  field="coefficient"
                                  value={c.coefficient}
                                  label={`koefisien ${c.description}`}
                                  reopened={reopened}
                                >
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
                                </InlineEdit>
                              </td>
                              <td className="num" title={c.unitPrice}>
                                <InlineEdit
                                  // Linked prices follow the base price/sub-analysis; only a manual price is an input.
                                  editable={canCorrect && !c.priceItem && !c.subAnalysis}
                                  path={`${versionPath}/components/${c.id}`}
                                  field="unitPrice"
                                  value={c.unitPrice}
                                  label={`harga komponen ${c.description}`}
                                  reopened={reopened}
                                >
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
                                </InlineEdit>
                                {c.priceItem && (
                                  <PriceConversion
                                    href={`${base}/rab/${version}/${{ LABOR: 'labor', MATERIAL: 'materials', EQUIPMENT: 'equipment' }[c.category]}#price-${c.priceItem.id}`}
                                    price={c.priceItem.price}
                                    priceUnit={c.priceItem.unit}
                                    unit={c.unit}
                                    locator={c.sourceLocator}
                                    factorEdit={
                                      canCorrect
                                        ? {
                                            path: `${versionPath}/components/${c.id}`,
                                            reopened,
                                            label: `faktor konversi ${c.description}`,
                                          }
                                        : undefined
                                    }
                                  />
                                )}
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
                        <InlineEdit
                          editable={canCorrect}
                          path={`${versionPath}/analysis-versions/${v.id}`}
                          field="overheadPercent"
                          value={v.overheadPercent ?? ''}
                          label="persentase overhead & profit"
                          reopened={reopened}
                          hint="Kosongkan bila sumber tidak memakai overhead"
                        >
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
                        </InlineEdit>
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
                        Harga satuan yang dipakai ·{' '}
                        <InlineEdit
                          editable={canCorrect}
                          path={`${versionPath}/analysis-versions/${v.id}`}
                          field="roundingScale"
                          value={v.roundingScale === null ? '' : String(v.roundingScale)}
                          label="pembulatan harga (desimal)"
                          reopened={reopened}
                          number
                          hint="Jumlah desimal; kosongkan bila sumber tidak membulatkan"
                        >
                          {v.roundingScale !== null
                            ? `pembulatan ${v.roundingScale} desimal`
                            : 'tanpa pembulatan'}
                        </InlineEdit>
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
                        {rabVersionLabel({
                          versionType: i.rabVersion.versionType as RabVersionType,
                          revisionNumber: i.rabVersion.revisionNumber,
                        })}
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

/**
 * Base price → component price. Analyses often price a component in another unit than the price list
 * (sewa per hari → per jam); the conversion the source applied (`source_locator.factor`) is shown, and a
 * unit difference without one is flagged instead of guessed.
 */
function PriceConversion({
  href,
  price,
  priceUnit,
  unit,
  locator,
  factorEdit,
}: {
  href: string;
  price: string;
  priceUnit: string | null;
  unit: string | null;
  locator: unknown;
  /** Set when the version is open: the conversion becomes a correctable value (D-068). */
  factorEdit?: { path: string; reopened: boolean; label: string };
}) {
  const factor = (locator as { factor?: { op?: string; value?: string } } | null)?.factor;
  const norm = (u: string | null) => (u ?? '').toLowerCase().replace(/[\s.]/g, '');
  const differs = Boolean(priceUnit && unit && norm(priceUnit) !== norm(unit));
  return (
    <span className="price-conversion">
      <Link href={href} title="Buka harga dasar (dapat dikoreksi di sana)">
        dasar {formatRounded(price, 2)}/{priceUnit ?? '–'}
      </Link>
      <InlineEdit
        editable={Boolean(factorEdit)}
        path={factorEdit?.path ?? ''}
        field="factor"
        value={factor?.value ? `${factor.op === '/' ? '/' : '×'}${factor.value}` : ''}
        label={factorEdit?.label ?? 'faktor konversi'}
        reopened={factorEdit?.reopened ?? false}
        text
        hint="Contoh /8, ÷ 4 atau ×2; kosongkan bila tanpa konversi. Harga komponen dihitung ulang dari harga dasar"
      >
        <span>
          {' '}
          {factor?.value
            ? `${factor.op === '/' ? '÷' : '×'} ${factor.value} → /${unit ?? '–'}`
            : factorEdit
              ? 'tanpa konversi'
              : ''}
        </span>
      </InlineEdit>
      {differs && !factor?.value && (
        <span
          className="price-conversion-warn"
          title="Satuan harga dasar berbeda dengan satuan komponen, dan sumber tidak mencantumkan konversi; harga dipakai apa adanya."
        >
          satuan beda, tanpa konversi
        </span>
      )}
      {!differs && factor?.value && (
        <span
          className="price-conversion-warn"
          title="Sumber membagi/mengalikan harga dasar walau satuannya tertulis sama; kemungkinan satuan harga dasar sebenarnya berbeda (misalnya per batang 4 m)."
        >
          satuan tertulis sama
        </span>
      )}
    </span>
  );
}
