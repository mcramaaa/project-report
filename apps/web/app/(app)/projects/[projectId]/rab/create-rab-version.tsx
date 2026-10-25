'use client';

import { rabVersionLabel, type RabVersionDetailDto, type RabVersionSummaryDto, type RabVersionType } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

/** Offers the next version allowed by D-040 (the API enforces the same order). */
function nextOptions(versions: RabVersionSummaryDto[]): RabVersionType[] {
  const live = versions.filter((v) => v.status !== 'DISCARDED');
  if (live.some((v) => v.status === 'DRAFT')) return [];
  if (live.length === 0) return ['CONTRACT'];
  return live.some((v) => v.versionType !== 'CONTRACT') ? ['ADDENDUM'] : ['MC0', 'ADDENDUM'];
}

export function CreateRabVersion({ projectId, versions }: { projectId: string; versions: RabVersionSummaryDto[] }) {
  const router = useRouter();
  const options = nextOptions(versions);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nextAddendum = Math.max(0, ...versions.filter((v) => v.versionType === 'ADDENDUM' && v.status !== 'DISCARDED').map((v) => v.revisionNumber)) + 1;

  if (options.length === 0) return <Alert kind="info">Ada draft RAB yang belum selesai. Approve atau batalkan draft tersebut sebelum membuat versi baru.</Alert>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      const created = await api<RabVersionDetailDto>('POST', `/projects/${projectId}/rab-versions`, {
        versionType: form.get('versionType'),
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
        <div>
          <label htmlFor="versionType" className="field-label">
            Jenis versi
          </label>
          <Select id="versionType" name="versionType" defaultValue={options[0]}>
            {options.map((type) => (
              <option key={type} value={type}>
                {rabVersionLabel({ versionType: type, revisionNumber: nextAddendum })}
              </option>
            ))}
          </Select>
          {options[0] !== 'CONTRACT' && <p className="field-hint">Isi disalin dari versi approved terakhir; pekerjaan yang sama tetap memakai kode pekerjaan yang sama.</p>}
        </div>
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
