import { AccessTabs } from '@/components/access-tabs';
import { PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server-api';
import { UsersAdmin } from './users-admin';

export default async function AdminUsersPage() {
  const me = await requireMe();
  return (
    <>
      <PageTitle subtitle="Buat akun terlebih dahulu, lalu atur role dan proyek yang dapat diaksesnya. User dinonaktifkan, tidak dihapus.">
        Pengguna
      </PageTitle>
      <AccessTabs me={me} active="users" />
      <UsersAdmin currentUserId={me.id} canManage={can(me, 'users.manage')} isSuperAdmin={me.isSystemAdmin} canViewAccess={can(me, 'assignments.read')} />
    </>
  );
}
