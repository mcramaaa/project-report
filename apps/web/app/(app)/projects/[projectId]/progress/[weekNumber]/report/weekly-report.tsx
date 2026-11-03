'use client';

import { Decimal } from '@laporan-proyek/calc';
import {
  WEATHER_LABELS,
  type WeeklyReportContent,
  type WeeklyReportDto,
  DECIMALS,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { useState } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { Alert, Badge, Button, Section } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatRounded } from '@/lib/project-fields';
import { WEEKLY_STATUS_BADGE } from '@/lib/rab-ui';
import { SCurveLegend, SCurveSheet } from '../../../schedule/s-curve-chart';
import { DayStrip } from '../day-strip';

const pct = (v: string | null) => (v === null ? '–' : `${formatRounded(v, DECIMALS.weight)}%`);
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** D-081: one week's report, its status steps, and the content as the office RM/M/Curva S sheets show it. */
export function WeeklyReport({
  projectId,
  initial,
  permissions,
  meId,
  officeWorkbook = false,
}: {
  projectId: string;
  initial: WeeklyReportDto;
  permissions: string[];
  meId: string;
  /** D-086: the project has the office workbook; PDF then comes from that file. */
  officeWorkbook?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<{ message: string; list: string[] }>();
  const [confirm, setConfirm] = useState<{ step: 'review' | 'finalize'; warnings: string[] }>();
  const [note, setNote] = useState('');
  const [reopening, setReopening] = useState(false);
  const { content: c, report, summary, issues } = data;
  const base = `/projects/${projectId}/weekly-reports/${summary.weekNumber}`;
  const status = report?.status ?? null;
  const can = (p: string) => data.active && permissions.includes(p);
  const ownEntry = data.enteredBy.some((u) => u.id === meId);

  async function run(path: string, body: unknown, message: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setData(await api<WeeklyReportDto>('POST', `${base}/${path}`, body));
      setNotice(message);
      setConfirm(undefined);
      setReopening(false);
    } catch (err) {
      const details =
        err instanceof ApiError
          ? (err.details as { errors?: string[]; warnings?: string[] } | undefined)
          : undefined;
      if (details?.warnings?.length && (path === 'review' || path === 'finalize'))
        setConfirm({ step: path, warnings: details.warnings });
      else setError({ message: errorMessage(err), list: details?.errors ?? [] });
    } finally {
      setBusy(false);
    }
  }
  const review = (ack = false) =>
    run(
      'review',
      { note: note.trim() || undefined, acknowledgeWarnings: ack },
      'Laporan diperiksa.',
    );
  const finalize = (ack = false) =>
    run(
      'finalize',
      { acknowledgeWarnings: ack },
      'Laporan difinalkan; progres minggu ini dan sebelumnya terkunci.',
    );

  return (
    <div className="mt-3 space-y-4">
      <Section
        title={
          <>
            Laporan mingguan M.{summary.weekNumber}{' '}
            {status ? (
              <Badge tone={WEEKLY_STATUS_BADGE[status].tone}>
                {WEEKLY_STATUS_BADGE[status].label}
              </Badge>
            ) : (
              <Badge>Belum diajukan</Badge>
            )}
          </>
        }
        action={
          <div className="row-actions">
            <Link
              className="btn btn-secondary"
              href={
                officeWorkbook
                  ? `/api/projects/${projectId}/exports/weekly/${summary.weekNumber}/pdf`
                  : `/print/projects/${projectId}/weekly/${summary.weekNumber}`
              }
              target="_blank"
              prefetch={false}
            >
              Ekspor PDF
            </Link>
            <a
              className="btn btn-secondary"
              href={`/api/projects/${projectId}/exports/weekly/${summary.weekNumber}`}
            >
              Ekspor Excel
            </a>
          </div>
        }
        description={`${formatDate(c.week.startDate)} – ${formatDate(c.week.endDate)} · Baseline ${c.baseline?.label ?? 'belum ada'}`}
      >
        <div className="space-y-3">
          {report && (
            <ol className="report-steps">
              <li>
                Diajukan {report.submittedBy.name}, {dateTime(report.submittedAt)}
              </li>
              {report.reviewedBy && report.reviewedAt && (
                <li>
                  Diperiksa {report.reviewedBy.name}, {dateTime(report.reviewedAt)}
                  {report.reviewNote && <q className="ml-1 text-slate-600">{report.reviewNote}</q>}
                </li>
              )}
              {report.finalizedBy && report.finalizedAt && (
                <li>
                  Final oleh {report.finalizedBy.name}, {dateTime(report.finalizedAt)}
                  {status === 'REOPENED' && ' (lalu dibuka kembali)'}
                </li>
              )}
            </ol>
          )}
          {data.fromSnapshot && (
            <Alert kind="info">
              Ditampilkan dari snapshot final; perubahan data sesudahnya tidak mengubah laporan ini.
            </Alert>
          )}
          {!summary.ended && (
            <Alert kind="info">
              Minggu ini belum berakhir; laporan dapat diajukan mulai {formatDate(summary.endDate)}.
            </Alert>
          )}
          {!data.fromSnapshot && issues.errors.length > 0 && (
            <Alert>
              Belum dapat diajukan atau diperiksa:
              <ul className="mt-1 list-disc pl-5">
                {issues.errors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          {!data.fromSnapshot && issues.warnings.length > 0 && (
            <Alert kind="warning">
              Peringatan (boleh dilanjutkan dengan konfirmasi):
              <ul className="mt-1 list-disc pl-5">
                {issues.warnings.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          {notice && <Alert kind="success">{notice}</Alert>}
          {error && (
            <Alert>
              {error.message}
              {error.list.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {error.list.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}

          {confirm ? (
            <div className="space-y-2">
              <Alert kind="warning">
                {confirm.step === 'review' ? 'Tetap tandai diperiksa' : 'Tetap finalkan'} walau ada
                peringatan berikut?
                <ul className="mt-1 list-disc pl-5">
                  {confirm.warnings.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </Alert>
              <div className="row-actions">
                <Button
                  disabled={busy}
                  onClick={() => void (confirm.step === 'review' ? review(true) : finalize(true))}
                >
                  {confirm.step === 'review' ? 'Ya, tandai diperiksa' : 'Ya, finalkan'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirm(undefined)}>
                  Batal
                </Button>
              </div>
            </div>
          ) : reopening ? (
            <InlineReasonForm
              id="reopen-weekly"
              title="Buka kembali laporan mingguan"
              description="Progres minggu ini dan sebelumnya bisa diubah lagi. Snapshot final lama tetap disimpan; laporan harus diperiksa dan difinalkan ulang."
              label="Alasan membuka kembali (wajib)"
              confirmLabel="Buka kembali"
              destructive
              busy={busy}
              onSubmit={(reason) => void run('reopen', { reason }, 'Laporan dibuka kembali.')}
              onCancel={() => setReopening(false)}
            />
          ) : (
            <div className="space-y-2">
              {(status === 'DRAFT' || status === 'REOPENED') &&
                can('report.review') &&
                !ownEntry && (
                  <div className="max-w-xl">
                    <label htmlFor="review-note" className="field-label">
                      Catatan pemeriksaan (opsional)
                    </label>
                    <textarea
                      id="review-note"
                      className="field"
                      rows={2}
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                )}
              <div className="row-actions">
                {status === null && summary.ended && can('progress.input') && (
                  <Button
                    disabled={busy || issues.errors.length > 0}
                    onClick={() => void run('submit', {}, 'Laporan diajukan untuk diperiksa.')}
                  >
                    Ajukan laporan
                  </Button>
                )}
                {(status === 'DRAFT' || status === 'REOPENED') && can('report.review') && (
                  <Button
                    disabled={busy || ownEntry || issues.errors.length > 0}
                    title={ownEntry ? 'Anda ikut mengisi progres minggu ini' : undefined}
                    onClick={() => void review()}
                  >
                    Tandai diperiksa
                  </Button>
                )}
                {status === 'REVIEWED' && can('report.finalize') && (
                  <Button
                    disabled={busy || issues.errors.length > 0}
                    onClick={() => void finalize()}
                  >
                    Finalkan
                  </Button>
                )}
                {status === 'FINAL' && can('report.reopen') && (
                  <Button variant="secondary" disabled={busy} onClick={() => setReopening(true)}>
                    Buka kembali
                  </Button>
                )}
              </div>
              {(status === 'DRAFT' || status === 'REOPENED') &&
                can('report.review') &&
                ownEntry && (
                  <p className="field-hint">
                    Anda ikut mengisi atau mengubah progres minggu ini, jadi pemeriksaan harus
                    dilakukan orang lain.
                  </p>
                )}
            </div>
          )}
        </div>
      </Section>

      <ReportBody projectId={projectId} content={c} code="M" />
    </div>
  );
}

/** D-081/D-087: report content shared by the weekly (M.n) and monthly (B.n) pages. */
export function ReportBody({
  projectId,
  content: c,
  code,
}: {
  projectId: string;
  content: WeeklyReportContent;
  code: 'M' | 'B';
}) {
  const now = code === 'M' ? 'minggu ini' : 'bulan ini';
  const prev = code === 'M' ? 'minggu lalu' : 'bulan lalu';
  const cap = code === 'M' ? 'Minggu ini' : 'Bulan ini';
  const total = (k: 'weight' | 'previous' | 'thisWeek' | 'cumulative') =>
    c.recap.reduce((t, r) => t.plus(r[k] ?? 0), new Decimal(0)).toFixed();
  const deviationNegative = c.totals.deviation?.startsWith('-');
  return (
    <>
      <Section
        title="Ringkasan"
        description="Persentase terhadap bobot proyek, seperti lembar RM kantor."
      >
        <dl className="analysis-stats">
          <div>
            <dt>
              Realisasi s.d. {code}.{c.week.weekNumber}
            </dt>
            <dd>{pct(c.totals.actualCumulative)}</dd>
            <span>
              {now} {pct(c.totals.actualThisWeek)}
            </span>
          </div>
          <div>
            <dt>
              Rencana s.d. {code}.{c.week.weekNumber}
            </dt>
            <dd>{pct(c.totals.plannedCumulative)}</dd>
            <span>
              {now} {pct(c.totals.plannedThisWeek)}
            </span>
          </div>
          <div>
            <dt>Deviasi</dt>
            <dd className={deviationNegative ? 'text-red-700' : undefined}>
              {pct(c.totals.deviation)}
            </dd>
            <span>
              {c.totals.deviation === null
                ? 'jadwal belum approved'
                : deviationNegative
                  ? 'terlambat dari rencana'
                  : 'sesuai atau lebih cepat'}
            </span>
          </div>
          <div>
            <dt>Waktu pelaksanaan</dt>
            <dd>{c.totals.durationDays} hari</dd>
            <span>
              terpakai {c.totals.usedDays} hari, sisa {c.totals.remainingDays} hari
            </span>
          </div>
        </dl>
      </Section>

      {c.curve.rows.length > 0 && (
        <Section
          title={`Kurva S s.d. ${code}.${c.week.weekNumber}`}
          action={<SCurveLegend />}
          body={false}
        >
          <SCurveSheet data={c.curve} />
        </Section>
      )}

      <Section
        title="Rekap progres per kelompok"
        description="Prestasi pekerjaan (%) terhadap bobot proyek (lembar RM)."
        body={false}
      >
        {c.recap.length === 0 ? (
          <p className="surface-body text-sm text-slate-500">
            Rekap per kelompok tampil setelah jadwal versi baseline di-approve.
          </p>
        ) : (
          <details className="surface-body">
            <summary className="cursor-pointer text-sm font-medium">
              Tampilkan rekap {c.recap.filter((r) => r.weight !== null).length} pekerjaan · total
              s.d. {now} {formatRounded(total('cumulative'), DECIMALS.weight)}%
            </summary>
            <div className="data-panel mt-3">
              <table role="table" className="data-table report-recap">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">
                      No
                    </th>
                    <th role="columnheader" scope="col">
                      Pekerjaan
                    </th>
                    <th role="columnheader" scope="col" className="num">
                      Bobot (%)
                    </th>
                    <th role="columnheader" scope="col" className="num">
                      s.d. {prev}
                    </th>
                    <th role="columnheader" scope="col" className="num">
                      {cap}
                    </th>
                    <th role="columnheader" scope="col" className="num">
                      s.d. {now}
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {c.recap.map((r) =>
                    r.weight === null ? (
                      <tr role="row" key={r.id} className="period-row">
                        <th role="cell" scope="colgroup" colSpan={6}>
                          {r.displayNumber} {r.description}
                        </th>
                      </tr>
                    ) : (
                      <tr role="row" key={r.id}>
                        <td role="cell" data-label="No">
                          {r.displayNumber}
                        </td>
                        <td role="cell" data-label="Pekerjaan">
                          {r.description}
                        </td>
                        <td role="cell" data-label="Bobot (%)" className="num">
                          {formatRounded(r.weight, DECIMALS.weight)}
                        </td>
                        <td role="cell" data-label={`s.d. ${prev}`} className="num">
                          {formatRounded(r.previous, DECIMALS.weight)}
                        </td>
                        <td role="cell" data-label={cap} className="num">
                          {formatRounded(r.thisWeek, DECIMALS.weight)}
                        </td>
                        <td role="cell" data-label={`s.d. ${now}`} className="num">
                          {formatRounded(r.cumulative, DECIMALS.weight)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
                <tfoot role="rowgroup">
                  <tr role="row">
                    <th role="cell" colSpan={2}>
                      Jumlah
                    </th>
                    <td role="cell" data-label="Bobot (%)" className="num">
                      {formatRounded(total('weight'), DECIMALS.weight)}
                    </td>
                    <td role="cell" data-label={`s.d. ${prev}`} className="num">
                      {formatRounded(total('previous'), DECIMALS.weight)}
                    </td>
                    <td role="cell" data-label={cap} className="num">
                      {formatRounded(total('thisWeek'), DECIMALS.weight)}
                    </td>
                    <td role="cell" data-label={`s.d. ${now}`} className="num">
                      {formatRounded(total('cumulative'), DECIMALS.weight)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        )}
      </Section>

      <Section
        title="Rangkuman laporan harian"
        description={`Jumlah dari laporan harian ${now} (angka aktual).`}
      >
        <div className="space-y-4">
          <DayStrip
            projectId={projectId}
            days={c.daily.days.map((d, i) => ({ ...d, day: i + 1, open: true }))}
          />
          <p className="text-sm text-slate-600">
            Cuaca:{' '}
            {c.daily.weather.length === 0
              ? 'belum diisi'
              : c.daily.weather
                  .map((w) => `${WEATHER_LABELS[w.condition]} ${w.days} hari`)
                  .join(', ')}
            . Hari hujan/gerimis: {c.daily.rainDays}.
          </p>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Tampilkan {c.daily.labor.length} tenaga kerja dan {c.daily.resources.length}{' '}
              bahan/alat
            </summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <SummaryTable
                dp={0}
                title="Tenaga kerja (orang-hari)"
                rows={c.daily.labor.map((l) => ({
                  key: l.name,
                  name: l.name,
                  unit: l.unit,
                  total: l.total,
                }))}
                empty="Belum ada tenaga kerja di laporan harian."
              />
              <SummaryTable
                title="Bahan dan alat"
                rows={c.daily.resources.map((r) => ({
                  key: `${r.category}${r.name}${r.unit}`,
                  name: `${r.category === 'MATERIAL' ? 'Bahan' : 'Alat'} · ${r.name}`,
                  unit: r.unit,
                  total: r.total,
                }))}
                empty="Belum ada bahan atau alat aktual."
              />
            </div>
          </details>
        </div>
      </Section>

      <Section title="Detail progres item" body={false}>
        <details className="surface-body">
          <summary className="cursor-pointer text-sm font-medium">
            Tampilkan {c.items.filter((r) => r.workItemId).length} item (lembar M)
          </summary>
          <div className="data-panel mt-3">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    No
                  </th>
                  <th role="columnheader" scope="col">
                    Uraian
                  </th>
                  <th role="columnheader" scope="col">
                    Sat.
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Volume
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    s.d. lalu
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    {cap}
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    s.d. ini
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    %
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {c.items.map((r) => (
                  <tr
                    role="row"
                    key={r.id}
                    className={r.rowType === 'ITEM' ? undefined : 'font-semibold'}
                  >
                    <td role="cell" data-label="No">
                      {r.displayNumber}
                    </td>
                    <td
                      role="cell"
                      data-label="Uraian"
                      style={{ paddingLeft: `${0.75 + r.depth * 0.75}rem` }}
                    >
                      {r.description}
                    </td>
                    <td role="cell" data-label="Sat.">
                      {r.unit}
                    </td>
                    <td role="cell" data-label="Volume" className="num">
                      {r.baselineVolume === null
                        ? ''
                        : formatRounded(r.baselineVolume, DECIMALS.volume)}
                    </td>
                    <td role="cell" data-label="s.d. lalu" className="num">
                      {r.workItemId ? formatRounded(r.previousCumulative, DECIMALS.volume) : ''}
                    </td>
                    <td role="cell" data-label={cap} className="num">
                      {r.thisWeek ? formatRounded(r.thisWeek.volume, DECIMALS.volume) : ''}
                    </td>
                    <td role="cell" data-label="s.d. ini" className="num">
                      {r.workItemId ? formatRounded(r.cumulative, DECIMALS.volume) : ''}
                    </td>
                    <td role="cell" data-label="%" className="num">
                      {r.percent === null ? '' : formatRounded(r.percent, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>
    </>
  );
}

function SummaryTable({
  title,
  rows,
  empty,
  dp = 2,
}: {
  title: string;
  rows: { key: string; name: string; unit: string | null; total: string }[];
  empty: string;
  /** People counts are whole; quantities use the report's 2 decimals. */
  dp?: number;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <table role="table" className="data-table">
          <tbody role="rowgroup">
            {rows.map((r) => (
              <tr role="row" key={r.key}>
                <td role="cell">{r.name}</td>
                <td role="cell" className="num">
                  {formatRounded(r.total, dp)}
                </td>
                <td role="cell">{r.unit ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
