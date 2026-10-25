import { Icon } from '@/components/icon';
import type { AdminProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { Alert, EmptyState, PageTitle } from '@/components/ui';
import { AccessTabs } from '@/components/access-tabs';
import { requireMe, serverGet } from '@/lib/server-api';

export default async function AdminProjectsPage() {
  const [me, { data: projects }] = await Promise.all([requireMe(), serverGet<AdminProjectDto[]>('/admin/projects')]);

  return (
    <>
      <PageTitle subtitle="Pilih proyek untuk melihat dan mengatur siapa saja yang dapat mengaksesnya. Halaman ini tidak membuka data proyek.">
        Akses proyek
      </PageTitle>
      <AccessTabs me={me} active="projects" />
      {!projects ? (
        <Alert>Daftar proyek tidak dapat dimuat.</Alert>
      ) : projects.length === 0 ? (
        <EmptyState>Belum ada proyek yang tersedia untuk dikelola.</EmptyState>
      ) : (
        <ul className="project-grid">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link href={`/admin/projects/${p.id}/members`} className="panel project-card h-full">
                <span className="metric-icon"><Icon name="users" /></span>
                <h2>{p.projectName}</h2>
                <span className="font-mono text-xs text-slate-500">{p.code}</span>
                <div className="project-card-footer"><span>Lihat anggota & role</span><Icon name="arrow" size={17} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
