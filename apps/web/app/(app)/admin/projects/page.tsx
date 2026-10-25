import type { AdminProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { Alert, EmptyState, PageTitle } from '@/components/ui';
import { serverGet } from '@/lib/server-api';

export default async function AdminProjectsPage() {
  const { data: projects } = await serverGet<AdminProjectDto[]>('/admin/projects');

  return (
    <>
      <PageTitle subtitle="Pilih proyek untuk mengelola anggota dan role. Halaman ini tidak memberi akses ke data proyek.">
        Anggota Proyek
      </PageTitle>
      {!projects ? (
        <Alert>Daftar proyek tidak dapat dimuat.</Alert>
      ) : projects.length === 0 ? (
        <EmptyState>Belum ada proyek. Untuk development jalankan `npm run db:seed:dev`.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/projects/${p.id}/members`} className="block px-4 py-3 hover:bg-slate-50">
                <span className="font-mono text-xs text-slate-500">{p.code}</span>
                <span className="ml-3 text-sm font-medium text-slate-900">{p.projectName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
