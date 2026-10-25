'use client';

import type { RoleDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

export function CreateRoleForm({ allowGlobal }: { allowGlobal: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    try {
      const role = await api<RoleDto>('POST', '/admin/roles', {
        code: form.get('code'),
        name: form.get('name'),
        description: form.get('description'),
        scope: form.get('scope') ?? 'PROJECT',
      });
      router.push(`/admin/roles/${role.id}`);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} aria-expanded={false}>
        Tambah role
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel form-panel space-y-4" noValidate>
      <h2 className="text-base font-semibold">Role baru</h2>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="role-code" name="code" label="Kode role" placeholder="PENGAWAS_LAPANGAN" required error={fieldErrors.code} />
        <Field id="role-name" name="name" label="Nama role" required error={fieldErrors.name} />
        <Field id="role-description" name="description" label="Deskripsi" error={fieldErrors.description} />
        <div>
          <label htmlFor="role-scope" className="field-label">
            Cakupan
          </label>
          <Select id="role-scope" name="scope" defaultValue="PROJECT">
            <option value="PROJECT">Proyek (ditugaskan per proyek)</option>
            {allowGlobal && <option value="GLOBAL">Administrasi (global)</option>}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Menyimpan…' : 'Buat role'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
