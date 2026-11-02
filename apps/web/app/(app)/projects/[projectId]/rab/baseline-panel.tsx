'use client';

import type {
  BaselineActivationMode,
  BaselineVolumeWarningDto,
  BaselineWeekDto,
  ProjectBaselinesDto,
} from '@laporan-proyek/shared';
import { useState, type FormEvent } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { Alert, Badge, Button, Field, Section, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/project-fields';

const MODE_LABEL: Record<BaselineActivationMode, string> = {
  NEXT_WEEK: 'Minggu berikutnya',
  EXACT_DATE: 'Tanggal pasti',
};

/**
 * One cell per project week, shaded by the version in force: versions are ordered in time, so older ones are
 * lighter (a sequential ramp, not categories). A week split mid-week shows both shades (D-071, D-073 butir 3).
 */
function WeekRibbon({ weeks }: { weeks: BaselineWeekDto[] }) {
  const versions = [
    ...new Map(weeks.flatMap((w) => w.segments).map((s) => [s.rabVersionId, s.label])).entries(),
  ];
  const step = new Map(versions.map(([id], i) => [id, Math.min(i, 4)]));
  const shade = (id: string) => `var(--baseline-${step.get(id)})`;
  return (
    <figure className="baseline-ribbon">
      <figcaption>
        <span>Baseline per minggu</span>
        <ul>
          {versions.map(([id, label]) => (
            <li key={id}>
              <i style={{ background: shade(id) }} aria-hidden />
              {label}
            </li>
          ))}
          {weeks.some((w) => w.segments.length > 1) && (
            <li>
              <i className="is-split" aria-hidden />
              terbelah (dua versi dalam satu minggu)
            </li>
          )}
        </ul>
      </figcaption>
      <ol style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(24px, 1fr))` }}>
        {weeks.map((w) => {
          const segs = w.segments;
          const title = segs.length
            ? `M.${w.weekNumber}: ${segs.map((s) => `${s.label} ${formatDate(s.startDate)}–${formatDate(s.endDate)}`).join('; ')}`
            : `M.${w.weekNumber}: belum ada baseline`;
          const last = segs.at(-1);
          return (
            <li
              key={w.weekNumber}
              title={title}
              data-dark={last && step.get(last.rabVersionId)! >= 2 ? '' : undefined}
              style={{
                background: !last
                  ? undefined
                  : segs.length > 1
                    ? `linear-gradient(90deg, ${segs.map((s, i) => `${shade(s.rabVersionId)} ${(i * 100) / segs.length}% ${((i + 1) * 100) / segs.length}%`).join(', ')})`
                    : shade(last.rabVersionId),
              }}
            >
              {w.weekNumber}
            </li>
          );
        })}
      </ol>
    </figure>
  );
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
  const [pending, setPending] = useState<{
    body: Record<string, unknown>;
    label: string;
    warnings: BaselineVolumeWarningDto[];
  }>();

  const base = `/projects/${projectId}/baselines`;
  const candidate =
    data.candidates.find((c) => c.rabVersion.id === candidateId) ?? data.candidates[0];
  const isContract = Boolean(candidate?.fixedDate);
  // NEXT_WEEK is impossible without a later project week; fall back to an exact date then.
  const effectiveMode: BaselineActivationMode =
    isContract || !candidate?.nextWeek ? 'EXACT_DATE' : mode;

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
    void run(
      () => api<ProjectBaselinesDto>('POST', base, body),
      `${label} diaktifkan sebagai baseline.`,
    ).then((err) => {
      if (!err) return element.reset();
      const warnings =
        err instanceof ApiError
          ? (err.details as { warnings?: BaselineVolumeWarningDto[] } | undefined)?.warnings
          : undefined;
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
                  <span className="font-mono">{w.workItemCode}</span> {w.description}: realisasi{' '}
                  {w.reported}, volume {pending.label} {w.newVolume}
                </li>
              ))}
            </ul>
            <div className="row-actions mt-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api<ProjectBaselinesDto>('POST', base, {
                        ...pending.body,
                        acknowledgeWarnings: true,
                      }),
                    `${pending.label} diaktifkan sebagai baseline.`,
                  )
                }
              >
                Tetap aktifkan {pending.label}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setPending(undefined)}
              >
                Batal
              </Button>
            </div>
          </Alert>
        )}

        {data.assignments.length === 0 ? (
          <p className="text-sm text-slate-600">
            Belum ada baseline aktif. Baseline pertama adalah RAB Kontrak yang sudah approved.
          </p>
        ) : (
          <>
            <WeekRibbon weeks={data.weeks} />
            <div className="data-panel">
              <table role="table" className="data-table" aria-label="Riwayat baseline">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">
                      Versi
                    </th>
                    <th role="columnheader" scope="col">
                      Berlaku
                    </th>
                    <th role="columnheader" scope="col">
                      Cara aktivasi
                    </th>
                    <th role="columnheader" scope="col">
                      Diaktifkan
                    </th>
                    <th role="columnheader" scope="col">
                      Alasan
                    </th>
                    {canActivate && <th role="columnheader" scope="col" aria-label="Aksi" />}
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {data.assignments.map((a) => (
                    <tr role="row" key={a.id}>
                      <td
                        role="cell"
                        data-label="Versi"
                        className="whitespace-nowrap font-semibold"
                      >
                        {a.rabVersion.label}
                      </td>
                      <td role="cell" data-label="Berlaku" className="whitespace-nowrap">
                        {formatDate(a.effectiveFrom)} – {formatDate(a.effectiveTo)}
                      </td>
                      <td role="cell" data-label="Cara aktivasi" className="whitespace-nowrap">
                        <Badge>{MODE_LABEL[a.activationMode]}</Badge>
                      </td>
                      <td role="cell" data-label="Diaktifkan" className="whitespace-nowrap">
                        {a.createdBy.name}
                        <span className="block text-xs text-slate-500">
                          {formatDate(a.createdAt.slice(0, 10))}
                        </span>
                      </td>
                      <td role="cell" data-label="Alasan" className="text-slate-600">
                        {a.reason || '–'}
                      </td>
                      {canActivate && (
                        <td role="cell" data-label="Aksi">
                          {a.revocable && !revoking && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setRevoking(true)}
                            >
                              Cabut
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {revoking &&
              data.assignments
                .filter((a) => a.revocable)
                .map((a) => (
                  <InlineReasonForm
                    key={a.id}
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
                        () =>
                          api<ProjectBaselinesDto>('POST', `${base}/${a.id}/revoke`, { reason }),
                        `Baseline ${a.rabVersion.label} dicabut.`,
                      )
                    }
                    onCancel={() => setRevoking(false)}
                  />
                ))}
          </>
        )}

        {canActivate && candidate && (
          <form
            onSubmit={activate}
            noValidate
            className="space-y-3 border-t border-slate-200 pt-4"
            aria-labelledby="baseline-activate-title"
          >
            <h3 id="baseline-activate-title" className="text-sm font-semibold">
              Aktifkan baseline berikutnya
            </h3>
            <div className="form-grid">
              <div>
                <label htmlFor="baseline-version" className="field-label">
                  Versi RAB
                </label>
                <Select
                  id="baseline-version"
                  value={candidate.rabVersion.id}
                  onChange={(e) => setCandidateId(e.target.value)}
                >
                  {data.candidates.map((c) => (
                    <option key={c.rabVersion.id} value={c.rabVersion.id}>
                      {c.rabVersion.label}
                      {c.rabVersion.documentDate
                        ? ` (dok. ${formatDate(c.rabVersion.documentDate)})`
                        : ''}
                    </option>
                  ))}
                </Select>
              </div>
              {isContract ? (
                <div>
                  <span className="field-label">Berlaku mulai</span>
                  <p className="text-sm">
                    {formatDate(candidate.fixedDate!)} (tanggal mulai proyek)
                  </p>
                </div>
              ) : (
                <div>
                  <label htmlFor="baseline-mode" className="field-label">
                    Mulai berlaku
                  </label>
                  <Select
                    id="baseline-mode"
                    value={effectiveMode}
                    onChange={(e) => setMode(e.target.value as BaselineActivationMode)}
                  >
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
              <Field
                id="baseline-reason"
                name="reason"
                label="Alasan (opsional)"
                maxLength={1000}
                error={errors.reason}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : `Aktifkan ${candidate.rabVersion.label}`}
            </Button>
          </form>
        )}
        {canActivate && !candidate && (
          <p className="text-sm text-slate-500">
            Tidak ada versi RAB approved berikutnya yang dapat diaktifkan.
          </p>
        )}
      </div>
    </Section>
  );
}
