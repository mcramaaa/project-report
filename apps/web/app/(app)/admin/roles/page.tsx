import type { RoleDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { AccessTabs } from '@/components/access-tabs';
import { Icon } from '@/components/icon';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { requireMe, serverGet } from '@/lib/server-api';
import { CreateRoleForm } from './create-role-form';

const SCOPE_TITLE = { PROJECT: 'Role proyek', GLOBAL: 'Role administrasi' } as const;
const SCOPE_HELP = {
  PROJECT: 'Ditugaskan per proyek; menentukan apa yang dapat dilakukan user di proyek tersebut.',
  GLOBAL: 'Ditugaskan ke akun tanpa proyek; mendelegasikan pengelolaan user, role, dan akses proyek. Hanya super admin yang dapat mengaturnya.',
} as const;

export default async function RolesPage() {
  const [me, { data: roles }] = await Promise.all([requireMe(), serverGet<RoleDto[]>('/admin/roles')]);

  return (
    <>
      <PageTitle subtitle="Susun hak akses modular untuk setiap tim. Permission ditentukan per kemampuan, bukan berdasarkan nama role.">Role & permission</PageTitle>
      <AccessTabs me={me} active="roles" />
      {can(me, 'roles.manage') && <CreateRoleForm allowGlobal={me.isSystemAdmin} />}
      {!roles ? (
        <Alert>Daftar role tidak dapat dimuat.</Alert>
      ) : (
        (['PROJECT', 'GLOBAL'] as const).map((scope) => {
          const items = roles.filter((r) => r.scope === scope);
          return (
            <section key={scope} className="mt-6">
              <div className="section-caption">
                <h2>{SCOPE_TITLE[scope]}</h2>
                <span>{items.length} role</span>
              </div>
              <p className="mb-3 text-sm text-slate-600">{SCOPE_HELP[scope]}</p>
              {items.length === 0 ? (
                <EmptyState>Belum ada {SCOPE_TITLE[scope].toLowerCase()}.</EmptyState>
              ) : (
                <ul className="project-grid">
                  {items.map((r) => (
                    <li key={r.id} className="min-w-0">
                      <Link href={`/admin/roles/${r.id}`} className="panel project-card h-full">
                        <div className="flex items-center justify-between gap-3">
                          <span className="metric-icon">
                            <Icon name={r.isSystem ? 'lock' : 'shield'} />
                          </span>
                          <Badge tone={r.isActive ? 'green' : 'red'}>{r.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                        </div>
                        <h2>{r.name}</h2>
                        <span className="font-mono text-xs text-slate-500">
                          {r.code}
                          {r.isSystem && ' · role sistem'}
                        </span>
                        <p className="text-sm text-slate-600">{r.description || 'Belum ada deskripsi.'}</p>
                        <div className="project-card-footer">
                          <span>{r.permissionCodes.length} permission</span>
                          <Icon name="arrow" size={17} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </>
  );
}
