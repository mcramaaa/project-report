'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

/**
 * "Batalkan draft" from the version list. Same rule and endpoint as the editor's approval panel: a DRAFT is not
 * deleted but marked DISCARDED with a required reason, and stays in the list as history.
 */
export function DiscardDraft({
  projectId,
  versionId,
  label,
}: {
  projectId: string;
  versionId: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) return setFieldError('Alasan wajib diisi.');
    setBusy(true);
    setError(undefined);
    setFieldError(undefined);
    try {
      await api('POST', `/projects/${projectId}/rab-versions/${versionId}/discard`, { reason });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.fieldErrors.reason) setFieldError(err.fieldErrors.reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="danger" onClick={() => setOpen(true)}>
        Batalkan draft
      </Button>
      {open && (
        <Modal title={`Batalkan draft ${label}?`} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm text-slate-600">
              Draft tidak dihapus: statusnya menjadi Dibatalkan dan tetap tercatat sebagai riwayat,
              beserta alasannya. Setelah itu Anda dapat membuat versi baru atau mengimpor ulang.
            </p>
            {error && <Alert>{error}</Alert>}
            <Field
              id={`discard-reason-${versionId}`}
              name="reason"
              label="Alasan (wajib)"
              required
              error={fieldError}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Kembali
              </Button>
              <Button type="submit" variant="danger" disabled={busy}>
                {busy ? 'Membatalkan…' : 'Batalkan draft'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
