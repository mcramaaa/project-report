'use client';

import {
  PROJECT_ROLE_LABELS,
  PROJECT_ROLES,
  type Paginated,
  type ProjectMemberDto,
  type ProjectMembersResponse,
  type ProjectRole,
  type UserDto,
} from '@laporan-proyek/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Loading, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export function MembersAdmin({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectMembersResponse>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [busyUserId, setBusyUserId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const base = `/admin/projects/${encodeURIComponent(projectId)}/members`;

  useEffect(() => {
    let cancelled = false;
    api<ProjectMembersResponse>('GET', base).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setLoadError(undefined);
      },
      (err) => !cancelled && setLoadError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [base, reloadKey]);

  async function mutate(userId: string, run: () => Promise<unknown>, success: string) {
    setBusyUserId(userId);
    setNotice(undefined);
    try {
      await run();
      setNotice({ kind: 'success', text: success });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusyUserId(undefined);
    }
  }

  if (loadError && !data) return <Alert>{loadError}</Alert>;
  if (!data) return <Loading />;

  return (
    <div className="space-y-6">
      <PageTitle subtitle={`${data.project.code} · Role berlaku pada request berikutnya user tersebut.`}>Anggota: {data.project.projectName}</PageTitle>

      <AddMemberForm
        members={data.members}
        onAdd={(userId, role, label) =>
          mutate(userId, () => api('POST', base, { userId, role }), `${label} ditambahkan sebagai ${PROJECT_ROLE_LABELS[role]}.`)
        }
      />

      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      {data.members.length === 0 ? (
        <EmptyState>Belum ada anggota di proyek ini.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Nama</th>
                <th scope="col" className="px-3 py-2 font-medium">Email</th>
                <th scope="col" className="px-3 py-2 font-medium">Role</th>
                <th scope="col" className="px-3 py-2 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.members.map((m) => (
                <tr key={m.userId}>
                  <td className="px-3 py-2">
                    {m.name} {!m.isActive && <Badge tone="red">Nonaktif</Badge>}
                  </td>
                  <td className="px-3 py-2">{m.email}</td>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`role-${m.userId}`}>
                      Role {m.name}
                    </label>
                    <Select
                      id={`role-${m.userId}`}
                      className="w-40"
                      value={m.role}
                      disabled={busyUserId === m.userId}
                      onChange={(e) => {
                        const role = e.target.value as ProjectRole;
                        void mutate(m.userId, () => api('PATCH', `${base}/${m.userId}`, { role }), `Role ${m.name} diubah menjadi ${PROJECT_ROLE_LABELS[role]}.`);
                      }}
                    >
                      {PROJECT_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {PROJECT_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="danger"
                      disabled={busyUserId === m.userId}
                      onClick={() => {
                        if (!window.confirm(`Cabut akses ${m.name} dari proyek ini? Akun user tetap ada.`)) return;
                        void mutate(m.userId, () => api('DELETE', `${base}/${m.userId}`, {}), `Akses ${m.name} dicabut.`);
                      }}
                    >
                      Cabut akses
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddMemberForm({ members, onAdd }: { members: ProjectMemberDto[]; onAdd: (userId: string, role: ProjectRole, label: string) => Promise<void> }) {
  const [results, setResults] = useState<UserDto[]>();
  const [searchError, setSearchError] = useState<string>();
  const [selected, setSelected] = useState('');
  const [role, setRole] = useState<ProjectRole>('FILLER');
  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = results?.filter((u) => !memberIds.has(u.id)) ?? [];

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = String(new FormData(event.currentTarget).get('userSearch') ?? '').trim();
    const params = new URLSearchParams({ active: 'true', pageSize: '20' });
    if (term) params.set('search', term);
    try {
      const page = await api<Paginated<UserDto>>('GET', `/admin/users?${params}`);
      setResults(page.items);
      setSelected('');
      setSearchError(undefined);
    } catch (err) {
      setSearchError(errorMessage(err));
    }
  }

  const chosen = candidates.find((u) => u.id === selected);

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-labelledby="add-member-title">
      <h2 id="add-member-title" className="text-base font-semibold">
        Tambah anggota
      </h2>
      <form onSubmit={search} className="flex items-end gap-2">
        <div className="w-full max-w-xs">
          <Field id="userSearch" name="userSearch" label="Cari user aktif (nama/email)" />
        </div>
        <Button type="submit" variant="secondary">
          Cari
        </Button>
      </form>
      {searchError && <Alert>{searchError}</Alert>}
      {results && candidates.length === 0 && <p className="text-sm text-slate-500">Tidak ada user aktif yang belum menjadi anggota.</p>}
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="candidate" className="mb-1 block text-sm font-medium text-slate-700">
              User
            </label>
            <Select id="candidate" className="w-72" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">— pilih user —</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="new-role" className="mb-1 block text-sm font-medium text-slate-700">
              Role
            </label>
            <Select id="new-role" className="w-40" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PROJECT_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <Button
            disabled={!chosen}
            onClick={async () => {
              if (!chosen) return;
              await onAdd(chosen.id, role, chosen.name);
              setResults(undefined);
              setSelected('');
            }}
          >
            Tambahkan
          </Button>
        </div>
      )}
    </section>
  );
}
