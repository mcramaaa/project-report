import { PageTitle } from '@/components/ui';
import { requireMe } from '@/lib/server-api';
import { UsersAdmin } from './users-admin';

export default async function AdminUsersPage() {
  const me = await requireMe();
  return (
    <>
      <PageTitle subtitle="Akun dibuat oleh system admin. User dinonaktifkan, tidak dihapus.">Administrasi User</PageTitle>
      <UsersAdmin currentUserId={me.id} />
    </>
  );
}
