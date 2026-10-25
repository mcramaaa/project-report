'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, type ReactNode } from 'react';
import { Brand } from './brand';
import { Icon, type IconName } from './icon';
import { can } from '@/lib/permissions';
import { LogoutButton } from './logout-button';

type ShellUser = { name: string; email: string; isSystemAdmin: boolean; permissions: string[] };
type NavItem = { href: string; label: string; icon: IconName; group: string };

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const items: NavItem[] = [
    { href: '/', label: 'Proyek saya', icon: 'grid', group: 'Ruang kerja' },
    // UX only: the API checks each permission (docs/PERMISSIONS.md).
    ...(can(user, 'users.read') ? [{ href: '/admin/users', label: 'Pengguna', icon: 'users' as const, group: 'Manajemen akses' }] : []),
    ...(can(user, 'roles.read') ? [{ href: '/admin/roles', label: 'Role & permission', icon: 'lock' as const, group: 'Manajemen akses' }] : []),
    ...(can(user, 'assignments.read') ? [{ href: '/admin/projects', label: 'Akses proyek', icon: 'shield' as const, group: 'Manajemen akses' }] : []),
    { href: '/profile', label: 'Profil & keamanan', icon: 'user', group: 'Akun' },
  ];
  const active = (href: string) => href === '/' ? pathname === '/' || pathname.startsWith('/projects/') : pathname === href || pathname.startsWith(`${href}/`);
  const current = items.find((item) => active(item.href));
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();

  function navigation(mobile = false) {
    return <nav className="sidebar-nav" aria-label={mobile ? 'Navigasi mobile' : 'Navigasi utama'}>
      {[...new Set(items.map((item) => item.group))].map((group) => <div className="nav-group" key={group}>
        <p className="nav-group-label">{group}</p>
        {items.filter((item) => item.group === group).map((item) => <Link key={item.href} href={item.href} className="nav-link" aria-current={active(item.href) ? 'page' : undefined} onClick={() => drawer.current?.close()}><Icon name={item.icon} size={19} /><span>{item.label}</span>{active(item.href) && <span className="nav-active-dot" />}</Link>)}
      </div>)}
    </nav>;
  }

  return <div className="app-frame">
    <a className="skip-link" href="#main-content">Lewati ke konten</a>
    <aside className="sidebar">
      <Link href="/" className="sidebar-brand" aria-label="Laporan Proyek, beranda"><Brand /></Link>
      {navigation()}
      <div className="sidebar-footer"><div className="workspace-note"><Icon name="shield" size={18} /><span>Akses sesuai penugasan<small>Ruang kerja proyek Anda</small></span></div><Link href="/profile" className="account-card"><span className="avatar">{initials}</span><span className="min-w-0"><strong>{user.name}</strong><small>{user.email}</small></span><Icon name="chevron" size={15} /></Link></div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-3"><button type="button" className="icon-button mobile-menu-trigger" aria-label="Buka menu navigasi" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><Icon name="menu" /></button><div className="breadcrumb"><Icon name="building" size={16} /><span>Workspace</span><Icon name="chevron" size={12} /><strong>{current?.label ?? 'Informasi proyek'}</strong></div></div>
        <div className="flex items-center gap-4"><Link href="/profile" className="topbar-account"><span className="account-caption"><strong>{user.name}</strong><small>{user.isSystemAdmin ? 'Super admin' : user.permissions.length ? 'Admin akses' : 'Anggota proyek'}</small></span><span className="avatar avatar-small">{initials}</span></Link><span className="topbar-divider" /><LogoutButton /></div>
      </header>
      <main id="main-content" className="app-content" tabIndex={-1}>{children}</main>
      <footer className="app-footer"><span>LaporanProyek <span aria-hidden="true">·</span> Ruang kerja konstruksi</span><span>Terstruktur. Tertelusur. Terjaga.</span></footer>
    </div>
    <nav className="mobile-bottom-nav" aria-label="Navigasi cepat">{items.slice(0, 3).map((item) => <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined}><Icon name={item.icon} size={20} /><span>{item.label}</span></Link>)}<button type="button" aria-label="Buka semua menu" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><Icon name="menu" /><span>Menu</span></button></nav>
    <dialog ref={drawer} className="mobile-drawer" aria-label="Menu navigasi" onClick={(event) => { if (event.target === event.currentTarget && event.clientX > event.currentTarget.getBoundingClientRect().right) drawer.current?.close(); }}><div className="drawer-head"><Brand /><button className="icon-button" type="button" aria-label="Tutup menu" onClick={() => drawer.current?.close()}><Icon name="close" /></button></div>{navigation(true)}<div className="drawer-account"><strong>{user.name}</strong><p>{user.email}</p><LogoutButton /></div></dialog>
  </div>;
}
