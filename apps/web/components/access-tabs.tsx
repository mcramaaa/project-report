import type { MeResponse } from '@laporan-proyek/shared';
import Link from 'next/link';
import { can } from '@/lib/permissions';

type Tab = 'users' | 'roles' | 'projects';

/** Manajemen akses tabs (pattern from olmat-backoffice); each tab shows only with its read permission. */
export function AccessTabs({ me, active }: { me: MeResponse; active: Tab }) {
  const tabs: { key: Tab; href: string; label: string; show: boolean }[] = [
    { key: 'users', href: '/admin/users', label: 'Pengguna', show: can(me, 'users.read') },
    { key: 'roles', href: '/admin/roles', label: 'Role & permission', show: can(me, 'roles.read') },
    { key: 'projects', href: '/admin/projects', label: 'Akses proyek', show: can(me, 'assignments.read') },
  ];
  return (
    <nav className="access-tabs" aria-label="Manajemen akses">
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
