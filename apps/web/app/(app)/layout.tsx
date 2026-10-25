import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { requireMe } from '@/lib/server-api';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();

  return <AppShell user={{ name: me.name, email: me.email, isSystemAdmin: me.isSystemAdmin, permissions: me.permissions }}>{children}</AppShell>;
}
