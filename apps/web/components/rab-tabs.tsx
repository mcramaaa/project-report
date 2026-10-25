import Link from 'next/link';

/** Navigation inside one RAB package. Project permissions are still enforced by the API. */
export function RabTabs({
  projectId,
  versionId,
  active,
  permissions,
}: {
  projectId: string;
  versionId: string;
  active: 'recap' | 'analyses' | 'materials' | 'equipment' | 'labor';
  permissions: string[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}/rab/${encodeURIComponent(versionId)}`;
  const tabs = [
    { key: 'recap', label: 'Rekap RAB', href: base, show: permissions.includes('rab.read') },
    {
      key: 'analyses',
      label: 'Analisa',
      href: `${base}/analyses`,
      show: permissions.includes('ahsp.read'),
    },
    ...[
      { key: 'materials', label: 'Bahan' },
      { key: 'equipment', label: 'Alat' },
      { key: 'labor', label: 'Upah' },
    ].map((tab) => ({
      ...tab,
      href: `${base}/${tab.key}`,
      show: permissions.includes('ahsp.read'),
    })),
  ];
  return (
    <nav className="access-tabs" aria-label="Bagian RAB">
      {tabs
        .filter((tab) => tab.show)
        .map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
    </nav>
  );
}

/** Exit the RAB workspace without introducing a second row of tabs. */
export function RabBackLinks({
  projectId,
  permissions,
}: {
  projectId: string;
  permissions: string[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
      <Link href={base} className="hover:text-blue-700">
        ← Kembali ke proyek
      </Link>
      {permissions.includes('rab.read') && (
        <Link href={`${base}/rab`} className="hover:text-blue-700">
          Semua versi RAB
        </Link>
      )}
    </div>
  );
}
