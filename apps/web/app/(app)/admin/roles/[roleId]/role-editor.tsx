'use client';

import type { PERMISSIONS, RoleDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

type Permission = (typeof PERMISSIONS)[number];

export function RoleEditor({ role, catalog, editable }: { role: RoleDto; catalog: readonly Permission[]; editable: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(role.permissionCodes);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of catalog) {
      if (!`${p.name} ${p.code} ${p.module}`.toLowerCase().includes(search.toLowerCase())) continue;
      map.set(p.module, [...(map.get(p.module) ?? []), p]);
    }
    return [...map.entries()];
  }, [catalog, search]);

  const toggle = (code: string) => setSelected((old) => (old.includes(code) ? old.filter((c) => c !== code) : [...old, code]));

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setNotice(undefined);
    setFieldErrors({});
    try {
      await action();
      setNotice({ kind: 'success', text: success });
      router.refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    } finally {
      setPending(false);
    }
  }

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { name: form.get('name'), description: form.get('description') };
    if (!role.isSystem) {
      body.code = form.get('code');
      body.isActive = form.get('isActive') === 'on';
    }
    void run(() => api('PATCH', `/admin/roles/${role.id}`, body), 'Identitas role disimpan.');
  }

  function savePermissions() {
    if (!window.confirm(`${selected.length} permission akan diterapkan pada role ${role.name}. Perubahan berlaku untuk semua user dengan role ini pada request berikutnya.`)) return;
    void run(() => api('PUT', `/admin/roles/${role.id}/permissions`, { permissionCodes: selected }), 'Permission role diperbarui.');
  }

  return (
    <div className="space-y-6">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {!editable && <Alert kind="info">Anda hanya dapat melihat role ini.</Alert>}

      <form onSubmit={saveIdentity} className="panel form-panel space-y-4" noValidate>
        <h2 className="text-base font-semibold">Identitas role</h2>
        <fieldset disabled={!editable || pending} className="grid gap-3 sm:grid-cols-2">
          {!role.isSystem && <Field id="code" name="code" label="Kode" defaultValue={role.code} required error={fieldErrors.code} />}
          <Field id="name" name="name" label="Nama role" defaultValue={role.name} required error={fieldErrors.name} />
          <Field id="description" name="description" label="Deskripsi" defaultValue={role.description ?? ''} error={fieldErrors.description} />
          {!role.isSystem && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={role.isActive} /> Role aktif (role nonaktif tidak memberi permission)
            </label>
          )}
        </fieldset>
        {role.isSystem && <p className="text-sm text-slate-600">Role sistem: kode dan status tidak dapat diubah.</p>}
        {editable && (
          <Button type="submit" disabled={pending}>
            Simpan identitas
          </Button>
        )}
      </form>

      <section className="panel form-panel space-y-4" aria-labelledby="perm-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="perm-title" className="text-base font-semibold">
            Hak akses
          </h2>
          <span className="badge badge-slate">{selected.length} dipilih</span>
        </div>
        <Alert kind="info">Perubahan memengaruhi seluruh user yang memakai role ini. Permission yang tidak dipilih tidak diberikan.</Alert>
        <div>
          <label htmlFor="perm-search" className="sr-only">
            Cari permission
          </label>
          <input id="perm-search" className="field" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari permission atau nama modul..." />
        </div>
        <fieldset disabled={!editable || pending} className="permission-groups">
          {groups.map(([module, items]) => {
            const all = items.every((p) => selected.includes(p.code));
            return (
              <section className="permission-group" key={module}>
                <header>
                  <h3>{module}</h3>
                  <button
                    type="button"
                    className="link-button text-sm"
                    onClick={() =>
                      setSelected((old) => (all ? old.filter((c) => !items.some((p) => p.code === c)) : [...new Set([...old, ...items.map((p) => p.code)])]))
                    }
                  >
                    {all ? 'Lepas grup' : 'Pilih grup'}
                  </button>
                </header>
                {items.map((p) => (
                  <label className="permission-item" key={p.code}>
                    <input type="checkbox" checked={selected.includes(p.code)} onChange={() => toggle(p.code)} />
                    <span>
                      <strong>{p.name}</strong>
                      <code>{p.code}</code>
                      <small>{p.description}</small>
                    </span>
                  </label>
                ))}
              </section>
            );
          })}
        </fieldset>
        {groups.length === 0 && <p className="text-sm text-slate-500">Tidak ada permission yang cocok.</p>}
        {editable && (
          <Button onClick={savePermissions} disabled={pending}>
            {pending ? 'Menyimpan…' : 'Simpan hak akses'}
          </Button>
        )}
      </section>
    </div>
  );
}
