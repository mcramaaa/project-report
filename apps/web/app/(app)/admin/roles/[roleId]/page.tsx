import type { PERMISSIONS, RoleDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccessTabs } from '@/components/access-tabs';
import { Alert, PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { requireMe, serverGet } from '@/lib/server-api';
import { RoleEditor } from './role-editor';

export default async function RolePage({ params }: { params: Promise<{ roleId: string }> }) {
  const [{ roleId }, me] = await Promise.all([params, requireMe()]);
  const [{ status, data: role }, { data: catalog }] = await Promise.all([
    serverGet<RoleDto>(`/admin/roles/${encodeURIComponent(roleId)}`),
    serverGet<typeof PERMISSIONS>('/admin/permissions'),
  ]);
  if (status === 404 || status === 400) notFound();
  if (!role || !catalog) return <Alert>Role tidak dapat dimuat.</Alert>;

  // GLOBAL roles are super-admin-only (D-035); the API enforces it.
  const editable = can(me, 'roles.manage') && (role.scope === 'PROJECT' || me.isSystemAdmin);

  return (
    <>
      <AccessTabs me={me} active="roles" />
      <Link href="/admin/roles" className="page-back">
        Daftar role
      </Link>
      <PageTitle subtitle={`${role.code} · ${role.scope === 'PROJECT' ? 'Role proyek' : 'Role administrasi'} · Pengaturan berlaku pada semua user dengan role ini.`}>
        {role.name}
      </PageTitle>
      <RoleEditor key={role.updatedAt} role={role} catalog={catalog.filter((p) => p.scope === role.scope)} editable={editable} />
    </>
  );
}
