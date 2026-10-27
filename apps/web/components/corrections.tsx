'use client';

import {
  correctionsOf,
  type CorrectionMark,
  type RabRowDto,
  type RabVersionDetailDto,
} from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Select } from './ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/project-fields';

/** D-068: a corrected value is labelled so it is never read as the original workbook figure. */
export function correctionNote(mark: CorrectionMark): string {
  const what = mark.kind === 'MANUAL' ? 'Dikoreksi manual' : 'Dihitung ulang dari koreksi sumber';
  return `${what} oleh ${mark.by} (${formatDate(mark.at.slice(0, 10))})${mark.reason ? `: ${mark.reason}` : ''}. Bukan angka asli Excel; nilai sebelumnya ada di snapshot dan riwayat.`;
}

export function CorrectionBadge({ locator }: { locator: unknown }) {
  const marks = correctionsOf(locator);
  const last = marks.at(-1);
  if (!last) return null;
  return (
    <span className="ml-1" title={marks.map(correctionNote).join('\n')}>
      <Badge tone={last.kind === 'MANUAL' ? 'red' : 'blue'}>
        {last.kind === 'MANUAL' ? 'koreksi manual' : 'dihitung ulang'}
      </Badge>
    </span>
  );
}

export function ReopenPanel({
  label,
  busy,
  onReopen,
}: {
  label: string;
  busy: boolean;
  onReopen: (reason: string) => Promise<unknown>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    if (
      window.confirm(
        `Buka kembali RAB ${label} untuk koreksi? Kondisi approved sekarang disimpan sebagai snapshot dan versi harus di-approve ulang.`,
      )
    )
      void onReopen(reason);
  }
  return (
    <details className="panel form-panel">
      <summary className="font-semibold">Buka kembali untuk koreksi</summary>
      <form onSubmit={submit} noValidate className="mt-3 space-y-2">
        <p className="text-sm text-slate-600">
          Versi yang sama dibuka kembali; snapshot approved, dokumen Excel asli, dan versi lain
          tidak berubah. Selama koreksi, versi baru dan impor resmi ditahan.
        </p>
        <Field id="rab-reopen-reason" name="reason" label="Alasan koreksi (wajib)" required />
        <Button type="submit" disabled={busy}>
          Buka kembali
        </Button>
      </form>
    </details>
  );
}

export function CorrectionPanel({
  reason,
  onReason,
  canEdit,
}: {
  reason: string;
  onReason: (reason: string) => void;
  canEdit: boolean;
}) {
  return (
    <Alert kind="info">
      <p>
        Versi ini sedang <strong>dibuka untuk koreksi</strong>. Ubah nilai pada sumbernya: volume,
        uraian, PPN, atau harga langsung di sini; harga dari analisa lewat tab Bahan/Upah/Alat dan
        detail analisa. Setiap perubahan dicatat dengan alasan dan ditandai sebagai koreksi.
      </p>
      {canEdit ? (
        <div className="mt-2 max-w-xl">
          <Field
            id="rab-correction-reason"
            label="Alasan koreksi untuk perubahan berikutnya (wajib)"
            value={reason}
            required
            onChange={(event) => onReason(event.target.value)}
          />
        </div>
      ) : (
        <p className="mt-1">Role Anda hanya dapat melihat versi ini selama koreksi.</p>
      )}
    </Alert>
  );
}

