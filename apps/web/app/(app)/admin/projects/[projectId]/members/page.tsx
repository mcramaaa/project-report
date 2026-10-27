import Link from 'next/link';
import { AccessTabs } from '@/components/access-tabs';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server-api';
import { MembersAdmin } from './members-admin';

export default async function ProjectMembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const [{ projectId }, me] = await Promise.all([params, requireMe()]);
  return (
    <>
      <AccessTabs me={me} active="projects" />
      <Link href="/admin/projects" className="page-back">
        Daftar proyek
      </Link>
      <MembersAdmin projectId={projectId} canManage={can(me, 'assignments.manage')} selfId={me.isSystemAdmin ? undefined : me.id} />
    </>
  );
}
