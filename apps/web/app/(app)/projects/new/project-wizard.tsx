'use client';

import { createProjectSchema, type ProjectDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CalendarPreview } from '@/components/calendar-preview';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { PROJECT_STEPS, toProjectInput, type ProjectField } from '@/lib/project-fields';

const ALL_FIELDS = PROJECT_STEPS.flatMap((s) => s.fields.map((f) => f.name));

/** Validates the given fields with the shared contract; returns field -> first message. */
function validate(values: Record<string, string>, fields: ProjectField[]): Record<string, string> {
  const mask = Object.fromEntries(fields.map((f) => [f, true])) as Partial<Record<ProjectField, true>>;
  const result = createProjectSchema.pick(mask).safeParse(toProjectInput(values, fields));
  const errors: Record<string, string> = {};
  if (!result.success) for (const issue of result.error.issues) errors[String(issue.path[0])] ??= issue.message;
  return errors;
}

export function ProjectWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({ fiscalYear: String(new Date().getFullYear()) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const current = PROJECT_STEPS[step]!;
  const last = step === PROJECT_STEPS.length - 1;

  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stepErrors = validate(values, current.fields.map((f) => f.name));
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    if (!last) return setStep(step + 1);

    setBusy(true);
    setSubmitError(undefined);
    try {
      const project = await api<ProjectDto>('POST', '/projects', toProjectInput(values, ALL_FIELDS));
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : {};
      setErrors(fieldErrors);
      // Jump back to the first step with a server-side field error (e.g. duplicate code).
      const errorStep = PROJECT_STEPS.findIndex((s) => s.fields.some((f) => fieldErrors[f.name]));
      if (errorStep >= 0) setStep(errorStep);
      setSubmitError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="wizard-steps" aria-label="Langkah pembuatan proyek">
        {PROJECT_STEPS.map((s, i) => (
          <li key={s.title} aria-current={i === step ? 'step' : undefined} data-done={i < step || undefined}>
            <span>{i + 1}</span>
            {s.title}
          </li>
        ))}
      </ol>

      <form onSubmit={next} noValidate className="panel form-panel space-y-4" aria-labelledby="wizard-step-title">
        <h2 id="wizard-step-title" className="text-base font-semibold">
          Langkah {step + 1}: {current.title}
        </h2>
        <div className="form-grid">
          {current.fields.map((f) => (
            <div key={f.name}>
              <Field
                id={f.name}
                name={f.name}
                label={f.label}
                type={f.type ?? 'text'}
                inputMode={f.name === 'contractValue' ? 'decimal' : undefined}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                error={errors[f.name]}
                required
              />
              {f.hint && <p className="field-hint">{f.hint}</p>}
            </div>
          ))}
        </div>

        {last && <CalendarPreview startDate={values.startDate} durationDays={values.durationDays} />}
        {submitError && <Alert>{submitError}</Alert>}

        <div className="row-actions">
          {step > 0 && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => (setErrors({}), setStep(step - 1))}>
              Kembali
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {last ? (busy ? 'Menyimpan…' : 'Simpan proyek') : 'Lanjut'}
          </Button>
        </div>
      </form>
    </div>
  );
}
