'use client';

import { addDays, Decimal, parseIdNumber } from '@laporan-proyek/calc';
import {
  WEATHER_CONDITIONS,
  WEATHER_LABELS,
  type DailyReportDto,
  type DailyResourceLineDto,
  type ResourceCategoryCode,
  type SaveDailyReportInput,
  type WeatherCondition,
  DECIMALS,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { useLeaveWarning } from '@/components/grid-tools';
import { Alert, Badge, Button, Section, Select, SuggestInput } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/project-fields';
import { DAILY_STATUS_BADGE } from '@/lib/rab-ui';

type Line = DailyResourceLineDto & { draftKey: string };
type Weather = DailyReportDto['weather'][number];
const QTY = /^\d{1,18}(\.\d{1,12})?$/;
const normalized = parseIdNumber;
/** Editable value: Indonesian decimal comma, no thousands dots, so it reads back unchanged. */
const toInput = (v: string) => new Decimal(v).toFixed().replace('.', ',');
/** Quantities show DECIMALS.volume (D-083); raw API value in, display text out. */
const short = (v: string | null) =>
  v === null
    ? '–'
    : formatNumber(
        new Decimal(v)
          .toDecimalPlaces(DECIMALS.volume, Decimal.ROUND_HALF_UP)
          .toFixed(DECIMALS.volume),
      );
/** Display of a typed value (read-only views). */
const shownTyped = (v: string | null) =>
  v && QTY.test(normalized(v)) ? short(normalized(v)) : (v ?? '');
let seq = 0;
const withKeys = (lines: DailyResourceLineDto[]): Line[] =>
  lines.map((l) => ({
    ...l,
    draftKey: `k${seq++}`,
    actual: l.actual === null ? null : toInput(l.actual),
  }));

/** D-079: one project day — work from the allocation, labor, materials/equipment (AHSP vs actual), weather. */
const COLUMN: Record<ResourceCategoryCode, string> = {
  LABOR: 'Keahlian',
  MATERIAL: 'Bahan',
  EQUIPMENT: 'Alat',
};
/** Per-viewer display filter for tiny AHSP lines (D-079 butir 8); empty = show all. */
const MIN_KEY = 'daily-report-min-shown';
const DEFAULT_MIN: Record<ResourceCategoryCode, string> = {
  LABOR: '0.5',
  MATERIAL: '',
  EQUIPMENT: '',
};

export function DailyReportEditor({
  projectId,
  initial,
  canInput,
  canReopen,
  officePdf,
}: {
  projectId: string;
  initial: DailyReportDto;
  canInput: boolean;
  canReopen: boolean;
  /** D-088: print the office workbook's page for this day instead of the template layout. */
  officePdf: boolean;
}) {
  const [data, setData] = useState(initial);
  const [lines, setLines] = useState(() => withKeys(initial.resources));
  const [weather, setWeather] = useState<Weather[]>(initial.weather);
  const [note, setNote] = useState(initial.note ?? '');
  const [dirty, setDirty] = useState(Boolean(initial.prefilledFrom));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; list: string[] }>();
  const [notice, setNotice] = useState<string>();
  const [confirmWarnings, setConfirmWarnings] = useState<string[]>();
  const [reopening, setReopening] = useState(false);
  const [minShown, setMinShown] = useState(DEFAULT_MIN);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(MIN_KEY) ?? 'null');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser storage once after hydration
      if (saved) setMinShown({ ...DEFAULT_MIN, ...saved });
    } catch {
      // storage unavailable: keep defaults
    }
  }, []);
  const setMin = (category: ResourceCategoryCode, value: string) => {
    const next = { ...minShown, [category]: value };
    setMinShown(next);
    try {
      window.localStorage.setItem(MIN_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the filter still applies for this visit
    }
  };
  useLeaveWarning(dirty);

  const status = data.report?.status ?? null;
  const editable = canInput && data.open && status !== 'FINAL';
  const base = `/projects/${projectId}/daily-reports/${data.date}`;

  function load(d: DailyReportDto, message: string) {
    setData(d);
    setLines(withKeys(d.resources));
    setWeather(d.weather);
    setNote(d.note ?? '');
    setDirty(false);
    setNotice(message);
  }
  const change =
    <T,>(setter: (fn: (v: T) => T) => void) =>
    (fn: (v: T) => T) => {
      setter(fn);
      setDirty(true);
    };
  const editLines = change(setLines);
  const editWeather = change(setWeather);

  const invalid = lines.filter((l) => l.actual && !QTY.test(normalized(l.actual)));
  async function run(action: () => Promise<DailyReportDto>, message: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      load(await action(), message);
      setConfirmWarnings(undefined);
      setReopening(false);
    } catch (err) {
      const details =
        err instanceof ApiError
          ? (err.details as { errors?: unknown; warnings?: unknown } | undefined)
          : undefined;
      if (Array.isArray(details?.warnings))
        setConfirmWarnings(details.warnings.filter((w): w is string => typeof w === 'string'));
      else
        setError({
          message: errorMessage(err),
          list: Array.isArray(details?.errors)
            ? details.errors.filter((e): e is string => typeof e === 'string')
            : [],
        });
    } finally {
      setBusy(false);
    }
  }
  const payload = (): SaveDailyReportInput => ({
    baseUpdatedAt: data.report?.updatedAt ?? null,
    note: note.trim() || undefined,
    resources: lines
      .filter((l) => l.name.trim())
      .map((l) => ({
        category: l.category,
        sourceKey: l.sourceKey ?? undefined,
        name: l.name.trim(),
        unit: l.unit?.trim() || undefined,
        actual: l.actual?.trim() ? normalized(l.actual) : undefined,
        note: l.note?.trim() || undefined,
      })),
    weather: weather.map((w) => ({
      condition: w.condition,
      fromTime: w.fromTime || undefined,
      toTime: w.toTime || undefined,
      note: w.note?.trim() || undefined,
    })),
  });
  const save = () =>
    run(() => api<DailyReportDto>('PUT', base, payload()), 'Laporan harian disimpan.');
  const finalize = (acknowledgeWarnings: boolean) =>
    run(
      () => api<DailyReportDto>('POST', `${base}/finalize`, { acknowledgeWarnings }),
      'Laporan harian difinalkan.',
    );

  const addLine = (category: ResourceCategoryCode) =>
    editLines((ls) => [
      ...ls,
      {
        id: null,
        category,
        sourceKey: null,
        name: '',
        unit: category === 'LABOR' ? 'Org' : null,
        calculated: null,
        actual: null,
        note: null,
        draftKey: `k${seq++}`,
      },
    ]);
  const setLine = (key: string, patch: Partial<Line>) =>
    editLines((ls) => ls.map((l) => (l.draftKey === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => editLines((ls) => ls.filter((l) => l.draftKey !== key));
  const laborTotal = lines
    .filter((l) => l.category === 'LABOR')
    .reduce(
      (t, l) => (l.actual && QTY.test(normalized(l.actual)) ? t.plus(normalized(l.actual)) : t),
      new Decimal(0),
    );
  const dayName = new Date(`${data.date}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const prev = addDays(data.date, -1);
  const next = addDays(data.date, 1);
  const first = data.week.weekNumber === 1 && data.day === 1;

  const resourceSection = (category: ResourceCategoryCode, title: string, description: string) => {
    const all = lines.filter((l) => l.category === category);
    const min = normalized(minShown[category]);
    // Typed lines and lines with an actual stay visible; only small, untouched AHSP lines hide.
    const rows = QTY.test(min)
      ? all.filter((l) => !l.sourceKey || l.actual || new Decimal(l.calculated ?? 0).gte(min))
      : all;
    const hidden = all.length - rows.length;
    return (
      <Section
        title={title}
        description={description}
        body={false}
        action={
          <div className="row-actions">
            <label className="flex items-center gap-1 text-sm text-slate-600">
              Sembunyikan hitungan &lt;
              <input
                className="field grid-input"
                style={{ width: '4.5rem' }}
                inputMode="decimal"
                aria-label={`Sembunyikan ${COLUMN[category].toLowerCase()} dengan hitungan di bawah`}
                placeholder="–"
                value={minShown[category]}
                onChange={(e) => setMin(category, e.target.value)}
              />
            </label>
            {editable && (
              <Button type="button" variant="secondary" onClick={() => addLine(category)}>
                + Tambah baris
              </Button>
            )}
          </div>
        }
      >
        {hidden > 0 && (
          <p className="surface-body text-sm text-slate-500">
            {hidden} baris dengan hitungan di bawah {minShown[category]} disembunyikan.{' '}
            <button type="button" className="link-button" onClick={() => setMin(category, '')}>
              Tampilkan semua
            </button>
          </p>
        )}
        {rows.length === 0 ? (
          hidden > 0 ? null : (
            <p className="surface-body text-sm text-slate-500">
              {category === 'LABOR'
                ? 'Tidak ada tenaga kerja terhitung dari AHSP; tambah tenaga yang bekerja bila perlu.'
                : category === 'MATERIAL'
                  ? 'Tidak ada bahan terhitung untuk pekerjaan hari ini.'
                  : 'Tidak ada alat terhitung; tambah alat yang dipakai bila perlu.'}
            </p>
          )
        ) : (
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    {COLUMN[category]}
                  </th>
                  <th role="columnheader" scope="col">
                    Sat.
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Hitungan AHSP
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Aktual
                  </th>
                  <th role="columnheader" scope="col">
                    Catatan
                  </th>
                  {editable && <th role="columnheader" scope="col" aria-label="Aksi" />}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((l) => (
                  <tr role="row" key={l.draftKey}>
                    <td role="cell" data-label={COLUMN[category]}>
                      {!editable ? (
                        l.name
                      ) : (
                        <SuggestInput
                          aria-label="Nama"
                          suggestions={category === 'LABOR' ? data.laborOptions : []}
                          placeholder={
                            category === 'LABOR' ? 'mis. Pekerja, Tukang Batu, Mandor' : undefined
                          }
                          value={l.name}
                          maxLength={500}
                          onChange={(name) => setLine(l.draftKey, { name })}
                        />
                      )}
                    </td>
                    <td role="cell" data-label="Sat.">
                      {!editable ? (
                        (l.unit ?? '')
                      ) : (
                        <input
                          className="field w-20"
                          aria-label="Satuan"
                          value={l.unit ?? ''}
                          maxLength={30}
                          onChange={(e) => setLine(l.draftKey, { unit: e.target.value })}
                        />
                      )}
                    </td>
                    <td
                      role="cell"
                      data-label="Hitungan AHSP"
                      className="num"
                      title={l.calculated ?? undefined}
                    >
                      {l.sourceKey ? (
                        short(l.calculated)
                      ) : (
                        <span className="text-slate-500">manual</span>
                      )}
                    </td>
                    <td role="cell" data-label="Aktual" className="num">
                      {editable ? (
                        <>
                          <input
                            className="field schedule-cell grid-input"
                            inputMode="decimal"
                            aria-label={`${l.name} aktual`}
                            aria-invalid={Boolean(l.actual && !QTY.test(normalized(l.actual)))}
                            placeholder={l.calculated ? short(l.calculated) : '0'}
                            value={l.actual ?? ''}
                            onChange={(e) => setLine(l.draftKey, { actual: e.target.value })}
                          />
                          {l.sourceKey && l.calculated && !l.actual && (
                            <button
                              type="button"
                              className="link-button block text-xs"
                              onClick={() =>
                                setLine(l.draftKey, {
                                  // People are whole: labor rounds half up (D-079 butir 5).
                                  actual:
                                    category === 'LABOR'
                                      ? new Decimal(l.calculated!)
                                          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
                                          .toFixed()
                                      : toInput(
                                          new Decimal(l.calculated!)
                                            .toDecimalPlaces(DECIMALS.volume, Decimal.ROUND_HALF_UP)
                                            .toFixed(),
                                        ),
                                })
                              }
                            >
                              pakai hitungan
                            </button>
                          )}
                        </>
                      ) : (
                        shownTyped(l.actual) || '–'
                      )}
                    </td>
                    <td role="cell" data-label="Catatan">
                      {editable ? (
                        <input
                          className="field"
                          aria-label={`${l.name} catatan`}
                          value={l.note ?? ''}
                          maxLength={1000}
                          onChange={(e) => setLine(l.draftKey, { note: e.target.value })}
                        />
                      ) : (
                        (l.note ?? '')
                      )}
                    </td>
                    {editable && (
                      <td role="cell" data-label="Aksi">
                        {!l.sourceKey && (
                          <Button
                            type="button"
                            variant="secondary"
                            aria-label={`Hapus ${l.name || 'baris'}`}
                            onClick={() => removeLine(l.draftKey)}
                          >
                            Hapus
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    );
  };

  return (
    <div className="mt-3 space-y-4">
      <Section
        title={
          <>
            Laporan harian {dayName}, {formatDate(data.date)}{' '}
            {status ? (
              <Badge tone={DAILY_STATUS_BADGE[status].tone}>
                {DAILY_STATUS_BADGE[status].label}
              </Badge>
            ) : (
              <Badge>Belum dibuat</Badge>
            )}
          </>
        }
        description={
          <>
            Minggu {data.week.weekNumber} hari ke-{data.day} · Baseline{' '}
            {data.week.baseline?.label ?? 'belum ada'}
            {data.report && ` · diubah ${data.report.updatedBy.name}`}
            {data.report?.finalizedBy && ` · difinalkan ${data.report.finalizedBy.name}`}
          </>
        }
        action={
          <div className="row-actions">
            {!first ? (
              <Link className="btn btn-secondary" href={`/projects/${projectId}/daily/${prev}`}>
                ← Kemarin
              </Link>
            ) : null}
            <Link className="btn btn-secondary" href={`/projects/${projectId}/daily/${next}`}>
              Besok →
            </Link>
            {data.report && (
              <Link
                className="btn btn-secondary"
                href={
                  officePdf
                    ? `/api/projects/${projectId}/exports/daily/${data.date}/pdf`
                    : `/print/projects/${projectId}/daily/${data.date}`
                }
                target="_blank"
                prefetch={false}
              >
                Ekspor PDF
              </Link>
            )}
            {data.report && (
              <a
                className="btn btn-secondary"
                href={`/api/projects/${projectId}/exports/daily/${data.date}`}
              >
                Ekspor Excel
              </a>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {data.locked ? (
            <Alert kind="info">
              Minggu {data.week.weekNumber} terkunci karena laporan mingguan sudah final. Untuk
              merevisi laporan harian ini, buka kembali laporan mingguannya dulu.
            </Alert>
          ) : (
            !data.open && (
              <Alert kind="info">
                Tanggal ini belum tiba atau proyek sudah ditutup; laporan belum dapat diisi.
              </Alert>
            )
          )}
          {status === 'FINAL' && !reopening && (
            <Alert kind="success">
              Laporan sudah final
              {data.report?.finalizedBy &&
                ` (${data.report.finalizedBy.name}${data.report.finalizedAt ? `, ${new Date(data.report.finalizedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''})`}
              . Isinya terkunci; gunakan <b>Revisi</b> untuk membukanya kembali.
            </Alert>
          )}
          {status === 'REOPENED' && (
            <Alert kind="warning">
              Laporan sedang direvisi. Ubah isian, simpan, lalu finalkan lagi.
            </Alert>
          )}
          {data.prefilledFrom && (
            <Alert kind="info">
              Tenaga kerja dan alat diisi awal dari laporan {formatDate(data.prefilledFrom)}.
              Periksa lalu simpan.
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
          {data.issues.errors.length > 0 && (
            <Alert>
              Belum dapat difinalkan:
              <ul className="mt-1 list-disc pl-5">
                {data.issues.errors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          {confirmWarnings && (
            <Alert kind="warning">
              Finalkan walau ada peringatan?
              <ul className="mt-1 list-disc pl-5">
                {confirmWarnings.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <div className="row-actions mt-2">
                <Button type="button" disabled={busy} onClick={() => void finalize(true)}>
                  Ya, finalkan
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmWarnings(undefined)}
                >
                  Batal
                </Button>
              </div>
            </Alert>
          )}
          {reopening && (
            <InlineReasonForm
              id="daily-reopen-reason"
              title="Revisi laporan harian"
              description="Laporan dibuka kembali untuk diubah. Isi final sebelumnya tercatat di riwayat audit; laporan harus difinalkan lagi setelah diubah."
              label="Alasan revisi (wajib)"
              confirmLabel="Buka untuk revisi"
              busy={busy}
              onSubmit={(reason) =>
                void run(
                  () => api<DailyReportDto>('POST', `${base}/reopen`, { reason }),
                  'Laporan dibuka untuk revisi.',
                )
              }
              onCancel={() => setReopening(false)}
            />
          )}
          <div className="row-actions">
            {editable && (
              <>
                <Button
                  type="button"
                  disabled={busy || !dirty || invalid.length > 0}
                  onClick={() => void save()}
                >
                  {busy ? 'Menyimpan…' : 'Simpan laporan'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || dirty || !data.report || data.issues.errors.length > 0}
                  title={dirty ? 'Simpan dulu' : !data.report ? 'Simpan laporan dulu' : undefined}
                  onClick={() => void finalize(false)}
                >
                  Finalkan
                </Button>
              </>
            )}
            {status === 'FINAL' && !reopening && (
              <Button
                type="button"
                variant="secondary"
                disabled={!canReopen || !data.open}
                title={
                  !canReopen
                    ? 'Revisi laporan final butuh izin buka kembali laporan (bawaan: MANAGER).'
                    : data.locked
                      ? 'Buka kembali laporan mingguan minggu ini dulu.'
                      : !data.open
                        ? 'Proyek sudah ditutup.'
                        : undefined
                }
                onClick={() => setReopening(true)}
              >
                Revisi
              </Button>
            )}
          </div>
          {status === 'FINAL' && !canReopen && (
            <p className="field-hint">
              Minta MANAGER (izin buka kembali laporan) untuk merevisi laporan final.
            </p>
          )}
          {invalid.length > 0 && (
            <p className="field-error">
              Jumlah aktual berupa angka ≥ 0 (koma atau titik untuk desimal).
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Pekerjaan hari ini"
        description="Dari alokasi harian progres mingguan. Volume dikoreksi di alokasi harian; total minggu tetap sama dengan progres mingguan."
        body={false}
        action={
          <Link
            className="btn btn-secondary"
            href={`/projects/${projectId}/progress/${data.week.weekNumber}/daily`}
          >
            Alokasi harian M.{data.week.weekNumber}
          </Link>
        }
      >
        {data.work.length === 0 ? (
          <p className="surface-body text-sm text-slate-500">
            Tidak ada pekerjaan pada tanggal ini. Isi progres minggu {data.week.weekNumber} dulu.
          </p>
        ) : (
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    No
                  </th>
                  <th role="columnheader" scope="col">
                    Kegiatan
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Volume
                  </th>
                  <th role="columnheader" scope="col">
                    Sat.
                  </th>
                  <th role="columnheader" scope="col">
                    Analisa
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.work.map((w, i) => (
                  <tr role="row" key={w.workItemId}>
                    <td role="cell" data-label="No">
                      {i + 1}
                    </td>
                    <td role="cell" data-label="Kegiatan">
                      <span>
                        {w.description} {w.method === 'MANUAL' && <Badge tone="blue">manual</Badge>}
                      </span>
                    </td>
                    <td role="cell" data-label="Volume" className="num" title={w.volume}>
                      {short(w.volume)}
                    </td>
                    <td role="cell" data-label="Sat.">
                      {w.unit ?? ''}
                    </td>
                    <td role="cell" data-label="Analisa">
                      {w.analysis ?? <span className="text-slate-500">tanpa AHSP</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {resourceSection(
        'LABOR',
        'Tenaga kerja',
        `Hitungan AHSP = volume pekerjaan hari ini × koefisien upah (orang-hari). Isi jumlah orang yang bekerja. Total aktual ${formatNumber(laborTotal.toFixed(), { trim: true })} orang.`,
      )}
      {resourceSection(
        'MATERIAL',
        'Penggunaan bahan',
        'Hitungan AHSP = volume pekerjaan hari ini × koefisien analisa (termasuk sub-analisa). Isi jumlah aktual yang dipakai.',
      )}
      {resourceSection(
        'EQUIPMENT',
        'Peralatan',
        'Hitungan AHSP dari analisa; tambah alat kerja lain yang dipakai (mis. cangkul, gerinda).',
      )}

      <Section
        title="Cuaca"
        description="Kondisi dan jam berlakunya; bisa lebih dari satu dalam sehari."
        body={false}
        action={
          editable && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                editWeather((ws) => [
                  ...ws,
                  { condition: 'CLEAR', fromTime: '08:00', toTime: '17:00', note: null },
                ])
              }
            >
              + Tambah cuaca
            </Button>
          )
        }
      >
        {weather.length === 0 ? (
          <p className="surface-body text-sm text-slate-500">Belum ada catatan cuaca.</p>
        ) : (
          <div className="surface-body space-y-2">
            {weather.map((w, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                {editable ? (
                  <>
                    <Select
                      aria-label="Kondisi"
                      value={w.condition}
                      onChange={(e) =>
                        editWeather((ws) =>
                          ws.map((x, j) =>
                            j === i ? { ...x, condition: e.target.value as WeatherCondition } : x,
                          ),
                        )
                      }
                    >
                      {WEATHER_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {WEATHER_LABELS[c]}
                        </option>
                      ))}
                    </Select>
                    <input
                      className="field w-28"
                      type="time"
                      aria-label="Dari jam"
                      value={w.fromTime ?? ''}
                      onChange={(e) =>
                        editWeather((ws) =>
                          ws.map((x, j) =>
                            j === i ? { ...x, fromTime: e.target.value || null } : x,
                          ),
                        )
                      }
                    />
                    <span className="pb-2 text-sm">s.d.</span>
                    <input
                      className="field w-28"
                      type="time"
                      aria-label="Sampai jam"
                      value={w.toTime ?? ''}
                      onChange={(e) =>
                        editWeather((ws) =>
                          ws.map((x, j) =>
                            j === i ? { ...x, toTime: e.target.value || null } : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="field min-w-48 flex-1"
                      aria-label="Catatan cuaca"
                      placeholder="Catatan"
                      value={w.note ?? ''}
                      maxLength={500}
                      onChange={(e) =>
                        editWeather((ws) =>
                          ws.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => editWeather((ws) => ws.filter((_, j) => j !== i))}
                    >
                      Hapus
                    </Button>
                  </>
                ) : (
                  <p className="text-sm">
                    <b>{WEATHER_LABELS[w.condition]}</b>{' '}
                    {w.fromTime && `${w.fromTime}–${w.toTime ?? ''}`} {w.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Catatan">
        {editable ? (
          <textarea
            className="field min-h-24 w-full"
            aria-label="Catatan laporan"
            value={note}
            maxLength={5000}
            onChange={(e) => {
              setNote(e.target.value);
              setDirty(true);
            }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{note || '–'}</p>
        )}
      </Section>
    </div>
  );
}
