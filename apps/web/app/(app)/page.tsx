import { PROJECT_ROLE_LABELS, type MyProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { getMe, serverGet } from '@/lib/server-api';

export default async function HomePage() {
  const [me, { status, data: projects }] = await Promise.all([getMe(), serverGet<MyProjectDto[]>('/projects')]);

  return (
    <>
      <PageTitle subtitle="Proyek tempat Anda terdaftar sebagai anggota.">Proyek Saya</PageTitle>
      {status !== 200 || !projects ? (
        <Alert>Daftar proyek tidak dapat dimuat.</Alert>
      ) : projects.length === 0 ? (
        <EmptyState>
          Anda belum menjadi anggota proyek mana pun.
          {me?.isSystemAdmin && ' Sebagai system admin, tambahkan diri Anda melalui menu Admin: Anggota Proyek bila perlu mengakses data proyek.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span>
                  <span className="font-mono text-xs text-slate-500">{p.code}</span>
                  <span className="ml-3 text-sm font-medium text-slate-900">{p.projectName}</span>
                </span>
                <Badge tone="blue">{PROJECT_ROLE_LABELS[p.role]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
