'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export function LoginForm({ passwordChanged }: { passwordChanged: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(undefined);
    try {
      await api('POST', '/auth/login', { email: form.get('email'), password: form.get('password') });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {passwordChanged && <Alert kind="success">Password berhasil diganti. Silakan login kembali.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field id="email" name="email" type="email" label="Email" autoComplete="username" required autoFocus />
      <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required />
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Memproses…' : 'Masuk'}
      </Button>
    </form>
  );
}
