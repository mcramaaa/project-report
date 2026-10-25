'use client';

import type { ProjectDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CalendarPreview } from '@/components/calendar-preview';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { PROJECT_STEPS, SCHEDULE_FIELDS, toProjectInput } from '@/lib/project-fields';

type Panel = 'identity' | 'schedule' | 'status';

const IDENTITY_FIELDS = PROJECT_STEPS.flatMap((s) => s.fields).filter((f) => !SCHEDULE_FIELDS.includes(f.name));

/** Edit actions for holders of project.update; the backend re-checks permission and status. */
export function ProjectActions({ project }: { project: ProjectDto }) {
  const [open, setOpen] = useState<Panel>();
  const [notice, setNotice] = useState<string>();
  const closed = project.status === 'CLOSED';
  const toggle = (panel: Panel) => (setNotice(undefined), setOpen((p) => (p === panel ? undefined : panel)));
  const done = (text: string) => (setOpen(undefined), setNotice(text));

  return (
    <section className="space-y-3" aria-labelledby="project-actions-title">
      <h2 id="project-actions-title" className="text-base font-semibold">
        Kelola proyek
      </h2>
      {closed && <Alert kind="info">Proyek ditutup. Identitas dan jadwal tidak dapat diubah sampai proyek dibuka kembali; data tetap dapat dibaca.</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <div className="row-actions">
        <Button variant="secondary" disabled={closed} aria-expanded={open === 'identity'} onClick={() => toggle('identity')}>
          Ubah identitas
        </Button>
        <Button variant="secondary" disabled={closed} aria-expanded={open === 'schedule'} onClick={() => toggle('schedule')}>
          Ubah jadwal
        </Button>
        <Button variant={closed ? 'primary' : 'danger'} aria-expanded={open === 'status'} onClick={() => toggle('status')}>
          {closed ? 'Buka kembali proyek' : 'Tutup proyek'}
        </Button>
      </div>
      {open === 'identity' && <IdentityForm project={project} onDone={() => done('Identitas proyek disimpan.')} onCancel={() => setOpen(undefined)} />}
      {open === 'schedule' && <ScheduleForm project={project} onDone={() => done('Jadwal proyek, minggu, dan periode diperbarui.')} onCancel={() => setOpen(undefined)} />}
      {open === 'status' && <StatusForm project={project} onDone={(text) => done(text)} onCancel={() => setOpen(undefined)} />}
    </section>
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

function FormButtons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
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

function IdentityForm({ project, onDone, onCancel }: { project: ProjectDto; onDone: () => void; onCancel: () => void }) {
  const { errors, error, busy, submit } = useSubmit();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(IDENTITY_FIELDS.map((f) => [f.name, String(project[f.name as keyof ProjectDto] ?? '')])),
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = toProjectInput(values, IDENTITY_FIELDS.map((f) => f.name));
    // Send only changed fields so the audit shows what really changed.
    const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => String(v) !== String(project[k as keyof ProjectDto] ?? '')));
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    void submit(() => api('PATCH', `/projects/${project.id}`, { ...changed, ...(reason ? { reason } : {}) }), onDone);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="panel form-panel space-y-4" aria-label="Ubah identitas proyek">
      <div className="form-grid">
        {IDENTITY_FIELDS.map((f) => (
          <div key={f.name}>
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
        ))}
      </div>
      <Field id="edit-reason" name="reason" label="Alasan perubahan (opsional)" error={errors.reason} />
      {error && <Alert>{error}</Alert>}
      <FormButtons busy={busy} label="Simpan identitas" onCancel={onCancel} />
    </form>
  );
}

function ScheduleForm({ project, onDone, onCancel }: { project: ProjectDto; onDone: () => void; onCancel: () => void }) {
  const { errors, error, busy, submit } = useSubmit();
  const [startDate, setStartDate] = useState(project.startDate);
  const [durationDays, setDurationDays] = useState(String(project.durationDays));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    const input = { ...toProjectInput({ startDate, durationDays }, SCHEDULE_FIELDS), reason };
    void submit(() => api('PUT', `/projects/${project.id}/schedule`, input), onDone);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="panel form-panel space-y-4" aria-label="Ubah jadwal proyek">
      <Alert kind="info">
        Minggu dan periode laporan dibentuk ulang dari jadwal baru. Nomor minggu/periode yang sama tetap dipakai; minggu di akhir yang tidak lagi tercakup dihapus bila belum memiliki data.
      </Alert>
      <div className="form-grid">
        <Field id="schedule-start" label="Tanggal mulai" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
        <Field
          id="schedule-duration"
          label="Masa pelaksanaan (hari kalender)"
          type="number"
          value={durationDays}
          onChange={(e) => setDurationDays(e.target.value)}
          error={errors.durationDays}
        />
      </div>
      <CalendarPreview startDate={startDate} durationDays={durationDays} />
      <Field id="schedule-reason" name="reason" label="Alasan perubahan (wajib)" required error={errors.reason} />
      {error && <Alert>{error}</Alert>}
      <FormButtons busy={busy} label="Simpan jadwal" onCancel={onCancel} />
    </form>
  );
}

function StatusForm({ project, onDone, onCancel }: { project: ProjectDto; onDone: (text: string) => void; onCancel: () => void }) {
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
    <form onSubmit={onSubmit} noValidate className="panel form-panel space-y-4" aria-label={closing ? 'Tutup proyek' : 'Buka kembali proyek'}>
      <p className="text-sm text-slate-600">
        {closing
          ? 'Proyek yang ditutup tetap dapat dibaca. Status laporan dan snapshot tidak berubah.'
          : 'Setelah dibuka kembali, identitas dan jadwal dapat diubah lagi.'}
      </p>
      <Field id="status-reason" name="reason" label="Alasan (wajib)" required error={errors.reason} />
      {error && <Alert>{error}</Alert>}
      <FormButtons busy={busy} label={closing ? 'Tutup proyek' : 'Buka kembali'} onCancel={onCancel} />
    </form>
  );
}
