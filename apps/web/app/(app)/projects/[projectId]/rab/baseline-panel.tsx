'use client';

import type { BaselineActivationMode, BaselineVolumeWarningDto, BaselineWeekDto, ProjectBaselinesDto } from '@laporan-proyek/shared';
import { useState, type FormEvent } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { Alert, Badge, Button, Field, Section, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/project-fields';

const MODE_LABEL: Record<BaselineActivationMode, string> = { NEXT_WEEK: 'Minggu berikutnya', EXACT_DATE: 'Tanggal pasti' };

/** Consecutive weeks under the same version(s) collapse into one line; a week split mid-week stays on its own. */
function weekRuns(weeks: BaselineWeekDto[]) {
  const runs: { from: number; to: number; text: string; split: boolean }[] = [];
  for (const w of weeks) {
    const split = w.segments.length > 1;
    const text = split
      ? w.segments.map((s) => `${s.label} ${formatDate(s.startDate)}–${formatDate(s.endDate)}`).join('; ')
      : (w.segments[0]?.label ?? 'Belum ada baseline');
    const last = runs.at(-1);
    if (last && !split && !last.split && last.text === text) last.to = w.weekNumber;
    else runs.push({ from: w.weekNumber, to: w.weekNumber, text, split });
  }
  return runs;
}

export function BaselinePanel({
  projectId,
  initial,
  canActivate,
}: {
  projectId: string;
  initial: ProjectBaselinesDto;
  canActivate: boolean;
}) {
  const [data, setData] = useState(initial);
  const [candidateId, setCandidateId] = useState(initial.candidates[0]?.rabVersion.id);
  const [mode, setMode] = useState<BaselineActivationMode>('NEXT_WEEK');
  const [revoking, setRevoking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  // D-071 butir 5: activation refused until the smaller volumes are confirmed.
  const [pending, setPending] = useState<{ body: Record<string, unknown>; label: string; warnings: BaselineVolumeWarningDto[] }>();

  const base = `/projects/${projectId}/baselines`;
  const candidate = data.candidates.find((c) => c.rabVersion.id === candidateId) ?? data.candidates[0];
  const isContract = Boolean(candidate?.fixedDate);
  // NEXT_WEEK is impossible without a later project week; fall back to an exact date then.
  const effectiveMode: BaselineActivationMode = isContract || !candidate?.nextWeek ? 'EXACT_DATE' : mode;

  async function run(request: () => Promise<ProjectBaselinesDto>, done: string) {
    setBusy(true);
    setError(undefined);
    setErrors({});
    setNotice(undefined);
    setPending(undefined);
    try {
      const next = await request();
      setData(next);
      setCandidateId(next.candidates[0]?.rabVersion.id);
      setRevoking(false);
      setNotice(done);
      return null;
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      return err;
    } finally {
      setBusy(false);
    }
  }

  function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidate) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const reason = String(form.get('reason') ?? '').trim();
    const effectiveFrom = String(form.get('effectiveFrom') ?? '');
    const body = {
      rabVersionId: candidate.rabVersion.id,
      activationMode: effectiveMode,
      ...(effectiveMode === 'EXACT_DATE' && !isContract && effectiveFrom ? { effectiveFrom } : {}),
      ...(reason ? { reason } : {}),
    };
    const label = candidate.rabVersion.label;
    void run(() => api<ProjectBaselinesDto>('POST', base, body), `${label} diaktifkan sebagai baseline.`).then((err) => {
      if (!err) return element.reset();
      const warnings = err instanceof ApiError ? (err.details as { warnings?: BaselineVolumeWarningDto[] } | undefined)?.warnings : undefined;
      if (warnings?.length) setPending({ body, label, warnings });
    });
  }

  return (
    <Section
      id="baseline"
      title="Baseline berlaku"
      description="Versi RAB approved yang menjadi acuan progres per periode. Baseline lama tidak ditimpa; progres aktual tetap."
    >
      <div className="space-y-4">
        {notice && <Alert kind="success">{notice}</Alert>}
        {error && !pending && <Alert>{error}</Alert>}
        {pending && (
          <Alert kind="warning">
            {error}
            <ul className="mt-1 list-disc pl-5">
              {pending.warnings.map((w) => (
                <li key={w.workItemId}>
                  <span className="font-mono">{w.workItemCode}</span> {w.description}: realisasi {w.reported}, volume {pending.label} {w.newVolume}
                </li>
              ))}
            </ul>
            <div className="row-actions mt-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api<ProjectBaselinesDto>('POST', base, { ...pending.body, acknowledgeWarnings: true }), `${pending.label} diaktifkan sebagai baseline.`)}
              >
                Tetap aktifkan {pending.label}
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setPending(undefined)}>
                Batal
              </Button>
            </div>
          </Alert>
        )}

        {data.assignments.length === 0 ? (
          <p className="text-sm text-slate-600">Belum ada baseline aktif. Baseline pertama adalah RAB Kontrak yang sudah approved.</p>
        ) : (
          <ol className="space-y-2" aria-label="Riwayat baseline">
            {data.assignments.map((a) => (
              <li key={a.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold">{a.rabVersion.label}</span>{' '}
                    <span className="text-sm text-slate-600">
                      {formatDate(a.effectiveFrom)} – {formatDate(a.effectiveTo)}
                    </span>{' '}
                    <Badge>{MODE_LABEL[a.activationMode]}</Badge>
                  </div>
                  {canActivate && a.revocable && !revoking && (
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => setRevoking(true)}>
                      Cabut
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  oleh {a.createdBy.name}, {formatDate(a.createdAt.slice(0, 10))}
                  {a.reason ? ` · ${a.reason}` : ''}
                </p>
                {revoking && a.revocable && (
                  <div className="mt-2">
                    <InlineReasonForm
                      id="baseline-revoke-reason"
                      title={`Cabut baseline ${a.rabVersion.label}`}
                      description={
                        data.assignments.length > 1
                          ? 'Baseline sebelumnya berlaku lagi sampai akhir proyek. Riwayat pencabutan tetap tercatat.'
                          : 'Proyek tidak lagi memiliki baseline aktif. Riwayat pencabutan tetap tercatat.'
                      }
                      label="Alasan pencabutan (wajib)"
                      confirmLabel="Cabut baseline"
                      destructive
                      busy={busy}
                      onSubmit={(reason) =>
                        void run(
                          () => api<ProjectBaselinesDto>('POST', `${base}/${a.id}/revoke`, { reason }),
                          `Baseline ${a.rabVersion.label} dicabut.`,
                        )
                      }
                      onCancel={() => setRevoking(false)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {data.assignments.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Baseline per minggu</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {weekRuns(data.weeks).map((r) => (
                <li key={r.from}>
                  <span className="font-medium">Minggu {r.from === r.to ? r.from : `${r.from}–${r.to}`}:</span> {r.text}{' '}
                  {r.split && <Badge tone="amber">terbelah</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {canActivate && candidate && (
          <form onSubmit={activate} noValidate className="space-y-3 border-t border-slate-200 pt-4" aria-labelledby="baseline-activate-title">
            <h3 id="baseline-activate-title" className="text-sm font-semibold">
              Aktifkan baseline berikutnya
            </h3>
            <div className="form-grid">
              <div>
                <label htmlFor="baseline-version" className="field-label">
                  Versi RAB
                </label>
                <Select id="baseline-version" value={candidate.rabVersion.id} onChange={(e) => setCandidateId(e.target.value)}>
                  {data.candidates.map((c) => (
                    <option key={c.rabVersion.id} value={c.rabVersion.id}>
                      {c.rabVersion.label}
                      {c.rabVersion.documentDate ? ` (dok. ${formatDate(c.rabVersion.documentDate)})` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              {isContract ? (
                <div>
                  <span className="field-label">Berlaku mulai</span>
                  <p className="text-sm">{formatDate(candidate.fixedDate!)} (tanggal mulai proyek)</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="baseline-mode" className="field-label">
                    Mulai berlaku
                  </label>
                  <Select id="baseline-mode" value={effectiveMode} onChange={(e) => setMode(e.target.value as BaselineActivationMode)}>
                    <option value="NEXT_WEEK" disabled={!candidate.nextWeek}>
                      {candidate.nextWeek
                        ? `Minggu berikutnya (minggu ke-${candidate.nextWeek.weekNumber}, ${formatDate(candidate.nextWeek.effectiveFrom)})`
                        : 'Minggu berikutnya (butuh tanggal dokumen)'}
                    </option>
                    <option value="EXACT_DATE">Tanggal pasti</option>
                  </Select>
                </div>
              )}
              {!isContract && effectiveMode === 'EXACT_DATE' && (
                <Field
                  key={candidate.rabVersion.id}
                  id="baseline-effective-from"
                  name="effectiveFrom"
                  type="date"
                  label="Tanggal efektif"
                  defaultValue={candidate.exactDefault ?? ''}
                  error={errors.effectiveFrom}
                />
              )}
              <Field id="baseline-reason" name="reason" label="Alasan (opsional)" maxLength={1000} error={errors.reason} />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : `Aktifkan ${candidate.rabVersion.label}`}
            </Button>
          </form>
        )}
        {canActivate && !candidate && (
          <p className="text-sm text-slate-500">Tidak ada versi RAB approved berikutnya yang dapat diaktifkan.</p>
        )}
      </div>
    </Section>
  );
}
