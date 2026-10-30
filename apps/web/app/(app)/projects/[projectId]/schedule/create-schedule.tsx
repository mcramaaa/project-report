'use client';

import type { ScheduleDetailDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export function CreateSchedule({ projectId, rabVersionId, label }: { projectId: string; rabVersionId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api<ScheduleDetailDto>('POST', `/projects/${projectId}/schedules`, { rabVersionId });
      router.push(`/projects/${projectId}/schedule/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" onClick={() => void create()} disabled={busy}>
        {busy ? 'Membuat…' : `Buat jadwal ${label}`}
      </Button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
