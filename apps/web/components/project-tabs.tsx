import Link from 'next/link';

export type ProjectTab = 'info' | 'calendar' | 'team' | 'rab' | 'imports' | 'analyses';

/** Project section tabs shown by project permission (UX hint; the API checks). */
export function ProjectTabs({ projectId, active, permissions }: { projectId: string; active: ProjectTab; permissions: string[] }) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const tabs: { key: ProjectTab; label: string; href: string; show: boolean }[] = [
    { key: 'info', label: 'Informasi', href: base, show: true },
    { key: 'calendar', label: 'Minggu & Periode', href: `${base}?tab=calendar`, show: true },
    { key: 'team', label: 'Tim', href: `${base}?tab=team`, show: true },
    { key: 'rab', label: 'RAB', href: `${base}/rab`, show: permissions.includes('rab.read') },
    { key: 'analyses', label: 'Analisa', href: `${base}/analyses`, show: permissions.includes('ahsp.read') },
    {
      key: 'imports',
      label: 'Impor RAB',
      href: `${base}/imports`,
      show: ['document.read', 'rabImport.review', 'rabImport.approve'].some((p) => permissions.includes(p)),
    },
  ];
  return (
    <nav className="access-tabs" aria-label="Bagian proyek">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === active ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
    </nav>
  );
}
