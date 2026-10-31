'use client';

import { Decimal, progressSummary, weeklyVolumeFromPercent } from '@laporan-proyek/calc';
import type { ProgressInputMode, ProgressRowDto, WeeklyProgressDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Section, Select } from '@/components/ui';
import { GridTools, useLeaveWarning } from '@/components/grid-tools';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatNumber, formatRounded } from '@/lib/project-fields';

const VALID: Record<ProgressInputMode, RegExp> = {
  VOLUME_WEEK: /^\d{1,18}(\.\d{1,12})?$/,
  PERCENT_CUMULATIVE: /^\d{1,3}(\.\d{1,6})?$/,
};
/** Users type Indonesian decimals; the API takes a dot. */
const normalized = (v: string) => v.trim().replace(',', '.');
const volume = (v: string | null) =>
  formatNumber(v === null ? null : new Decimal(v).toFixed(), { trim: true });

/** What a typed value means for the row (same calc as the API, D-073); error when it cannot be saved. */
function preview(row: ProgressRowDto, mode: ProgressInputMode, raw: string) {
  const v = normalized(raw);
  if (!VALID[mode].test(v) || (mode === 'PERCENT_CUMULATIVE' && new Decimal(v).gt(100)))
    return {
      error:
        mode === 'VOLUME_WEEK' ? 'Angka ≥ 0, maks. 12 desimal' : 'Persen 0–100, maks. 6 desimal',
    };
  const weekly =
    mode === 'VOLUME_WEEK'
      ? new Decimal(v).toFixed()
      : weeklyVolumeFromPercent(v, row.baselineVolume!, row.previousCumulative);
  if (weekly === null) return { error: 'Lebih kecil dari kumulatif minggu lalu' };
  const s = progressSummary(row.previousCumulative, weekly, row.baselineVolume);
  return {
    weekly,
    ...s,
    error:
      s.remaining !== null && new Decimal(s.remaining).isNegative()
        ? 'Melebihi volume baseline'
        : undefined,
  };
}

/** Each row's ancestor group ids, from the depth-first order and depths the API sends. */
function ancestorsOf(rows: ProgressRowDto[]): Map<string, string[]> {
  const stack: ProgressRowDto[] = [];
  const out = new Map<string, string[]>();
  for (const r of rows) {
    while (stack.length && stack.at(-1)!.depth >= r.depth) stack.pop();
    out.set(
      r.id,
      stack.map((a) => a.id),
    );
    if (r.rowType !== 'ITEM') stack.push(r);
  }
  return out;
}

