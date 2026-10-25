'use client';

import { PASSWORD_MIN_LENGTH, type Paginated, type UserDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Loading } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

const PAGE_SIZE = 20;

export interface UsersAdminProps {
  currentUserId: string;
  /** users.manage; delegates still cannot touch super admin accounts (API enforced). */
  canManage: boolean;
  isSuperAdmin: boolean;
  canViewAccess: boolean;
}

export function UsersAdmin({ currentUserId, canManage, isSuperAdmin, canViewAccess }: UsersAdminProps) {
  const [query, setQuery] = useState({ search: '', page: 1 });
  const [data, setData] = useState<Paginated<UserDto>>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(PAGE_SIZE) });
    if (query.search) params.set('search', query.search);
    api<Paginated<UserDto>>('GET', `/admin/users?${params}`).then(
      (page) => {
        if (cancelled) return;
        setData(page);
        setLoadError(undefined);
      },
      (err) => !cancelled && setLoadError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  async function runAction(user: UserDto, path: string, confirmText: string | null, success: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(user.id);
    setNotice(undefined);
    try {
      await api('POST', `/admin/users/${user.id}/${path}`, {});
      setNotice({ kind: 'success', text: success });
      reload();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusyId(undefined);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="toolbar">
        <form
          className="flex min-w-0 flex-1 items-end gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ search: String(new FormData(e.currentTarget).get('search') ?? '').trim(), page: 1 });
          }}
        >
          <div className="w-full max-w-xs">
            <Field id="search" name="search" label="Cari nama atau email" defaultValue={query.search} />
          </div>
          <Button type="submit" variant="secondary">
            Cari
          </Button>
        </form>
        {canManage && (
          <Button onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
            {showCreate ? 'Tutup form' : 'Tambah user'}
          </Button>
        )}
      </div>

      {showCreate && canManage && (
        <CreateUserForm
          allowSuperAdmin={isSuperAdmin}
          onCreated={(user) => {
            setShowCreate(false);
            setNotice({ kind: 'success', text: `User ${user.email} dibuat.` });
            reload();
          }}
        />
      )}

      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {loadError && <Alert>{loadError}</Alert>}

      {!data && !loadError ? (
        <Loading />
      ) : data && data.items.length === 0 ? (
        <EmptyState>{query.search ? 'Tidak ada user yang cocok dengan pencarian.' : 'Belum ada user.'}</EmptyState>
      ) : data ? (
        <div className="panel data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Email</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Status</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {data.items.map((user) =>
                editingId === user.id ? (
                  <tr role="row" key={user.id}>
                    <td role="cell" colSpan={4} className="px-3 py-3">
                      <EditUserForm
                        user={user}
                        onCancel={() => setEditingId(undefined)}
                        onSaved={() => {
                          setEditingId(undefined);
                          setNotice({ kind: 'success', text: 'Data user disimpan.' });
                          reload();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr role="row" key={user.id}>
                    <td role="cell" data-label="Nama" className="px-3 py-2">
                      {user.name}
                      {user.id === currentUserId && <span className="ml-1 text-slate-500">(Anda)</span>}
                    </td>
                    <td role="cell" data-label="Email" className="px-3 py-2">{user.email}</td>
                    <td role="cell" data-label="Status" className="px-3 py-2"><span className="flex flex-wrap gap-1">
                      {user.isActive ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                      {user.isSystemAdmin && <Badge tone="blue">Super admin</Badge>}</span>
                    </td>
                    <td role="cell" data-label="Aksi"><div className="row-actions">
                      {canViewAccess && (
                        <Link className="btn btn-secondary" href={`/admin/users/${user.id}`}>
                          Akses
                        </Link>
                      )}
                      {canManage && (isSuperAdmin || !user.isSystemAdmin) && (<>
                      <Button variant="secondary" disabled={busyId === user.id} onClick={() => setEditingId(user.id)}>
                        Ubah
                      </Button>
                      {user.isActive ? (
                        <Button
                          variant="danger"
                          disabled={busyId === user.id}
                          onClick={() =>
                            runAction(user, 'deactivate', `Nonaktifkan ${user.email}? Semua sesi user ini akan diakhiri.`, `${user.email} dinonaktifkan.`)
                          }
                        >
                          Nonaktifkan
                        </Button>
                      ) : (
                        <Button variant="secondary" disabled={busyId === user.id} onClick={() => runAction(user, 'activate', null, `${user.email} diaktifkan.`)}>
                          Aktifkan
                        </Button>
                      )}
                      </>)}
                      {isSuperAdmin && (user.isSystemAdmin ? (
                        <Button
                          variant="danger"
                          disabled={busyId === user.id}
                          onClick={() => runAction(user, 'revoke-system-admin', `Cabut hak super admin dari ${user.email}?`, `Hak super admin ${user.email} dicabut.`)}
                        >
                          Cabut super admin
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          disabled={busyId === user.id}
                          onClick={() =>
                            runAction(user, 'grant-system-admin', `Jadikan ${user.email} super admin? Super admin memiliki akses penuh ke semua proyek.`, `${user.email} menjadi super admin.`)
                          }
                        >
                          Jadikan super admin
                        </Button>
                      ))}
                    </div></td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.total > data.pageSize && (
        <nav aria-label="Halaman" className="pagination">
          <Button variant="secondary" disabled={query.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>
            Sebelumnya
          </Button>
          <span>
            Halaman {data.page} dari {totalPages} ({data.total} user)
          </span>
          <Button variant="secondary" disabled={query.page >= totalPages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
            Berikutnya
          </Button>
        </nav>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated, allowSuperAdmin }: { onCreated: (user: UserDto) => void; allowSuperAdmin: boolean }) {
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
      const user = await api<UserDto>('POST', '/admin/users', {
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        isSystemAdmin: form.get('isSystemAdmin') === 'on',
      });
      onCreated(user);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel form-panel space-y-4" noValidate>
      <h2 className="text-base font-semibold">User baru</h2>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="new-name" name="name" label="Nama" required error={fieldErrors.name} />
        <Field id="new-email" name="email" type="email" label="Email" required error={fieldErrors.email} />
        <Field
          id="new-password"
          name="password"
          type="password"
          label={`Password awal (min. ${PASSWORD_MIN_LENGTH})`}
          autoComplete="new-password"
          required
          error={fieldErrors.password}
        />
      </div>
      {allowSuperAdmin && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isSystemAdmin" /> Jadikan super admin (akses penuh ke semua proyek)
        </label>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Menyimpan…' : 'Buat user'}
      </Button>
    </form>
  );
}

function EditUserForm({ user, onCancel, onSaved }: { user: UserDto; onCancel: () => void; onSaved: () => void }) {
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
      await api('PATCH', `/admin/users/${user.id}`, { name: form.get('name'), email: form.get('email') });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`edit-name-${user.id}`} name="name" label="Nama" defaultValue={user.name} required error={fieldErrors.name} />
        <Field id={`edit-email-${user.id}`} name="email" type="email" label="Email" defaultValue={user.email} required error={fieldErrors.email} />
      </div>
      <div className="space-x-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Menyimpan…' : 'Simpan'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  );
}
