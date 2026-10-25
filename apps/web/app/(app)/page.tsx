import { Icon } from '@/components/icon';
import type { MyProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { getMe, serverGet } from '@/lib/server-api';

export default async function HomePage() {
  const [me, { status, data: projects }] = await Promise.all([getMe(), serverGet<MyProjectDto[]>('/projects')]);

  return (
    <>
      <PageTitle subtitle="Semua proyek Anda, dalam satu ruang kerja.">Proyek saya</PageTitle>
      <section className="panel welcome-panel">
        <div><span className="eyebrow">Selamat bekerja</span><h2 className="mt-2">Halo, {me?.name ?? 'rekan proyek'}.</h2><p>Pilih proyek untuk melihat informasi pekerjaan dan melanjutkan aktivitas bersama tim Anda.</p></div>
        <span className="metric-icon"><Icon name="building" size={25} /></span>
      </section>
      <div className="section-caption"><h2>Daftar proyek</h2>{status === 200 && projects && <span>{projects.length} proyek tersedia</span>}</div>
      {status !== 200 || !projects ? (
        <Alert>Daftar proyek tidak dapat dimuat.</Alert>
      ) : projects.length === 0 ? (
        <EmptyState>
          {me?.isSystemAdmin ? 'Belum ada proyek.' : 'Anda belum memiliki akses ke proyek mana pun. Hubungi administrator untuk mendapatkan akses.'}
        </EmptyState>
      ) : (
        <ul className="project-grid">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link href={`/projects/${p.id}`} className="panel project-card h-full">
                <div className="flex items-center justify-between gap-3"><span className="metric-icon"><Icon name="building" /></span><Badge tone={p.role ? 'blue' : 'slate'}>{p.role?.name ?? 'Akses super admin'}</Badge></div>
                <h2>{p.projectName}</h2>
                <span className="font-mono text-xs text-slate-500">{p.code}</span>
                <div className="project-card-footer"><span>Lihat informasi proyek</span><Icon name="arrow" size={17} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
