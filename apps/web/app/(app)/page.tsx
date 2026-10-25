import { Icon } from '@/components/icon';
import type { MyProjectDto, Paginated } from '@laporan-proyek/shared';
import Link from 'next/link';
import { listHref, Pager } from '@/components/pager';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/project-fields';
import { getMe, serverGet } from '@/lib/server-api';

const PAGE_SIZE = 12;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const { search = '', page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
  const query = listHref('/projects', { search: search.trim(), page, pageSize: PAGE_SIZE });
  const [me, { status, data }] = await Promise.all([getMe(), serverGet<Paginated<MyProjectDto>>(query)]);
  const canCreate = me ? can(me, 'projects.create') : false;

  return (
    <>
      <PageTitle subtitle="Semua proyek Anda, dalam satu ruang kerja.">Proyek saya</PageTitle>
      <section className="panel welcome-panel">
        <div><span className="eyebrow">Selamat bekerja</span><h2 className="mt-2">Halo, {me?.name ?? 'rekan proyek'}.</h2><p>Pilih proyek untuk melihat informasi pekerjaan dan melanjutkan aktivitas bersama tim Anda.</p></div>
        <span className="metric-icon"><Icon name="building" size={25} /></span>
      </section>
      <div className="section-caption"><h2>Daftar proyek</h2>{status === 200 && data && <span>{data.total} proyek tersedia</span>}</div>
      <div className="toolbar mb-4">
        <form className="flex min-w-0 flex-1 items-end gap-2" role="search" action="/">
          <div className="w-full max-w-xs">
            <label htmlFor="search" className="field-label">Cari kode atau nama proyek</label>
            <input id="search" name="search" className="field" defaultValue={search} />
          </div>
          <button type="submit" className="btn btn-secondary">Cari</button>
        </form>
        {canCreate && <Link href="/projects/new" className="btn btn-primary">Proyek baru</Link>}
      </div>
      {status !== 200 || !data ? (
        <Alert>Daftar proyek tidak dapat dimuat.</Alert>
      ) : data.items.length === 0 ? (
        <EmptyState>
          {search ? 'Tidak ada proyek yang cocok dengan pencarian.' : canCreate || me?.isSystemAdmin ? 'Belum ada proyek.' : 'Anda belum memiliki akses ke proyek mana pun. Hubungi administrator untuk mendapatkan akses.'}
        </EmptyState>
      ) : (
        <ul className="project-grid">
          {data.items.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link href={`/projects/${p.id}`} className="panel project-card h-full">
                <div className="flex items-center justify-between gap-3"><span className="metric-icon"><Icon name="building" /></span><span className="flex flex-wrap justify-end gap-1">{p.status === 'CLOSED' && <Badge tone="red">Ditutup</Badge>}<Badge tone={p.role ? 'blue' : 'slate'}>{p.role?.name ?? 'Akses super admin'}</Badge></span></div>
                <h2>{p.projectName}</h2>
                <span className="font-mono text-xs text-slate-500">{p.code} · TA {p.fiscalYear}</span>
                <span className="text-sm text-slate-600">{formatDate(p.startDate)} – {formatDate(p.plannedFinishDate)}</span>
                <div className="project-card-footer"><span>Lihat informasi proyek</span><Icon name="arrow" size={17} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="proyek" href={(n) => listHref('/', { search, page: n })} />}
    </>
  );
}
