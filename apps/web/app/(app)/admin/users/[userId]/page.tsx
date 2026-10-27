import Link from 'next/link';
import { AccessTabs } from '@/components/access-tabs';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server-api';
import { UserAccess } from './user-access';

export default async function UserAccessPage({ params }: { params: Promise<{ userId: string }> }) {
  const [{ userId }, me] = await Promise.all([params, requireMe()]);
  return (
    <>
      <AccessTabs me={me} active="users" />
      <Link href="/admin/users" className="page-back">
        Daftar pengguna
      </Link>
      <UserAccess
        userId={userId}
        isSuperAdmin={me.isSystemAdmin}
        canManageProjects={can(me, 'assignments.manage') && (me.isSystemAdmin || me.id !== userId)}
      />
    </>
  );
}
