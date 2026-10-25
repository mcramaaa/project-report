import { Icon } from '@/components/icon';
import type { AdminProjectDto, Paginated } from '@laporan-proyek/shared';
import Link from 'next/link';
import { AccessTabs } from '@/components/access-tabs';
import { listHref, Pager } from '@/components/pager';
import { Alert, EmptyState, PageTitle } from '@/components/ui';
import { requireMe, serverGet } from '@/lib/server-api';

const PAGE_SIZE = 12;

export default async function AdminProjectsPage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const { search = '', page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
  const [me, { data }] = await Promise.all([
    requireMe(),
    serverGet<Paginated<AdminProjectDto>>(listHref('/admin/projects', { search: search.trim(), page, pageSize: PAGE_SIZE })),
  ]);

  return (
    <>
      <PageTitle subtitle="Pilih proyek untuk melihat dan mengatur siapa saja yang dapat mengaksesnya. Halaman ini tidak membuka data proyek.">
        Akses proyek
      </PageTitle>
      <AccessTabs me={me} active="projects" />
      <form className="mb-4 flex min-w-0 items-end gap-2" role="search" action="/admin/projects">
        <div className="w-full max-w-xs">
          <label htmlFor="search" className="field-label">Cari kode atau nama proyek</label>
          <input id="search" name="search" className="field" defaultValue={search} />
        </div>
        <button type="submit" className="btn btn-secondary">Cari</button>
      </form>
      {!data ? (
        <Alert>Daftar proyek tidak dapat dimuat.</Alert>
      ) : data.items.length === 0 ? (
        <EmptyState>{search ? 'Tidak ada proyek yang cocok dengan pencarian.' : 'Belum ada proyek yang tersedia untuk dikelola.'}</EmptyState>
      ) : (
        <ul className="project-grid">
          {data.items.map((p) => (
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
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="proyek" href={(n) => listHref('/admin/projects', { search, page: n })} />}
    </>
  );
}
