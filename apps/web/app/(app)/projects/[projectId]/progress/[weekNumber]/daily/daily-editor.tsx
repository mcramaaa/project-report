'use client';

import { Decimal } from '@laporan-proyek/calc';
import type { DailyAllocationDto, DailyAllocationRowDto, SaveDailyAllocationInput } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Section } from '@/components/ui';
import { GridTools, useLeaveWarning } from '@/components/grid-tools';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/project-fields';

const VALID = /^\d{1,18}(\.\d{1,12})?$/;
/** Users type Indonesian decimals; the API takes a dot. */
const normalized = (v: string) => v.trim().replace(',', '.') || '0';
const volume = (v: string) => formatNumber(new Decimal(v).toFixed(), { trim: true });
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/** D-075: the week's volume per day; one row is edited manually at a time. */
export function DailyEditor({ projectId, initial, canInput }: { projectId: string; initial: DailyAllocationDto; canInput: boolean }) {
  const [data, setData] = useState(initial);
  const [editing, setEditing] = useState<{ workItemId: string; values: string[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const { week, days } = data;
  const editable = canInput && week.open;
  useLeaveWarning(Boolean(editing));
  const base = `/projects/${projectId}/progress/weeks/${week.weekNumber}/daily`;

  async function send(row: DailyAllocationRowDto, body: SaveDailyAllocationInput) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setData(await api<DailyAllocationDto>('PUT', `${base}/${row.workItemId}`, body));
      setEditing(undefined);
      setNotice(`${row.description}: ${body.method === 'MANUAL' ? 'alokasi manual disimpan' : 'kembali dibagi dengan faktor hari'}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const mismatches = data.rows.filter((r) => r.mismatch).length;

  return (
    <div className="mt-3 space-y-4">
      <Section
        title={`Alokasi harian minggu ${week.weekNumber}`}
        description={
          <>
            {formatDate(week.startDate)} – {formatDate(week.endDate)}. Volume minggu dibagi ke hari menurut faktor hari; sisa pembulatan masuk hari terakhir.
            Bila pekerjaan tidak merata, isi manual per item.
          </>
        }
        body={Boolean(notice || error || mismatches || !data.rows.length)}
        action={
          <div className="row-actions">
            {week.weekNumber > 1 && (
              <Link className="btn btn-secondary" href={`/projects/${projectId}/progress/${week.weekNumber - 1}/daily`}>
                ← M.{week.weekNumber - 1}
              </Link>
            )}
            <Link className="btn btn-secondary" href={`/projects/${projectId}/progress/${week.weekNumber + 1}/daily`}>
              M.{week.weekNumber + 1} →
            </Link>
          </div>
        }
      >
        <div className="space-y-3">
          {notice && <Alert kind="success">{notice}</Alert>}
          {error && <Alert>{error}</Alert>}
          {mismatches > 0 && (
            <Alert kind="warning">
              {mismatches} item diisi manual tetapi jumlahnya tidak sama lagi dengan volume minggu (progresnya berubah). Perbaiki isiannya atau kembalikan ke
              faktor hari.
            </Alert>
          )}
          {!data.rows.length && <Alert kind="info">Belum ada progres di minggu ini. Isi progres mingguan dulu; alokasi harian dihitung dari situ.</Alert>}
        </div>
      </Section>

      {data.rows.length > 0 && (
        <>
          <GridTools />
          <div className="rab-grid-wrap">
            <table className="rab-grid">
              <thead>
                <tr>
                  <th scope="col" className="rab-sticky-desc" style={{ left: 0 }}>
                    Uraian
                  </th>
                  <th scope="col">Sat.</th>
                  <th scope="col" className="num">
                    Vol. minggu
                  </th>
                  {days.map((d) => (
                    <th key={d.date} scope="col" className="num">
                      Hari {d.day}
                      <span className="block text-xs font-normal">{dayLabel(d.date)}</span>
                      <span className="block text-xs font-normal">× {d.factor.replace('.', ',')}</span>
                    </th>
                  ))}
                  <th scope="col">Cara</th>
                  {editable && <th scope="col">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const edit = editing?.workItemId === r.workItemId ? editing : undefined;
                  const invalid = edit?.values.map((v) => !VALID.test(normalized(v)));
                  const total = edit && !invalid!.some(Boolean) ? edit.values.reduce((t, v) => t.plus(normalized(v)), new Decimal(0)) : undefined;
                  const off = total && !total.eq(r.weekVolume) ? total.minus(r.weekVolume) : undefined;
                  return (
                    <tr key={r.workItemId}>
                      <td className="rab-sticky-desc" style={{ left: 0 }}>
                        {r.description}
                        {r.workItemCode && <span className="block font-mono text-xs text-slate-500">{r.workItemCode}</span>}
                      </td>
                      <td>{r.unit ?? ''}</td>
                      <td className="num">
                        {volume(r.weekVolume)}
                        {edit && (
                          <span className={`block text-xs ${off || !total ? 'text-red-700' : 'text-slate-500'}`}>
                            {!total ? 'isian tidak valid' : off ? `selisih ${volume(off.toFixed())}` : 'jumlah pas'}
                          </span>
                        )}
                      </td>
                      {days.map((d, i) => (
                        <td key={d.date} className="num">
                          {edit ? (
                            <input
                              className="field schedule-cell grid-input"
                              inputMode="decimal"
                              aria-label={`${r.description} hari ${d.day}`}
                              aria-invalid={invalid![i]}
                              value={edit.values[i]}
                              onChange={(e) => setEditing({ ...edit, values: edit.values.map((v, j) => (j === i ? e.target.value : v)) })}
                            />
                          ) : (
                            volume(r.volumes[i]!)
                          )}
                        </td>
                      ))}
                      <td>
                        {r.method === 'MANUAL' ? <Badge tone={r.mismatch ? 'red' : 'blue'}>{r.mismatch ? 'manual, tidak pas' : 'manual'}</Badge> : <Badge>faktor</Badge>}
                      </td>
                      {editable && (
                        <td>
                          <div className="row-actions">
                            {edit ? (
                              <>
                                <Button type="button" disabled={busy || !total || Boolean(off)} onClick={() => void send(r, { method: 'MANUAL', volumes: edit.values.map(normalized) })}>
                                  {busy ? 'Menyimpan…' : 'Simpan'}
                                </Button>
                                <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(undefined)}>
                                  Batal
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button type="button" variant="secondary" disabled={busy || Boolean(editing)} onClick={() => setEditing({ workItemId: r.workItemId, values: r.volumes.map((v) => v.replace('.', ',')) })}>
                                  Isi manual
                                </Button>
                                {r.method === 'MANUAL' && (
                                  <Button type="button" variant="secondary" disabled={busy || Boolean(editing)} onClick={() => void send(r, { method: 'DAILY_FACTOR' })}>
                                    Pakai faktor
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
