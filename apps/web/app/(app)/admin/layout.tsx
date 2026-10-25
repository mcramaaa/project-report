import type { ReactNode } from 'react';
import { Alert } from '@/components/ui';
import { requireMe } from '@/lib/server-api';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  // UX only; every /api/admin/* call is checked by the API.
  if (!me.isSystemAdmin) return <Alert>Halaman ini hanya untuk system admin.</Alert>;
  return children;
}
