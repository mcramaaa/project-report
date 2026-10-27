'use client';

import { MC_MAX_NUMBER, nextMcNumber, type RabVersionDetailDto, type RabVersionSummaryDto, type RabVersionType } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

/** Offers the next version allowed by D-040/D-069: Kontrak first, then the next MC (the API enforces the same order). */
function nextOption(live: RabVersionSummaryDto[]): RabVersionType | null {
  if (live.some((v) => v.status === 'DRAFT' || v.status === 'REOPENED')) return null;
  return live.length === 0 ? 'CONTRACT' : 'MC';
}

export function CreateRabVersion({ projectId, versions }: { projectId: string; versions: RabVersionSummaryDto[] }) {
  const router = useRouter();
  const live = versions.filter((v) => v.status !== 'DISCARDED');
  const option = nextOption(live);
  const mcNumber = nextMcNumber(live);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!option) return <Alert kind="info">Ada draft atau koreksi RAB yang belum selesai. Approve (atau batalkan draft) sebelum membuat versi baru.</Alert>;
  if (option === 'MC' && mcNumber > MC_MAX_NUMBER) return <Alert kind="info">Batas MC tercapai: MC-{MC_MAX_NUMBER} adalah MC terakhir.</Alert>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      const created = await api<RabVersionDetailDto>('POST', `/projects/${projectId}/rab-versions`, {
        versionType: option,
        ...(option === 'MC' && String(form.get('revisionNumber') ?? '') !== '' ? { revisionNumber: Number(form.get('revisionNumber')) } : {}),
        documentNumber: String(form.get('documentNumber') ?? ''),
        documentDate: String(form.get('documentDate') ?? ''),
      });
      router.push(`/projects/${projectId}/rab/${created.version.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="panel form-panel space-y-4" aria-labelledby="new-rab-title">
      <h2 id="new-rab-title" className="text-base font-semibold">
        Versi RAB baru
      </h2>
      <div className="form-grid">
        {option === 'CONTRACT' ? (
          <div>
            <span className="field-label">Versi berikutnya</span>
            <p className="text-base font-semibold">Kontrak</p>
          </div>
        ) : (
          <div>
            <Field
              id="revisionNumber"
              name="revisionNumber"
              type="number"
              inputMode="numeric"
              min={mcNumber}
              max={MC_MAX_NUMBER}
              step={1}
              defaultValue={mcNumber}
              label={`Nomor MC (${mcNumber}–${MC_MAX_NUMBER})`}
              error={errors.revisionNumber}
            />
            <p className="field-hint">Boleh meloncat (mis. MC-1 lalu MC-30), asal lebih besar dari MC terakhir. Isi disalin dari versi approved terakhir; pekerjaan yang sama tetap memakai kode pekerjaan yang sama.</p>
          </div>
        )}
        <Field id="documentNumber" name="documentNumber" label="Nomor dokumen (opsional)" error={errors.documentNumber} />
        <Field id="documentDate" name="documentDate" type="date" label="Tanggal dokumen (opsional)" error={errors.documentDate} />
      </div>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Membuat…' : 'Buat versi'}
      </Button>
    </form>
  );
}
