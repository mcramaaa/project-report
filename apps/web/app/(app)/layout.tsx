import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { requireMe } from '@/lib/server-api';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav aria-label="Navigasi utama" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold text-slate-900">
            Laporan Proyek
          </Link>
          <Link href="/" className="text-sm text-slate-700 hover:text-slate-900">
            Proyek Saya
          </Link>
          {/* UX only: the API rejects non-system-admins on /api/admin/* */}
          {me.isSystemAdmin && (
            <>
              <Link href="/admin/users" className="text-sm text-slate-700 hover:text-slate-900">
                Admin: User
              </Link>
              <Link href="/admin/projects" className="text-sm text-slate-700 hover:text-slate-900">
                Admin: Anggota Proyek
              </Link>
            </>
          )}
          <div className="ml-auto flex items-center gap-4">
            <Link href="/profile" className="text-sm text-slate-700 hover:text-slate-900">
              {me.name}
            </Link>
            <LogoutButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
