'use client';

import type { ScenarioDetailDto, ScenarioSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, EmptyState, Section, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/project-fields';

/** D-078: the team's what-if schedules; schedule editors create them from a schedule. */
export function Scenarios({
  projectId,
  scenarios,
  schedules,
  canEdit,
}: {
  projectId: string;
  scenarios: ScenarioSummaryDto[];
  /** Schedules a scenario can start from, the reference one first. */
  schedules: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [listError, setListError] = useState<string>();

  async function remove(s: ScenarioSummaryDto) {
    if (!window.confirm(`Hapus skenario "${s.name}"? Jadwal resmi tidak berubah.`)) return;
    setDeleting(s.id);
    setListError(undefined);
    try {
      await api('DELETE', `/projects/${projectId}/schedule-scenarios/${s.id}`);
      router.refresh();
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setDeleting(undefined);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const s = await api<ScenarioDetailDto>('POST', `/projects/${projectId}/schedule-scenarios`, {
        scheduleId,
        name: name.trim(),
      });
      router.push(`/projects/${projectId}/schedule/scenarios/${s.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Section
      className="mt-4"
      id="scenarios"
      title="Simulasi jadwal"
      description="Coba geser pekerjaan, ubah durasi, atau tambah waktu tanpa mengubah jadwal resmi. Skenario terlihat oleh seluruh tim dan bisa dijadikan revisi jadwal resmi."
      body={false}
    >
      {canEdit && schedules.length > 0 && (
        <form onSubmit={create} className="surface-body flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <label htmlFor="new-scenario-name" className="field-label">
              Nama skenario baru
            </label>
            <input
              id="new-scenario-name"
              className="field"
              value={name}
              maxLength={120}
              placeholder="mis. Atap dipercepat 2 minggu"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="new-scenario-base" className="field-label">
              Salin dari jadwal
            </label>
            <Select
              id="new-scenario-base"
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
            >
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={busy || !name.trim() || !scheduleId}>
            {busy ? 'Membuat…' : 'Buat skenario'}
          </Button>
          {error && (
            <p role="alert" className="field-error w-full">
              {error}
            </p>
          )}
        </form>
      )}
      {listError && (
        <p role="alert" className="surface-body field-error">
          {listError}
        </p>
      )}
      {scenarios.length === 0 ? (
        <div className="surface-body">
          <EmptyState>Belum ada skenario.</EmptyState>
        </div>
      ) : (
        <div className="data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  Skenario
                </th>
                <th role="columnheader" scope="col">
                  Dari jadwal
                </th>
                <th role="columnheader" scope="col">
                  Minggu
                </th>
                <th role="columnheader" scope="col">
                  Terakhir diubah
                </th>
                <th role="columnheader" scope="col">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {scenarios.map((s) => (
                <tr role="row" key={s.id}>
                  <td role="cell" data-label="Skenario" className="font-medium">
                    {s.name}
                  </td>
                  <td role="cell" data-label="Dari jadwal">
                    {s.schedule.rabVersionLabel}
                  </td>
                  <td role="cell" data-label="Minggu">
                    {s.weekCount}
                  </td>
                  <td role="cell" data-label="Terakhir diubah">
                    {s.updatedBy.name}, {formatDate(s.updatedAt.slice(0, 10))}
                  </td>
                  <td role="cell" data-label="Aksi">
                    <div className="row-actions">
                      <Link
                        className="btn btn-secondary"
                        href={`/projects/${projectId}/schedule/scenarios/${s.id}`}
                      >
                        Buka
                      </Link>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="danger"
                          disabled={deleting === s.id}
                          aria-label={`Hapus skenario ${s.name}`}
                          onClick={() => void remove(s)}
                        >
                          {deleting === s.id ? 'Menghapus…' : 'Hapus'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
