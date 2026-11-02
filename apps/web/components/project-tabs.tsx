import type { ProjectDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { Badge, PageTitle } from '@/components/ui';
import { formatDate } from '@/lib/project-fields';

export type ProjectTab = 'info' | 'rab' | 'schedule' | 'progress' | 'imports';

export const IMPORT_PERMISSIONS = ['document.read', 'rabImport.review', 'rabImport.approve'];

/** Project section tabs shown by project permission (UX hint; the API checks). */
export function ProjectTabs({
  projectId,
  active,
  permissions,
}: {
  projectId: string;
  active: ProjectTab;
  permissions: string[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const canImport = IMPORT_PERMISSIONS.some((p) => permissions.includes(p));
  // Impor RAB lives under the RAB tab; a role that can only import still gets the tab, pointing at the imports page.
  const tabs: { key: ProjectTab; label: string; href: string; show: boolean }[] = [
    { key: 'info', label: 'Informasi', href: base, show: true },
    {
      key: 'rab',
      label: 'RAB',
      href: permissions.includes('rab.read') ? `${base}/rab` : `${base}/imports`,
      show: permissions.includes('rab.read') || canImport,
    },
    {
      key: 'schedule',
      label: 'Jadwal',
      href: `${base}/schedule`,
      show: permissions.includes('rab.read'),
    },
    {
      key: 'progress',
      label: 'Progres',
      href: `${base}/progress`,
      show: permissions.includes('rab.read'),
    },
  ];
  const current = active === 'imports' ? 'rab' : active;
  return (
    <nav className="access-tabs" aria-label="Bagian proyek">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === current ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
    </nav>
  );
}

/** Title block shared by every project tab, so the project's identity reads the same wherever the user is. */
export function ProjectHeader({ project: p, active }: { project: ProjectDto; active: ProjectTab }) {
  return (
    <>
      <PageTitle
        back={{ href: '/', label: 'Proyek saya' }}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.code}</span>
            <span>TA {p.fiscalYear}</span>
            {p.status === 'CLOSED' ? (
              <Badge tone="red">Ditutup</Badge>
            ) : (
              <Badge tone="green">Aktif</Badge>
            )}
          </span>
        }
        subtitle={`${p.location} · ${formatDate(p.startDate)} – ${formatDate(p.plannedFinishDate)}`}
      >
        {p.projectName}
      </PageTitle>
      <ProjectTabs projectId={p.id} active={active} permissions={p.permissions} />
    </>
  );
}