/** Picks the work item of the previous version this row really continues (D-068); taken ones are excluded. */
export function WorkItemForm({
  projectId,
  previousVersionId,
  row,
  usedWorkItemIds,
  busy,
  onCancel,
  onSubmit,
}: {
  projectId: string;
  previousVersionId: string;
  row: RabRowDto;
  usedWorkItemIds: Set<string>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (workItemId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<RabRowDto[]>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  useEffect(() => {
    api<RabVersionDetailDto>('GET', `/projects/${projectId}/rab-versions/${previousVersionId}`)
      .then((d) => setItems(d.rows.filter((r) => r.rowType === 'ITEM')))
      .catch((err) => setError(errorMessage(err)));
  }, [projectId, previousVersionId]);
  const q = search.trim().toLocaleLowerCase('id');
  const options = (items ?? []).filter(
    (r) =>
      r.workItemId !== row.workItemId &&
      !usedWorkItemIds.has(r.workItemId!) &&
      (!q || `${r.workItemCode} ${r.description}`.toLocaleLowerCase('id').includes(q)),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get('workItemId') ?? '');
    if (id) void onSubmit(id);
  }
  return (
    <form onSubmit={submit} className="panel form-panel space-y-3" aria-label="Koreksi identitas pekerjaan">
      <h3 className="font-semibold">
        Ganti identitas pekerjaan · {row.description} ({row.workItemCode})
      </h3>
      <p className="text-sm text-slate-600">
        Pilih pekerjaan versi sebelumnya yang sebenarnya dilanjutkan baris ini. {row.workItemCode}{' '}
        tidak dihapus dan tetap ada di snapshot lama. Pekerjaan yang sudah dipakai baris lain tidak
        ditampilkan.
      </p>
      {error && <Alert>{error}</Alert>}
      <Field id="wi-search" label="Cari pekerjaan" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div>
        <label htmlFor="wi-select" className="field-label">
          Pekerjaan versi sebelumnya
        </label>
        <Select id="wi-select" name="workItemId" required disabled={!items}>
          {options.map((r) => (
            <option key={r.id} value={r.workItemId!}>
              {r.workItemCode} · {r.displayNumber ? `${r.displayNumber}. ` : ''}
              {r.description} ({r.unit ?? '–'})
            </option>
          ))}
        </Select>
        {items && options.length === 0 && <p className="field-hint">Tidak ada pekerjaan yang cocok dan belum dipakai.</p>}
      </div>
      <div className="row-actions">
        <Button type="submit" disabled={busy || !options.length}>
          Simpan koreksi WI
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  );
}

/**
 * Small toggle form for one source edit (base price, coefficient, manual component price, overhead, rounding).
 * Only changed fields are sent; the API recalculates the dependents and refreshes the page data.
 */
export function CorrectionForm({
  path,
  reopened,
  title,
  fields,
}: {
  path: string;
  reopened: boolean;
  title: string;
  fields: { name: string; label: string; value: string; hint?: string; number?: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[]>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | number | null> = {};
    for (const f of fields) {
      const value = String(form.get(f.name) ?? '').trim();
      if (value === f.value) continue;
      body[f.name] = f.number ? (value === '' ? null : Number(value)) : value;
    }
    const reason = String(form.get('reason') ?? '').trim();
    if (reopened && !reason) {
      setError(['Isi alasan koreksi terlebih dahulu sebelum menyimpan perubahan.']);
      return;
    }
    if (reason) body.reason = reason;
    setBusy(true);
    setError(undefined);
    try {
      await api('PATCH', path, body);
      setOpen(false);
      router.refresh();
    } catch (err) {
      const details = (err as { details?: { errors?: { message: string }[] } }).details;
      setError([errorMessage(err), ...(details?.errors ?? []).map((e) => e.message)]);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button variant="secondary" className="btn-compact" onClick={() => setOpen(true)}>
        Koreksi
      </Button>
    );
  return (
    <form onSubmit={submit} noValidate className="space-y-2 text-left" aria-label={title}>
      {error && (
        <Alert>
          {error.map((m, i) => (
            <span key={i} className="block">
              {m}
            </span>
          ))}
        </Alert>
      )}
      {fields.map((f) => (
        <div key={f.name}>
          <Field id={`${path}-${f.name}`} name={f.name} label={f.label} defaultValue={f.value} inputMode="decimal" />
          {f.hint && <p className="field-hint">{f.hint}</p>}
        </div>
      ))}
      <Field
        id={`${path}-reason`}
        name="reason"
        label={reopened ? 'Alasan koreksi (wajib)' : 'Alasan (opsional pada draft)'}
        required={reopened}
      />
      <div className="row-actions">
        <Button type="submit" className="btn-compact" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan & hitung ulang'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
