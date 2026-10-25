import Link from 'next/link';
import { MembersAdmin } from './members-admin';

export default async function ProjectMembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <Link href="/admin/projects" className="mb-4 inline-block text-sm text-slate-600 hover:text-slate-900">
        ← Daftar proyek
      </Link>
      <MembersAdmin projectId={projectId} />
    </>
  );
}
