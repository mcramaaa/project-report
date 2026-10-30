'use client';

import { Decimal, plannedCurve, SCHEDULE_TOLERANCE } from '@laporan-proyek/calc';
import type { DocumentDto, ScheduleDetailDto } from '@laporan-proyek/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { Alert, Badge, Button, Field, Section, Select } from '@/components/ui';
import { GridTools, useLeaveWarning } from '@/components/grid-tools';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatRounded } from '@/lib/project-fields';
import { SCHEDULE_STATUS_BADGE } from '@/lib/rab-ui';

const WEIGHT = /^\d{1,3}(\.\d{1,18})?$/;
const key = (groupId: string, week: number) => `${groupId}/${week}`;
const cellsOf = (s: ScheduleDetailDto) => Object.fromEntries(s.entries.map((e) => [key(e.groupId, e.weekNumber), e.weight]));
/** Users type Indonesian decimals; the API takes a dot. */
const normalized = (v: string) => v.trim().replace(',', '.');

export function ScheduleEditor({
  projectId,
  initial,
  canEdit,
  canApprove,
  documents,
}: {
  projectId: string;
  initial: ScheduleDetailDto;
  canEdit: boolean;
  canApprove: boolean;
  documents: DocumentDto[];
}) {
  const [data, setData] = useState(initial);
  const [cells, setCells] = useState<Record<string, string>>(() => cellsOf(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; list: string[] }>();
  const [notice, setNotice] = useState<string>();
  const [reopening, setReopening] = useState(false);
  const [focused, setFocused] = useState<string>();
  useLeaveWarning(dirty);

  const base = `/projects/${projectId}/schedules/${data.id}`;
  const editable = canEdit && data.status !== 'APPROVED';
  const weekCount = data.weeks.length;

  // Live sums and Kurva S rencana from what is typed, with the same calc as the API.
  const { entries, invalid } = useMemo(() => {
    const out: { groupId: string; weekNumber: number; weight: string }[] = [];
    const bad = new Set<string>();
    for (const [k, raw] of Object.entries(cells)) {
      const v = normalized(raw);
      if (!v) continue;
      if (!WEIGHT.test(v)) {
        bad.add(k);
        continue;
      }
      const [groupId, week] = k.split('/');
      out.push({ groupId: groupId!, weekNumber: Number(week), weight: v });
    }
    return { entries: out, invalid: bad };
  }, [cells]);
  const curve = useMemo(() => plannedCurve(entries, weekCount), [entries, weekCount]);
  const groupSums = useMemo(() => {
    const sums = new Map<string, Decimal>();
    for (const e of entries) sums.set(e.groupId, (sums.get(e.groupId) ?? new Decimal(0)).plus(e.weight));
    return sums;
  }, [entries]);

  async function run(request: () => Promise<ScheduleDetailDto>, done: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await request();
      setData(next);
      setCells(cellsOf(next));
      setDirty(false);
      setReopening(false);
      setNotice(done);
      return true;
    } catch (err) {
      const list = err instanceof ApiError ? ((err.details as { errors?: unknown } | undefined)?.errors ?? []) : [];
      setError({ message: errorMessage(err), list: Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [] });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (invalid.size) {
      setError({ message: `${invalid.size} isian bukan angka % yang valid (gunakan angka ≥ 0, maks. 18 desimal).`, list: [] });
      return;
    }
    void run(() => api<ScheduleDetailDto>('PUT', `${base}/entries`, { entries }), 'Isian jadwal disimpan.');
  }

  function importSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sheet = String(form.get('sheet') ?? '').trim();
    void run(
      () => api<ScheduleDetailDto>('POST', `${base}/import`, { documentId: String(form.get('documentId')), ...(sheet ? { sheet } : {}) }),
      'Jadwal diimpor dari Excel.',
    );
  }

  const badge = SCHEDULE_STATUS_BADGE[data.status];
  return (
    <div className="mt-4 space-y-4">
      <Section
        title={
          <>
            Jadwal {data.rabVersion.label} <Badge tone={badge.tone}>{badge.label}</Badge>
          </>
        }
        description={
          <>
            % bobot proyek per kelompok pekerjaan per minggu, seperti sheet Master Curva S.
            {data.sourceDocument && ` Impor terakhir: ${data.sourceDocument.filename}.`}
            {data.approvedBy && data.approvedAt && ` Approved oleh ${data.approvedBy.name}, ${formatDate(data.approvedAt.slice(0, 10))}.`}
          </>
        }
        action={
          <div className="row-actions">
            {editable && (
              <Button type="button" onClick={save} disabled={busy || !dirty}>
                {busy ? 'Menyimpan…' : 'Simpan isian'}
              </Button>
            )}
            {canApprove && data.status !== 'APPROVED' && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy || dirty || data.issues.length > 0}
                title={dirty ? 'Simpan isian dulu' : data.issues.length ? 'Selesaikan pemeriksaan dulu' : undefined}
                onClick={() => void run(() => api<ScheduleDetailDto>('POST', `${base}/approve`, {}), 'Jadwal di-approve.')}
              >
                Approve
              </Button>
            )}
            {canApprove && data.status === 'APPROVED' && !reopening && (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setReopening(true)}>
                Buka untuk revisi
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {reopening && (
            <InlineReasonForm
              id="schedule-reopen-reason"
              title={`Buka kembali jadwal ${data.rabVersion.label}`}
              description="Isian approved disimpan di riwayat audit. Jadwal harus di-approve lagi setelah direvisi."
              label="Alasan revisi (wajib)"
              confirmLabel="Buka untuk revisi"
              busy={busy}
              onSubmit={(reason) => void run(() => api<ScheduleDetailDto>('POST', `${base}/reopen`, { reason }), 'Jadwal dibuka untuk revisi.')}
              onCancel={() => setReopening(false)}
            />
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
          {dirty && <Alert kind="info">Ada isian yang belum disimpan.</Alert>}
          {!dirty && data.entries.length === 0 && <Alert kind="info">Belum ada isian. Isi grid per minggu atau impor dari Excel.</Alert>}
          {!dirty && data.entries.length > 0 && data.issues.length > 0 && (
            <Alert kind="warning">
              Belum dapat di-approve:
              <ul className="mt-1 list-disc pl-5">
                {data.issues.map((i) => (
                  <li key={i.message}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      </Section>

      {editable && (
        <form onSubmit={importSheet} className="panel form-panel space-y-3" aria-labelledby="schedule-import-title">
          <h2 id="schedule-import-title" className="text-base font-semibold">
            Impor dari Excel
          </h2>
          {documents.length === 0 ? (
            <p className="text-sm text-slate-600">Belum ada dokumen .xlsx di proyek ini. Unggah laporan mingguan di menu Impor RAB → dokumen.</p>
          ) : (
            <>
              <div className="form-grid">
                <div>
                  <label htmlFor="schedule-document" className="field-label">
                    Dokumen
                  </label>
                  <Select id="schedule-document" name="documentId" required>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.originalFilename}
                      </option>
                    ))}
                  </Select>
                </div>
                <Field id="schedule-sheet" name="sheet" label="Sheet" defaultValue="Master Curva S" maxLength={100} />
              </div>
              <p className="field-hint">Mengganti seluruh isian draft. Kolom minggu dibaca dari header M.1, M.2, …; baris dari nomor kelompok (A, B.I, …).</p>
              <Button type="submit" variant="secondary" disabled={busy}>
                Impor
              </Button>
            </>
          )}
        </form>
      )}

      <GridTools />
      <div className="rab-grid-wrap">
        <table className="rab-grid">
          <thead>
            <tr>
              <th scope="col" className="rab-sticky-no">
                No
              </th>
              <th scope="col" className="rab-sticky-desc">
                Pekerjaan
              </th>
              <th scope="col" className="num">
                Bobot %
              </th>
              <th scope="col" className="num">
                Rencana %
              </th>
              {data.weeks.map((w) => (
                <th key={w.weekNumber} scope="col" className="num" title={`${formatDate(w.startDate)} – ${formatDate(w.endDate)}`}>
                  M.{w.weekNumber}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => {
              const sum = groupSums.get(g.id) ?? new Decimal(0);
              const off = sum.minus(g.weight).abs().gt(SCHEDULE_TOLERANCE);
              return (
                <tr key={g.id}>
                  <td className="rab-sticky-no">{g.displayNumber ?? '–'}</td>
                  <td className="rab-sticky-desc">{g.description}</td>
                  <td className="num">{formatRounded(g.weight, 4)}</td>
                  <td className={`num ${off ? 'text-red-700' : ''}`} title={off ? 'Belum sama dengan bobot' : undefined}>
                    {formatRounded(sum.toFixed(), 4)}
                  </td>
                  {data.weeks.map((w) => {
                    const k = key(g.id, w.weekNumber);
                    return (
                      <td key={w.weekNumber} className="num">
                        {editable ? (
                          <input
                            className="field schedule-cell grid-input"
                            inputMode="decimal"
                            aria-label={`${g.displayNumber ?? g.description} minggu ${w.weekNumber}`}
                            aria-invalid={invalid.has(k)}
                            title={cells[k] || undefined}
                            // Rounded like the workbook while not edited; the exact value while focused.
                            value={focused === k || !cells[k] || invalid.has(k) ? (cells[k] ?? '') : formatRounded(normalized(cells[k]), 4)}
                            onFocus={() => setFocused(k)}
                            onBlur={() => setFocused(undefined)}
                            onChange={(e) => {
                              setCells((c) => ({ ...c, [k]: e.target.value }));
                              setDirty(true);
                            }}
                          />
                        ) : cells[k] ? (
                          <span title={cells[k]}>{formatRounded(cells[k], 4)}</span>
                        ) : (
                          ''
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4} className="rab-sticky-no">
                Rencana mingguan %
              </th>
              {curve.map((c) => (
                <td key={c.weekNumber} className="num">
                  {formatRounded(c.planned, 4)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" colSpan={4} className="rab-sticky-no">
                Rencana kumulatif %
              </th>
              {curve.map((c) => (
                <td key={c.weekNumber} className="num font-semibold">
                  {formatRounded(c.cumulative, 4)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