export function ProgressEditor({
  projectId,
  initial,
  canInput,
}: {
  projectId: string;
  initial: WeeklyProgressDto;
  canInput: boolean;
}) {
  const [data, setData] = useState(initial);
  const [mode, setMode] = useState<ProgressInputMode>('VOLUME_WEEK');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; list: string[] }>();
  const [notice, setNotice] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ancestors = useMemo(() => ancestorsOf(data.rows), [data.rows]);
  const parents = useMemo(() => new Set([...ancestors.values()].flat()), [ancestors]);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { week } = data;
  const editable = canInput && week.open && Boolean(week.baseline);
  const dirty = Object.values(drafts).some((v) => v.trim() !== '');
  useLeaveWarning(dirty);
  const base = `/projects/${projectId}`;

  async function save() {
    const rows = data.rows.filter((r) => r.workItemId && drafts[r.workItemId]?.trim());
    if (rows.some((r) => preview(r, mode, drafts[r.workItemId!]!).error)) {
      setError({ message: 'Perbaiki isian yang ditandai merah dulu.', list: [] });
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const entries = rows.map((r) => {
        const value = normalized(drafts[r.workItemId!]!);
        return mode === 'VOLUME_WEEK'
          ? { workItemId: r.workItemId, mode, volume: value }
          : { workItemId: r.workItemId, mode, percentage: value };
      });
      setData(
        await api<WeeklyProgressDto>('PUT', `${base}/progress/weeks/${week.weekNumber}`, {
          entries,
        }),
      );
      setDrafts({});
      setNotice(`Progres ${entries.length} item disimpan.`);
    } catch (err) {
      const list =
        err instanceof ApiError
          ? ((err.details as { errors?: unknown } | undefined)?.errors ?? [])
          : [];
      setError({
        message: errorMessage(err),
        list: Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [],
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-4">
      <Section
        title={`Progres minggu ${week.weekNumber}`}
        description={
          <>
            {formatDate(week.startDate)} – {formatDate(week.endDate)} · Baseline{' '}
            {week.baseline?.label ?? 'belum ada'} (versi yang berlaku di akhir minggu)
          </>
        }
        action={
          <div className="row-actions">
            {week.filledCount > 0 && (
              <Link
                className="btn btn-secondary"
                href={`${base}/progress/${week.weekNumber}/daily`}
              >
                Alokasi harian
              </Link>
            )}
            {week.weekNumber > 1 && (
              <Link className="btn btn-secondary" href={`${base}/progress/${week.weekNumber - 1}`}>
                ← M.{week.weekNumber - 1}
              </Link>
            )}
            <Link className="btn btn-secondary" href={`${base}/progress/${week.weekNumber + 1}`}>
              M.{week.weekNumber + 1} →
            </Link>
          </div>
        }
      >
        <div className="space-y-3">
          {!week.baseline && (
            <Alert kind="info">
              Minggu ini belum memiliki baseline. Aktifkan baseline di halaman RAB.
            </Alert>
          )}
          {!week.open && (
            <Alert kind="info">
              Minggu ini belum dimulai atau proyek sudah ditutup; progres belum dapat diisi.
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
          {editable && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="progress-mode" className="field-label">
                  Cara isi
                </label>
                <Select
                  id="progress-mode"
                  value={mode}
                  disabled={dirty}
                  title={dirty ? 'Simpan atau kosongkan isian dulu' : undefined}
                  onChange={(e) => setMode(e.target.value as ProgressInputMode)}
                >
                  <option value="VOLUME_WEEK">Volume minggu ini</option>
                  <option value="PERCENT_CUMULATIVE">% kumulatif (seperti Excel)</option>
                </Select>
              </div>
              <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
                {busy ? 'Menyimpan…' : 'Simpan progres'}
              </Button>
              {dirty && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDrafts({})}
                >
                  Batalkan isian
                </Button>
              )}
            </div>
          )}
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {parents.size > 0 ? (
          <div className="row-actions" role="group" aria-label="Kelompok pekerjaan">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCollapsed(new Set(parents))}
            >
              Ciutkan semua
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={collapsed.size === 0}
              onClick={() => setCollapsed(new Set())}
            >
              Buka semua
            </Button>
          </div>
        ) : (
          <span />
        )}
        <GridTools />
      </div>
      <div className="rab-grid-wrap">
        <table className="rab-grid">
          <thead>
            <tr>
              <th scope="col" className="rab-sticky-no">
                No
              </th>
              <th scope="col" className="rab-sticky-desc">
                Uraian
              </th>
              <th scope="col">Sat.</th>
              <th scope="col" className="num">
                Vol. baseline
              </th>
              <th scope="col" className="num">
                s.d. minggu lalu
              </th>
              <th scope="col" className="num">
                {mode === 'VOLUME_WEEK' || !editable ? 'Minggu ini' : '% kumulatif'}
              </th>
              <th scope="col" className="num">
                Kumulatif
              </th>
              <th scope="col" className="num">
                %
              </th>
              <th scope="col" className="num">
                Sisa
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              if (ancestors.get(r.id)!.some((a) => collapsed.has(a))) return null;
              if (r.rowType !== 'ITEM')
                return (
                  <tr key={r.id}>
                    <td className="rab-sticky-no font-semibold">{r.displayNumber ?? ''}</td>
                    <td
                      className="rab-sticky-desc font-semibold"
                      style={{ paddingLeft: 11 + r.depth * 14 }}
                      colSpan={8}
                    >
                      {parents.has(r.id) ? (
                        <button
                          type="button"
                          className="rab-toggle"
                          aria-expanded={!collapsed.has(r.id)}
                          aria-label={`${collapsed.has(r.id) ? 'Buka' : 'Ciutkan'} ${r.description}`}
                          onClick={() => toggle(r.id)}
                        >
                          <span aria-hidden="true">{collapsed.has(r.id) ? '▸' : '▾'}</span>
                        </button>
                      ) : (
                        <span className="rab-toggle-space" aria-hidden="true" />
                      )}
                      {r.description}
                    </td>
                  </tr>
                );
              const raw = r.workItemId ? (drafts[r.workItemId] ?? '') : '';
              const p = raw.trim() ? preview(r, mode, raw) : undefined;
              const shown = p && 'cumulative' in p && !p.error ? p : r;
              const over = shown.remaining !== null && new Decimal(shown.remaining).isNegative();
              return (
                <tr key={r.id}>
                  <td className="rab-sticky-no">{r.displayNumber ?? ''}</td>
                  <td className="rab-sticky-desc" style={{ paddingLeft: 11 + r.depth * 14 }}>
                    {r.description}
                    {r.workItemCode && (
                      <span className="block font-mono text-xs text-slate-500">
                        {r.workItemCode}
                      </span>
                    )}
                    {!r.trackable && r.baselineVolume === null && (
                      <Badge tone="slate">tidak ada di baseline ini</Badge>
                    )}
                  </td>
                  <td>{r.unit ?? ''}</td>
                  <td className="num">{volume(r.baselineVolume)}</td>
                  <td className="num">{volume(r.previousCumulative)}</td>
                  <td className="num">
                    {editable && r.trackable ? (
                      <>
                        <input
                          className="field schedule-cell grid-input"
                          inputMode="decimal"
                          aria-label={`${r.description} ${mode === 'VOLUME_WEEK' ? 'volume minggu ini' : 'persen kumulatif'}`}
                          aria-invalid={Boolean(p?.error)}
                          placeholder={
                            mode === 'VOLUME_WEEK'
                              ? r.thisWeek
                                ? volume(r.thisWeek.volume)
                                : '0'
                              : r.percent
                                ? formatRounded(r.percent, 2)
                                : '0'
                          }
                          value={raw}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [r.workItemId!]: e.target.value }))
                          }
                        />
                        {p?.error && <span className="block text-xs text-red-700">{p.error}</span>}
                        {mode === 'PERCENT_CUMULATIVE' && p && 'weekly' in p && !p.error && (
                          <span className="block text-xs text-slate-500">
                            = {volume(p.weekly)} minggu ini
                          </span>
                        )}
                      </>
                    ) : (
                      volume(r.thisWeek?.volume ?? null)
                    )}
                  </td>
                  <td className="num">{volume(shown.cumulative)}</td>
                  <td className={`num ${over ? 'text-red-700' : ''}`}>
                    {shown.percent === null ? '–' : formatRounded(shown.percent, 2)}
                  </td>
                  <td className={`num ${over ? 'text-red-700' : ''}`}>{volume(shown.remaining)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
