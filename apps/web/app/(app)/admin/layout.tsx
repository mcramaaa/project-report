import type { ReactNode } from 'react';
import { Alert } from '@/components/ui';
import { ADMIN_PERMISSIONS, can } from '@/lib/permissions';
import { requireMe } from '@/lib/server-api';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  // UX only; every /api/admin/* call is checked by the API.
  if (!ADMIN_PERMISSIONS.some((p) => can(me, p))) return <Alert>Halaman ini memerlukan hak akses manajemen akses.</Alert>;
  return children;
}
