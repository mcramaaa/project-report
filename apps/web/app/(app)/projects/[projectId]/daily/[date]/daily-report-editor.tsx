'use client';

import { addDays, Decimal } from '@laporan-proyek/calc';
import {
  WEATHER_CONDITIONS,
  WEATHER_LABELS,
  type DailyReportDto,
  type DailyResourceLineDto,
  type ResourceCategoryCode,
  type SaveDailyReportInput,
  type WeatherCondition,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { useState } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { useLeaveWarning } from '@/components/grid-tools';
import { Alert, Badge, Button, Section, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/project-fields';
import { DAILY_STATUS_BADGE } from '@/lib/rab-ui';

type Line = DailyResourceLineDto & { draftKey: string };
type Weather = DailyReportDto['weather'][number];
const QTY = /^\d{1,18}(\.\d{1,12})?$/;
/** Users type Indonesian decimals; the API takes a dot. */
const normalized = (v: string) => v.trim().replace(',', '.');
const shown = (v: string | null) =>
  v === null ? '' : formatNumber(new Decimal(v).toFixed(), { trim: true });
const short = (v: string | null) =>
  v === null
    ? '–'
    : formatNumber(new Decimal(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(), {
        trim: true,
      });
let seq = 0;
const withKeys = (lines: DailyResourceLineDto[]): Line[] =>
  lines.map((l) => ({
    ...l,
    draftKey: `k${seq++}`,
    actual: l.actual === null ? null : shown(l.actual),
  }));

/** D-079: one project day — work from the allocation, labor, materials/equipment (AHSP vs actual), weather. */
export function DailyReportEditor({
  projectId,
  initial,
  canInput,
  canReopen,
}: {
  projectId: string;
  initial: DailyReportDto;
  canInput: boolean;
  canReopen: boolean;
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

  const resourceSection = (
    category: 'MATERIAL' | 'EQUIPMENT',
    title: string,
    description: string,
  ) => {
    const rows = lines.filter((l) => l.category === category);
    return (
      <Section
        title={title}
        description={description}
        body={false}
        action={
          editable && (
            <Button type="button" variant="secondary" onClick={() => addLine(category)}>
              + Tambah baris
            </Button>
          )
        }
      >
        {rows.length === 0 ? (
          <p className="surface-body text-sm text-slate-500">
            {category === 'MATERIAL'
              ? 'Tidak ada bahan terhitung untuk pekerjaan hari ini.'
              : 'Tidak ada alat terhitung; tambah alat yang dipakai bila perlu.'}
          </p>
        ) : (
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    {category === 'MATERIAL' ? 'Bahan' : 'Alat'}
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
                    <td role="cell" data-label={category === 'MATERIAL' ? 'Bahan' : 'Alat'}>
                      {l.sourceKey || !editable ? (
                        l.name
                      ) : (
                        <input
                          className="field"
                          aria-label="Nama"
                          value={l.name}
                          maxLength={500}
                          onChange={(e) => setLine(l.draftKey, { name: e.target.value })}
                        />
                      )}
                    </td>
                    <td role="cell" data-label="Sat.">
                      {l.sourceKey || !editable ? (
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
                              onClick={() => setLine(l.draftKey, { actual: short(l.calculated) })}
                            >
                              pakai hitungan
                            </button>
                          )}
                        </>
                      ) : (
                        shown(l.actual) || '–'
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
          </div>
        }
      >
        <div className="space-y-3">
          {!data.open && (
            <Alert kind="info">
              Tanggal ini belum tiba atau proyek sudah ditutup; laporan belum dapat diisi.
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
              title="Buka kembali laporan harian"
              description="Isi final disimpan di riwayat audit. Laporan harus difinalkan lagi setelah diubah."
              label="Alasan membuka kembali (wajib)"
              confirmLabel="Buka kembali"
              busy={busy}
              onSubmit={(reason) =>
                void run(
                  () => api<DailyReportDto>('POST', `${base}/reopen`, { reason }),
                  'Laporan dibuka kembali.',
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
            {status === 'FINAL' && canReopen && data.open && !reopening && (
              <Button type="button" variant="secondary" onClick={() => setReopening(true)}>
                Buka kembali
              </Button>
            )}
          </div>
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

      <Section
        title="Tenaga kerja"
        description={`Jumlah orang per keahlian. Total ${formatNumber(laborTotal.toFixed(), { trim: true })} orang.`}
        body={false}
        action={
          editable && (
            <Button type="button" variant="secondary" onClick={() => addLine('LABOR')}>
              + Tambah tenaga
            </Button>
          )
        }
      >
        <datalist id="labor-options">
          {data.laborOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        {lines.filter((l) => l.category === 'LABOR').length === 0 ? (
          <p className="surface-body text-sm text-slate-500">Belum ada tenaga kerja.</p>
        ) : (
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Keahlian
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Jumlah
                  </th>
                  <th role="columnheader" scope="col">
                    Sat.
                  </th>
                  {editable && <th role="columnheader" scope="col" aria-label="Aksi" />}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {lines
                  .filter((l) => l.category === 'LABOR')
                  .map((l) => (
                    <tr role="row" key={l.draftKey}>
                      <td role="cell" data-label="Keahlian">
                        {editable ? (
                          <input
                            className="field"
                            list="labor-options"
                            aria-label="Keahlian"
                            placeholder="mis. Pekerja, Tukang Batu, Mandor"
                            value={l.name}
                            maxLength={500}
                            onChange={(e) => setLine(l.draftKey, { name: e.target.value })}
                          />
                        ) : (
                          l.name
                        )}
                      </td>
                      <td role="cell" data-label="Jumlah" className="num">
                        {editable ? (
                          <input
                            className="field schedule-cell grid-input"
                            inputMode="numeric"
                            aria-label={`${l.name} jumlah`}
                            value={l.actual ?? ''}
                            onChange={(e) => setLine(l.draftKey, { actual: e.target.value })}
                          />
                        ) : (
                          shown(l.actual)
                        )}
                      </td>
                      <td role="cell" data-label="Sat.">
                        {l.unit ?? 'Org'}
                      </td>
                      {editable && (
                        <td role="cell" data-label="Aksi">
                          <Button
                            type="button"
                            variant="secondary"
                            aria-label={`Hapus ${l.name || 'baris'}`}
                            onClick={() => removeLine(l.draftKey)}
                          >
                            Hapus
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

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
