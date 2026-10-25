'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          await api('POST', '/auth/logout');
        } finally {
          router.replace('/login');
          router.refresh();
        }
      }}
    >
      {busy ? 'Keluar…' : 'Logout'}
    </button>
  );
}
