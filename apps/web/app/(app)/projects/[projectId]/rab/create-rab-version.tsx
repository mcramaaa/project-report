'use client';

import {
  MC_MAX_NUMBER,
  nextMcNumber,
  type RabVersionDetailDto,
  type RabVersionSummaryDto,
  type RabVersionType,
} from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

/** Offers the next version allowed by D-040/D-069: Kontrak first, then the next MC (the API enforces the same order). */
function nextOption(live: RabVersionSummaryDto[]): RabVersionType | null {
  if (live.some((v) => v.status === 'DRAFT' || v.status === 'REOPENED')) return null;
  return live.length === 0 ? 'CONTRACT' : 'MC';
}

export function CreateRabVersion({
  projectId,
  versions,
}: {
  projectId: string;
  versions: RabVersionSummaryDto[];
}) {
  const router = useRouter();
  const live = versions.filter((v) => v.status !== 'DISCARDED');
  const option = nextOption(live);
  const mcNumber = nextMcNumber(live);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Why a new version cannot start now; shown on the disabled button.
  const blocked = !option
    ? 'Ada draft atau koreksi RAB yang belum selesai. Approve atau batalkan dulu.'
    : option === 'MC' && mcNumber > MC_MAX_NUMBER
      ? `Batas MC tercapai: MC-${MC_MAX_NUMBER} adalah MC terakhir.`
      : null;
  const label = option === 'CONTRACT' ? 'Buat RAB Kontrak' : `Buat MC-${mcNumber}`;
  if (!open || blocked)
    return (
      <Button
        type="button"
        disabled={Boolean(blocked)}
        title={blocked ?? undefined}
        onClick={() => setOpen(true)}
      >
        {blocked ? 'Buat versi baru' : label}
      </Button>
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      const created = await api<RabVersionDetailDto>(
        'POST',
        `/projects/${projectId}/rab-versions`,
        {
          versionType: option,
          ...(option === 'MC' && String(form.get('revisionNumber') ?? '') !== ''
            ? { revisionNumber: Number(form.get('revisionNumber')) }
            : {}),
          documentNumber: String(form.get('documentNumber') ?? ''),
          documentDate: String(form.get('documentDate') ?? ''),
        },
      );
      router.push(`/projects/${projectId}/rab/${created.version.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        title={option === 'CONTRACT' ? 'Buat RAB Kontrak' : 'Buat versi MC'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-3">
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
                <p className="field-hint">
                  Boleh meloncat (mis. MC-1 lalu MC-30), asal lebih besar dari MC terakhir. Isi
                  disalin dari versi approved terakhir; pekerjaan yang sama tetap memakai kode
                  pekerjaan yang sama.
                </p>
              </div>
            )}
            <Field
              id="documentNumber"
              name="documentNumber"
              label="Nomor dokumen (opsional)"
              error={errors.documentNumber}
            />
            <Field
              id="documentDate"
              name="documentDate"
              type="date"
              label="Tanggal dokumen (opsional)"
              error={errors.documentDate}
            />
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Membuat…' : 'Buat versi'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
