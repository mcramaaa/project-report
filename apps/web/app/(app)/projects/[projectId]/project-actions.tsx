'use client';

import type { ProjectDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CalendarPreview } from '@/components/calendar-preview';
import { Alert, Button, Field, Section } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
  formatDate,
  formatRupiah,
  PROJECT_STEPS,
  SCHEDULE_FIELDS,
  toProjectInput,
} from '@/lib/project-fields';

type Panel = 'identity' | 'schedule' | 'status';

const IDENTITY_FIELDS = PROJECT_STEPS.flatMap((s) => s.fields).filter(
  (f) => !SCHEDULE_FIELDS.includes(f.name),
);

type FieldDef = (typeof PROJECT_STEPS)[number]['fields'][number];
const GROUPS = PROJECT_STEPS.map((g) => ({
  title: g.title === 'SPMK' ? 'SPMK & jadwal' : g.title,
  fields: g.fields,
}));

/** Read-only text of a field, as the card shows it. */
function shown(project: ProjectDto, f: FieldDef): string {
  const v = project[f.name as keyof ProjectDto];
  if (f.name === 'contractValue') return formatRupiah(project.contractValue);
  if (f.name === 'durationDays') return `${project.durationDays} hari kalender`;
  if (f.type === 'date') return formatDate(String(v));
  return String(v ?? '');
}

/**
 * Project data card. "Ubah identitas"/"Ubah jadwal" turn the shown text into inputs in place; the schedule change
 * keeps its required reason and week preview. The backend re-checks permission and status.
 */
export function ProjectData({ project, canEdit }: { project: ProjectDto; canEdit: boolean }) {
  const [mode, setMode] = useState<Panel>();
  const [notice, setNotice] = useState<string>();
  const closed = project.status === 'CLOSED';
  const { errors, error, busy, submit } = useSubmit();
  const initial = () =>
    Object.fromEntries(
      GROUPS.flatMap((g) => g.fields).map((f) => [
        f.name,
        String(project[f.name as keyof ProjectDto] ?? ''),
      ]),
    );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const start = (next: Panel) => {
    setNotice(undefined);
    setValues(initial());
    setMode(next);
  };
  const done = (text: string) => {
    setMode(undefined);
    setNotice(text);
  };
  const editable = (f: FieldDef) =>
    mode === 'identity'
      ? !SCHEDULE_FIELDS.includes(f.name)
      : mode === 'schedule' && SCHEDULE_FIELDS.includes(f.name);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (mode === 'schedule') {
      const input = { ...toProjectInput(values, SCHEDULE_FIELDS), reason };
      void submit(
        () => api('PUT', `/projects/${project.id}/schedule`, input),
        () => done('Jadwal proyek, minggu, dan periode diperbarui.'),
      );
      return;
    }
    const input = toProjectInput(
      values,
      IDENTITY_FIELDS.map((f) => f.name),
    );
    // Send only changed fields so the audit shows what really changed.
    const changed = Object.fromEntries(
      Object.entries(input).filter(
        ([k, v]) => String(v) !== String(project[k as keyof ProjectDto] ?? ''),
      ),
    );
    void submit(
      () => api('PATCH', `/projects/${project.id}`, { ...changed, ...(reason ? { reason } : {}) }),
      () => done('Identitas proyek disimpan.'),
    );
  }

  return (
    <Section
      id="info-data"
      title="Data proyek"
      description={
        mode
          ? mode === 'schedule'
            ? 'Ubah tanggal mulai atau masa pelaksanaan, lalu simpan.'
            : 'Ubah isian yang perlu, lalu simpan.'
          : 'Perubahan identitas dan jadwal tercatat di riwayat audit.'
      }
      body={false}
      action={
        canEdit &&
        !mode && (
          <div className="row-actions">
            <Button variant="secondary" disabled={closed} onClick={() => start('identity')}>
              Ubah identitas
            </Button>
            <Button variant="secondary" disabled={closed} onClick={() => start('schedule')}>
              Ubah jadwal
            </Button>
            <Button variant={closed ? 'primary' : 'danger'} onClick={() => start('status')}>
              {closed ? 'Buka kembali proyek' : 'Tutup proyek'}
            </Button>
          </div>
        )
      }
    >
      {(closed || notice || mode === 'status') && (
        <div className="surface-body space-y-3">
          {closed && (
            <Alert kind="info">
              Proyek ditutup. Identitas dan jadwal tidak dapat diubah sampai proyek dibuka kembali;
              data tetap dapat dibaca.
            </Alert>
          )}
          {notice && <Alert kind="success">{notice}</Alert>}
          {mode === 'status' && (
            <StatusForm project={project} onDone={done} onCancel={() => setMode(undefined)} />
          )}
        </div>
      )}
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label={mode === 'schedule' ? 'Ubah jadwal proyek' : 'Ubah identitas proyek'}
      >
        {GROUPS.map((g) => {
          // The code is shown in the page header; it is only listed here while editing the identity.
          const fields = g.fields.filter((f) => f.name !== 'code' || mode === 'identity');
          return (
            <div key={g.title} className="info-group">
              <h3>{g.title}</h3>
              <dl className="detail-list">
                {fields.map((f) =>
                  editable(f) ? (
                    <div key={f.name} className="min-w-0">
                      <Field
                        id={`edit-${f.name}`}
                        label={f.label}
                        type={f.type ?? 'text'}
                        inputMode={f.name === 'contractValue' ? 'decimal' : undefined}
                        value={values[f.name] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                        error={errors[f.name]}
                      />
                      {f.hint && <p className="field-hint">{f.hint}</p>}
                    </div>
                  ) : (
                    <div key={f.name} className="min-w-0">
                      <dt>{f.label.replace(' (Rp)', '').replace(' (hari kalender)', '')}</dt>
                      <dd>{shown(project, f)}</dd>
                    </div>
                  ),
                )}
                {g.title === 'SPMK & jadwal' && (
                  <div className="min-w-0">
                    <dt>Tanggal selesai rencana</dt>
                    <dd>{formatDate(project.plannedFinishDate)}</dd>
                  </div>
                )}
              </dl>
              {mode === 'schedule' && g.title === 'SPMK & jadwal' && (
                <div className="space-y-3 px-[19px] pb-4">
                  <Alert kind="info">
                    Minggu dan periode laporan dibentuk ulang dari jadwal baru. Nomor minggu/periode
                    yang sama tetap dipakai; minggu di akhir yang tidak lagi tercakup dihapus bila
                    belum memiliki data.
                  </Alert>
                  <CalendarPreview
                    startDate={values.startDate ?? ''}
                    durationDays={values.durationDays ?? ''}
                  />
                </div>
              )}
            </div>
          );
        })}
        {(mode === 'identity' || mode === 'schedule') && (
          <div className="info-edit-bar">
            <Field
              id="edit-reason"
              name="reason"
              label={
                mode === 'schedule' ? 'Alasan perubahan (wajib)' : 'Alasan perubahan (opsional)'
              }
              required={mode === 'schedule'}
              error={errors.reason}
            />
            {error && <Alert>{error}</Alert>}
            <FormButtons
              busy={busy}
              label={mode === 'schedule' ? 'Simpan jadwal' : 'Simpan identitas'}
              onCancel={() => setMode(undefined)}
            />
          </div>
        )}
      </form>
    </Section>
  );
}

