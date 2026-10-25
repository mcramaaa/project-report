'use client';

import { PASSWORD_MIN_LENGTH } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

export function ChangePasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword') !== form.get('confirmPassword')) {
      setFieldErrors({ confirmPassword: 'Konfirmasi password tidak sama.' });
      return;
    }
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    try {
      await api('POST', '/auth/change-password', { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') });
      // All sessions were revoked by the API; the user must sign in again.
      router.replace('/login?changed=1');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field id="currentPassword" name="currentPassword" type="password" label="Password lama" autoComplete="current-password" required error={fieldErrors.currentPassword} />
      <Field
        id="newPassword"
        name="newPassword"
        type="password"
        label={`Password baru (min. ${PASSWORD_MIN_LENGTH} karakter)`}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={fieldErrors.newPassword}
      />
      <Field id="confirmPassword" name="confirmPassword" type="password" label="Ulangi password baru" autoComplete="new-password" required error={fieldErrors.confirmPassword} />
      <p className="text-sm text-slate-600">Setelah password diganti, semua sesi Anda diakhiri dan Anda perlu login kembali.</p>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Menyimpan…' : 'Ganti password'}
      </Button>
    </form>
  );
}
