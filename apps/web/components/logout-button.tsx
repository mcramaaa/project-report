'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from './icon';

export function LogoutButton({ className = 'btn btn-secondary' }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
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
      <Icon name="logout" size={16} />
      {busy ? 'Keluar…' : 'Keluar'}
    </button>
  );
}
