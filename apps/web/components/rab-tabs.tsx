import type { RabVersionStatus } from '@laporan-proyek/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RAB_STATUS_BADGE } from '@/lib/rab-ui';
import { Icon } from './icon';
import { Badge, PageTitle } from './ui';

type RabTab = 'recap' | 'analyses' | 'materials' | 'equipment' | 'labor';

/** Navigation inside one RAB package. Project permissions are still enforced by the API. */
export function RabTabs({
  projectId,
  versionId,
  active,
  permissions,
}: {
  projectId: string;
  versionId: string;
  active: RabTab;
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

/**
 * One header for every page of a RAB package: the version is the page title, the project its context,
 * and the tabs sit directly under it (recap, analyses, prices).
 */
export function RabWorkspaceHead({
  project,
  versionId,
  version,
  active,
  actions,
}: {
  project: { id: string; code: string; projectName: string; permissions: string[] };
  versionId: string;
  version?: { label: string; status: string } | null;
  active: RabTab;
  actions?: ReactNode;
}) {
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const status = version ? RAB_STATUS_BADGE[version.status as RabVersionStatus] : undefined;
  return (
    <>
      <PageTitle
        back={
          project.permissions.includes('rab.read')
            ? { href: `${base}/rab`, label: 'Semua versi RAB' }
            : { href: base, label: 'Kembali ke proyek' }
        }
        eyebrow={
          <>
            <span className="font-mono">{project.code}</span> {project.projectName}
          </>
        }
        actions={actions}
      >
        <span className="inline-flex flex-wrap items-center gap-3">
          {version ? `RAB ${version.label}` : 'Paket RAB'}
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
        </span>
      </PageTitle>
      <RabTabs
        projectId={project.id}
        versionId={versionId}
        active={active}
        permissions={project.permissions}
      />
    </>
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
    <nav className="-mt-2 mb-5 flex flex-wrap items-center gap-2" aria-label="Keluar dari RAB">
      <Link href={base} className="btn btn-ghost btn-compact">
        <Icon name="arrow-left" size={14} />
        Kembali ke proyek
      </Link>
      {permissions.includes('rab.read') && (
        <Link href={`${base}/rab`} className="btn btn-ghost btn-compact">
          Semua versi RAB
        </Link>
      )}
    </nav>
  );
}
