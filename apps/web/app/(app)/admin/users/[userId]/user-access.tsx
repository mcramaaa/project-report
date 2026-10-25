'use client';

import type { AdminProjectDto, RoleDto, UserAccessDto } from '@laporan-proyek/shared';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Loading, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useProjectRoles } from '@/lib/use-project-roles';

export function UserAccess({ userId, isSuperAdmin, canManageProjects }: { userId: string; isSuperAdmin: boolean; canManageProjects: boolean }) {
  const [data, setData] = useState<UserAccessDto>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const projectRoles = useProjectRoles();

  useEffect(() => {
    let cancelled = false;
    api<UserAccessDto>('GET', `/admin/users/${encodeURIComponent(userId)}/access`).then(
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
  }, [userId, reloadKey]);

  async function mutate(run: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await run();
      setNotice({ kind: 'success', text: success });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !data) return <Alert>{loadError}</Alert>;
  if (!data) return <Loading />;
  const { user } = data;
  const members = (projectId: string) => `/admin/projects/${projectId}/members`;

  return (
    <div className="space-y-6">
      <PageTitle subtitle={`${user.email} · Satu akun dapat memiliki role administrasi dan akses ke beberapa proyek.`}>
        {user.name} {!user.isActive && <Badge tone="red">Nonaktif</Badge>}
      </PageTitle>
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      {user.isSystemAdmin && <Alert kind="info">Super admin memiliki seluruh permission di semua proyek tanpa penugasan.</Alert>}

      <section className="panel form-panel space-y-3" aria-labelledby="global-roles-title">
        <h2 id="global-roles-title" className="text-base font-semibold">
          Role administrasi
        </h2>
        {data.globalRoles.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada role administrasi.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.globalRoles.map((role) => (
              <li key={role.id} className="flex items-center gap-2">
                <Badge tone={role.isActive ? 'blue' : 'red'}>
                  {role.name}
                  {!role.isActive && ' (nonaktif)'}
                </Badge>
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="link-button text-sm"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Cabut role ${role.name} dari ${user.name}?`)) return;
                      void mutate(() => api('DELETE', `/admin/users/${user.id}/global-roles/${role.id}`), `Role ${role.name} dicabut.`);
                    }}
                  >
                    Cabut
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isSuperAdmin ? (
          <GrantGlobalRole
            assigned={data.globalRoles.map((r) => r.id)}
            disabled={busy || !user.isActive}
            onGrant={(role) => mutate(() => api('POST', `/admin/users/${user.id}/global-roles`, { roleId: role.id }), `Role ${role.name} diberikan.`)}
          />
        ) : (
          <p className="text-sm text-slate-500">Role administrasi hanya dapat diatur super admin.</p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="project-access-title">
        <div className="section-caption">
          <h2 id="project-access-title">Akses proyek</h2>
          <span>{data.projects.length} proyek</span>
        </div>
        {canManageProjects && projectRoles && (
          <GrantProjectAccess
            assigned={data.projects.map((p) => p.project.id)}
            roles={projectRoles}
            disabled={busy || !user.isActive}
            onGrant={(project, role) =>
              mutate(() => api('POST', members(project.id), { userId: user.id, roleId: role.id }), `Akses ${project.code} sebagai ${role.name} diberikan.`)
            }
          />
        )}
        {data.projects.length === 0 ? (
          <EmptyState>User ini belum memiliki akses ke proyek mana pun.</EmptyState>
        ) : (
          <div className="panel data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                <tr role="row">
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Proyek</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Role</th>
                  {canManageProjects && <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Aksi</th>}
                </tr>
              </thead>
              <tbody role="rowgroup" className="divide-y divide-slate-100">
                {data.projects.map(({ project, role }) => (
                  <tr role="row" key={project.id}>
                    <td role="cell" data-label="Proyek" className="px-3 py-2">
                      <span className="font-mono text-xs text-slate-500">{project.code}</span> {project.projectName}
                    </td>
                    <td role="cell" data-label="Role" className="px-3 py-2">
                      {canManageProjects && projectRoles ? (
                        <>
                          <label className="sr-only" htmlFor={`role-${project.id}`}>
                            Role di {project.code}
                          </label>
                          <Select
                            id={`role-${project.id}`}
                            className="w-44"
                            value={role.id}
                            disabled={busy}
                            onChange={(e) => {
                              const next = projectRoles.find((r) => r.id === e.target.value);
                              if (next) void mutate(() => api('PATCH', `${members(project.id)}/${user.id}`, { roleId: next.id }), `Role di ${project.code} diubah menjadi ${next.name}.`);
                            }}
                          >
                            {!projectRoles.some((r) => r.id === role.id) && <option value={role.id}>{role.name} (nonaktif)</option>}
                            {projectRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </Select>
                        </>
                      ) : (
                        <Badge tone={role.isActive ? 'blue' : 'red'}>{role.name}</Badge>
                      )}
                    </td>
                    {canManageProjects && (
                      <td role="cell" data-label="Aksi" className="px-3 py-2">
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Cabut akses ${user.name} dari ${project.code}? Akun user tetap ada.`)) return;
                            void mutate(() => api('DELETE', `${members(project.id)}/${user.id}`, {}), `Akses ${project.code} dicabut.`);
                          }}
                        >
                          Cabut akses
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function GrantGlobalRole({ assigned, disabled, onGrant }: { assigned: string[]; disabled: boolean; onGrant: (role: RoleDto) => Promise<void> }) {
  const [roles, setRoles] = useState<RoleDto[]>();
  const [roleId, setRoleId] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<RoleDto[]>('GET', '/admin/roles?scope=GLOBAL').then(
      (all) => !cancelled && setRoles(all.filter((r) => r.isActive)),
      () => !cancelled && setRoles([]),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const options = roles?.filter((r) => !assigned.includes(r.id)) ?? [];
  const role = options.find((r) => r.id === roleId);
  if (roles && roles.length === 0) return <p className="text-sm text-slate-500">Belum ada role administrasi. Buat di Role & permission dengan cakupan Global.</p>;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="global-role" className="field-label">
          Berikan role administrasi
        </label>
        <Select id="global-role" className="w-64" value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={disabled}>
          <option value="">— pilih role —</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.permissionCodes.length} permission)
            </option>
          ))}
        </Select>
      </div>
      <Button
        disabled={disabled || !role}
        onClick={async () => {
          if (!role || !window.confirm(`Berikan role ${role.name}? Permission: ${role.permissionCodes.join(', ') || 'tidak ada'}.`)) return;
          await onGrant(role);
          setRoleId('');
        }}
      >
        Berikan
      </Button>
    </div>
  );
}

