'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Brand } from './brand';
import { Icon, type IconName } from './icon';
import { can } from '@/lib/permissions';
import { LogoutButton } from './logout-button';

type ShellUser = { name: string; email: string; isSystemAdmin: boolean; permissions: string[] };
type NavItem = { href: string; label: string; short: string; icon: IconName; group: string };
const SIDEBAR_PREFERENCE = 'sidebar-collapsed';

function subscribeSidebarPreference(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('sidebar-preference-change', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('sidebar-preference-change', onChange);
  };
}

function getSidebarPreference() {
  return window.localStorage.getItem(SIDEBAR_PREFERENCE) === 'true';
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const accountMenu = useRef<HTMLDialogElement>(null);
  const sidebarCollapsed = useSyncExternalStore(subscribeSidebarPreference, getSidebarPreference, () => false);
  // One entry for access management; delegates land on their first permitted tab.
  const accessHref = can(user, 'users.read')
    ? '/admin/users'
    : can(user, 'roles.read')
      ? '/admin/roles'
      : can(user, 'assignments.read')
        ? '/admin/projects'
        : undefined;
  const items: NavItem[] = [
    { href: '/', label: 'Proyek saya', short: 'Proyek', icon: 'grid', group: 'Ruang kerja' },
    // UX only: the API checks each permission (docs/PERMISSIONS.md).
    ...(accessHref
      ? [{ href: accessHref, label: 'Pengguna', short: 'Akses', icon: 'users' as const, group: 'Manajemen akses' }]
      : []),
    { href: '/profile', label: 'Profil & keamanan', short: 'Profil', icon: 'user', group: 'Akun' },
  ];
  const active = (href: string) =>
    href === accessHref
      ? pathname.startsWith('/admin/')
      : href === '/'
        ? pathname === '/' || pathname.startsWith('/projects/')
        : pathname === href || pathname.startsWith(`${href}/`);
  const current = items.find((item) => active(item.href));
  const currentLabel = pathname.startsWith('/admin/roles')
    ? 'Role & permission'
    : pathname.startsWith('/admin/projects')
      ? 'Akses proyek'
      : (current?.label ?? 'Informasi proyek');
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href?: string }[] =
    pathname.startsWith('/projects/') && parts[1] !== 'new'
      ? [
          { label: 'Proyek', href: '/' },
          { label: 'Detail proyek', href: `/projects/${parts[1]}` },
          ...(parts[2] === 'rab'
            ? [
                { label: 'RAB', href: `/projects/${parts[1]}/rab` },
                ...(parts[3] && parts[3] !== 'compare'
                  ? [{ label: 'Lihat RAB', href: `/projects/${parts[1]}/rab/${parts[3]}` }]
                  : []),
                ...(parts[4]
                  ? [
                      {
                        label:
                          (
                            {
                              analyses: 'Analisa',
                              materials: 'Bahan',
                              equipment: 'Alat',
                              labor: 'Upah',
                            } as Record<string, string>
                          )[parts[4]] ?? 'Rincian',
                      },
                    ]
                  : parts[3] === 'compare'
                    ? [{ label: 'Perbandingan' }]
                    : []),
              ]
            : parts[2] === 'imports'
              ? [
                  { label: 'Dokumen & impor', href: `/projects/${parts[1]}/imports` },
                  ...(parts[3] ? [{ label: 'Review impor' }] : []),
                ]
              : parts[2] === 'documents'
                ? [{ label: 'Sumber Excel' }]
                : []),
        ]
      : [{ label: currentLabel }];
  const role = user.isSystemAdmin ? 'Super admin' : user.permissions.length ? 'Admin akses' : 'Anggota proyek';
  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  function navigation(mobile = false) {
    const iconOnly = !mobile && sidebarCollapsed;
    return (
      <nav className="sidebar-nav" aria-label={mobile ? 'Navigasi mobile' : 'Navigasi utama'}>
        {[...new Set(items.map((item) => item.group))].map((group) => (
          <div key={group}>
            <p className="nav-group-label">{group}</p>
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  aria-current={active(item.href) ? 'page' : undefined}
                  aria-label={iconOnly ? item.label : undefined}
                  title={iconOnly ? item.label : undefined}
                  onClick={() => drawer.current?.close()}
                >
                  <Icon name={item.icon} size={18} />
                  <span className="nav-label">{item.label}</span>
                </Link>
              ))}
          </div>
        ))}
      </nav>
    );
  }

  const accountCard = (
    <Link
      href="/profile"
      className="account-card"
      aria-label={`Profil ${user.name}`}
      title={sidebarCollapsed ? `Profil ${user.name}` : undefined}
      onClick={() => drawer.current?.close()}
    >
      <span className="avatar">{initials}</span>
      <span className="account-copy">
        <strong>{user.name}</strong>
        <small>{user.email}</small>
      </span>
    </Link>
  );

  return (
    <div className="app-frame" data-sidebar-collapsed={sidebarCollapsed}>
      <a className="skip-link" href="#main-content">
        Lewati ke konten
      </a>
      <aside className="sidebar" aria-label="Sidebar">
        <Link href="/" className="sidebar-brand" aria-label="Laporan Proyek, beranda" title={sidebarCollapsed ? 'Laporan Proyek' : undefined}>
          <Brand />
        </Link>
        {navigation()}
        <div className="sidebar-footer">
          {accountCard}
          <div className="sidebar-collapse">
            <span className="version-text">Akses sesuai penugasan</span>
            <button
              type="button"
              aria-label={sidebarCollapsed ? 'Perluas sidebar' : 'Ringkas sidebar'}
              title={sidebarCollapsed ? 'Perluas sidebar' : 'Ringkas sidebar'}
              aria-expanded={!sidebarCollapsed}
              onClick={() => {
                window.localStorage.setItem(SIDEBAR_PREFERENCE, String(!sidebarCollapsed));
                window.dispatchEvent(new Event('sidebar-preference-change'));
              }}
            >
              <Icon name={sidebarCollapsed ? 'chevron' : 'chevron-left'} size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="mobile-brand" aria-label="Laporan Proyek, beranda">
              <Brand />
            </Link>
            <nav className="breadcrumb" aria-label="Lokasi halaman">
              <Icon name="building" size={15} />
              {crumbs.map((crumb, index) => (
                <span key={index} className="inline-flex items-center gap-2">
                  {index > 0 && <Icon name="chevron" size={12} />}
                  {crumb.href && index !== crumbs.length - 1 ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <strong aria-current="page">{crumb.label}</strong>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="topbar-account"
              aria-label="Buka menu akun"
              aria-haspopup="dialog"
              onClick={() => accountMenu.current?.showModal()}
            >
              <span className="topbar-account-copy">
                <strong>{user.name}</strong>
                <small>{role}</small>
              </span>
              <span className="avatar">{initials}</span>
            </button>
            <button
              type="button"
              className="icon-button mobile-menu-trigger"
              aria-label="Buka menu navigasi"
              aria-haspopup="dialog"
              onClick={() => drawer.current?.showModal()}
            >
              <Icon name="menu" />
            </button>
          </div>
        </header>
        <main id="main-content" className="app-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>LaporanProyek, ruang kerja konstruksi</span>
          <span>Akses sesuai penugasan</span>
        </footer>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Navigasi cepat">
        {items.slice(0, 3).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? 'page' : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.short}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-label="Buka semua menu"
          aria-haspopup="dialog"
          onClick={() => drawer.current?.showModal()}
        >
          <Icon name="menu" />
          <span>Menu</span>
        </button>
      </nav>
      <dialog
        ref={drawer}
        className="mobile-drawer"
        aria-label="Menu navigasi"
        onClick={(event) => {
          if (
            event.target === event.currentTarget &&
            event.clientX > event.currentTarget.getBoundingClientRect().right
          )
            drawer.current?.close();
        }}
      >
        <div className="drawer-head">
          <Brand />
          <button
            className="icon-button"
            type="button"
            aria-label="Tutup menu"
            onClick={() => drawer.current?.close()}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {navigation(true)}
        <div className="sidebar-footer">
          {accountCard}
          <LogoutButton className="btn btn-ghost mt-2 w-full" />
        </div>
      </dialog>
      <dialog
        ref={accountMenu}
        className="modal-dialog"
        aria-labelledby="account-menu-title"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.target === event.currentTarget &&
            (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
          )
            accountMenu.current?.close();
        }}
      >
        <div className="modal-head">
          <div className="flex min-w-0 items-center gap-3">
            <span className="avatar">{initials}</span>
            <div className="min-w-0">
              <h2 id="account-menu-title">{user.name}</h2>
              <p>
                {user.email} · {role}
              </p>
            </div>
          </div>
          <button type="button" className="icon-button" aria-label="Tutup menu akun" onClick={() => accountMenu.current?.close()}>
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="modal-body flex flex-wrap gap-3">
          <Link className="btn btn-secondary" href="/profile" onClick={() => accountMenu.current?.close()}>
            <Icon name="user" size={16} />
            Profil & keamanan
          </Link>
          <LogoutButton className="btn btn-danger" />
        </div>
      </dialog>
    </div>
  );
}