/** Shared submit flow: field errors from the API, generic message otherwise, refresh on success. */
function useSubmit() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(run: () => Promise<unknown>, onDone: () => void) {
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      await run();
      onDone();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { errors, error, busy, submit };
}

function FormButtons({
  busy,
  label,
  onCancel,
}: {
  busy: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="row-actions">
      <Button type="submit" disabled={busy}>
        {busy ? 'Menyimpan…' : label}
      </Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
        Batal
      </Button>
    </div>
  );
}

function StatusForm({
  project,
  onDone,
  onCancel,
}: {
  project: ProjectDto;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const { errors, error, busy, submit } = useSubmit();
  const closing = project.status === 'ACTIVE';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = closing
      ? `Tutup proyek ${project.code}? Identitas dan jadwal tidak dapat diubah sampai dibuka kembali.`
      : `Buka kembali proyek ${project.code}?`;
    if (!window.confirm(question)) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    void submit(
      () => api('POST', `/projects/${project.id}/${closing ? 'close' : 'reopen'}`, { reason }),
      () => onDone(closing ? 'Proyek ditutup.' : 'Proyek dibuka kembali.'),
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="panel form-panel space-y-4"
      aria-label={closing ? 'Tutup proyek' : 'Buka kembali proyek'}
    >
      <p className="text-sm text-slate-600">
        {closing
          ? 'Proyek yang ditutup tetap dapat dibaca. Status laporan dan snapshot tidak berubah.'
          : 'Setelah dibuka kembali, identitas dan jadwal dapat diubah lagi.'}
      </p>
      <Field
        id="status-reason"
        name="reason"
        label="Alasan (wajib)"
        required
        error={errors.reason}
      />
      {error && <Alert>{error}</Alert>}
      <FormButtons
        busy={busy}
        label={closing ? 'Tutup proyek' : 'Buka kembali'}
        onCancel={onCancel}
      />
    </form>
  );
}