function GrantProjectAccess({
  assigned,
  roles,
  disabled,
  onGrant,
}: {
  assigned: string[];
  roles: RoleDto[];
  disabled: boolean;
  onGrant: (project: AdminProjectDto, role: RoleDto) => Promise<void>;
}) {
  const [projects, setProjects] = useState<AdminProjectDto[]>();
  const [projectId, setProjectId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<AdminProjectDto[]>('GET', '/admin/projects').then(
      (all) => !cancelled && setProjects(all),
      () => !cancelled && setProjects([]),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const options = projects?.filter((p) => !assigned.includes(p.id)) ?? [];
  const project = options.find((p) => p.id === projectId);
  const role = roles.find((r) => r.id === roleId);
  if (!projects) return <Loading label="Memuat proyek…" />;
  if (options.length === 0) return null;

  return (
    <div className="panel form-panel space-y-3">
      <h3 className="font-semibold">Tambah akses proyek</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="grant-project" className="field-label">
            Proyek
          </label>
          <Select id="grant-project" className="max-w-full sm:w-72" value={projectId} disabled={disabled} onChange={(e) => (setProjectId(e.target.value), setConfirmed(false))}>
            <option value="">— pilih proyek —</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.projectName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="grant-role" className="field-label">
            Role
          </label>
          <Select id="grant-role" className="w-44" value={roleId} disabled={disabled} onChange={(e) => (setRoleId(e.target.value), setConfirmed(false))}>
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
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Saya sudah memeriksa proyek dan role ini.
      </label>
      <Button
        disabled={disabled || !project || !role || !confirmed}
        onClick={async () => {
          if (!project || !role) return;
          await onGrant(project, role);
          setProjectId('');
          setRoleId('');
          setConfirmed(false);
        }}
      >
        Berikan akses
      </Button>
    </div>
  );
}
