'use client';

import type { MemberCandidateDto, ProjectMembersResponse, RoleDto } from '@laporan-proyek/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Loading, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useProjectRoles } from '@/lib/use-project-roles';

export function MembersAdmin({ projectId, canManage, selfId }: { projectId: string; canManage: boolean; selfId?: string }) {
  const [data, setData] = useState<ProjectMembersResponse>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [busyUserId, setBusyUserId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const roles = useProjectRoles();
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
      <PageTitle subtitle={`${data.project.code} · Satu role per user di proyek ini. Perubahan berlaku pada request berikutnya user tersebut.`}>
        Akses: {data.project.projectName}
      </PageTitle>

      {canManage && roles && (
        <AddMemberForm
          projectId={projectId}
          roles={roles}
          onAdd={(user, role) =>
            mutate(user.id, () => api('POST', base, { userId: user.id, roleId: role.id }), `${user.name} ditambahkan sebagai ${role.name}.`)
          }
        />
      )}

      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      {data.members.length === 0 ? (
        <EmptyState>Belum ada anggota di proyek ini.</EmptyState>
      ) : (
        <div className="panel data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Email</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Role</th>
                {canManage && <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Aksi</th>}
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {data.members.map((m) => {
                // Delegates cannot change their own access (D-035); the API enforces it too.
                const locked = !canManage || m.userId === selfId || busyUserId === m.userId;
                return (
                  <tr role="row" key={m.userId}>
                    <td role="cell" data-label="Nama" className="px-3 py-2">
                      {m.name} {!m.isActive && <Badge tone="red">Nonaktif</Badge>}
                    </td>
                    <td role="cell" data-label="Email" className="px-3 py-2">{m.email}</td>
                    <td role="cell" data-label="Role" className="px-3 py-2">
                      {canManage && roles ? (
                        <>
                          <label className="sr-only" htmlFor={`role-${m.userId}`}>
                            Role {m.name}
                          </label>
                          <Select
                            id={`role-${m.userId}`}
                            className="w-44"
                            value={m.role.id}
                            disabled={locked}
                            onChange={(e) => {
                              const role = roles.find((r) => r.id === e.target.value);
                              if (!role) return;
                              void mutate(m.userId, () => api('PATCH', `${base}/${m.userId}`, { roleId: role.id }), `Role ${m.name} diubah menjadi ${role.name}.`);
                            }}
                          >
                            {!roles.some((r) => r.id === m.role.id) && <option value={m.role.id}>{m.role.name} (nonaktif)</option>}
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </Select>
                        </>
                      ) : (
                        <Badge tone={m.role.isActive ? 'blue' : 'red'}>{m.role.name}</Badge>
                      )}
                    </td>
                    {canManage && (
                      <td role="cell" data-label="Aksi" className="px-3 py-2">
                        <Button
                          variant="danger"
                          disabled={locked}
                          title={m.userId === selfId ? 'Akses Anda sendiri diatur oleh super admin.' : undefined}
                          onClick={() => {
                            if (!window.confirm(`Cabut akses ${m.name} dari proyek ini? Akun user tetap ada.`)) return;
                            void mutate(m.userId, () => api('DELETE', `${base}/${m.userId}`, {}), `Akses ${m.name} dicabut.`);
                          }}
                        >
                          Cabut akses
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddMemberForm({
  projectId,
  roles,
  onAdd,
}: {
  projectId: string;
  roles: RoleDto[];
  onAdd: (user: MemberCandidateDto, role: RoleDto) => Promise<void>;
}) {
  const [results, setResults] = useState<MemberCandidateDto[]>();
  const [searchError, setSearchError] = useState<string>();
  const [selected, setSelected] = useState('');
  const [roleId, setRoleId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const candidates = results ?? [];

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = String(new FormData(event.currentTarget).get('userSearch') ?? '').trim();
    const params = new URLSearchParams({ search: term });
    try {
      setResults(await api<MemberCandidateDto[]>('GET', `/admin/projects/${encodeURIComponent(projectId)}/member-candidates?${params}`));
      setSelected('');
      setSearchError(undefined);
    } catch (err) {
      setSearchError(errorMessage(err));
    }
  }

  const chosen = candidates.find((u) => u.id === selected);
  const role = roles.find((r) => r.id === roleId);

  return (
    <section className="panel form-panel space-y-4" aria-labelledby="add-member-title">
      <h2 id="add-member-title" className="text-base font-semibold">
        Tambah anggota
      </h2>
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="candidate" className="field-label">
                User
              </label>
              <Select id="candidate" className="max-w-full sm:w-72" value={selected} onChange={(e) => (setSelected(e.target.value), setConfirmed(false))}>
                <option value="">— pilih user —</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="new-role" className="field-label">
                Role
              </label>
              <Select id="new-role" className="w-44" value={roleId} onChange={(e) => (setRoleId(e.target.value), setConfirmed(false))}>
                <option value="">— pilih role —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {role && <p className="text-sm text-slate-600">Permission role ini: {role.permissionCodes.join(', ') || 'tidak ada'}.</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Saya sudah memeriksa user dan role ini.
          </label>
          <Button
            disabled={!chosen || !role || !confirmed}
            onClick={async () => {
              if (!chosen || !role) return;
              await onAdd(chosen, role);
              setResults(undefined);
              setSelected('');
              setRoleId('');
              setConfirmed(false);
            }}
          >
            Tambahkan
          </Button>
        </div>
      )}
    </section>
  );
}
