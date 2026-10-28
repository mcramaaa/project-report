'use client';

import {
  correctionsOf,
  type CorrectionMark,
  type RabRowDto,
  type RabVersionDetailDto,
} from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from './icon';
import { InfoHint } from './info-hint';
import { Alert, Button, Field, Select } from './ui';
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
    <InfoHint
      label={last.kind === 'MANUAL' ? 'Koreksi manual' : 'Dihitung ulang'}
      text={[
        ...marks.map(
          (m) =>
            `${m.kind === 'MANUAL' ? 'Manual' : 'Dihitung ulang'} · ${m.by}, ${formatDate(m.at.slice(0, 10))}${m.reason ? `: ${m.reason}` : ''}`,
        ),
        'Bukan angka asli Excel; nilai sebelumnya ada di snapshot dan riwayat.',
      ].join('\n')}
      tone={last.kind === 'MANUAL' ? 'red' : 'blue'}
      icon="edit"
    />
  );
}

/**
 * Inline confirmation with a required reason, shown where the action starts (reopen, delete, reorder).
 * Never a modal: the affected row or card stays visible next to it.
 */
export function InlineReasonForm({
  id,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  label = 'Alasan koreksi (wajib)',
  onSubmit,
  onCancel,
}: {
  id: string;
  title: string;
  description: string;
  label?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    setError(reason ? undefined : 'Isi alasan terlebih dahulu.');
    if (reason) onSubmit(reason);
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      className={`inline-confirm${destructive ? ' inline-confirm-danger' : ''}`}
      aria-label={title}
    >
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="inline-confirm-fields">
        <Field id={id} name="reason" label={label} required autoFocus error={error} />
        <div className="row-actions">
          <Button type="submit" variant={destructive ? 'danger' : 'primary'} disabled={busy}>
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Batal
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Reason input placed inside the form that makes the correction (D-068). */
export function CorrectionReasonField({ id, error }: { id: string; error?: string }) {
  return (
    <div className="max-w-xl">
      <Field id={id} name="reason" label="Alasan koreksi (wajib)" required error={error} />
      <p className="field-hint">Dicatat di riwayat dan pada nilai yang berubah.</p>
    </div>
  );
}

/** Picks the work item of the previous version this row really continues (D-068); taken ones are excluded. */
export function WorkItemForm({
  projectId,
  previousVersionId,
  row,
  usedWorkItemIds,
  reopened,
  busy,
  onCancel,
  onSubmit,
}: {
  projectId: string;
  previousVersionId: string;
  row: RabRowDto;
  usedWorkItemIds: Set<string>;
  reopened: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (workItemId: string, reason: string) => Promise<void>;
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
    const form = new FormData(event.currentTarget);
    const id = String(form.get('workItemId') ?? '');
    if (id) void onSubmit(id, String(form.get('reason') ?? '').trim());
  }
  return (
    <form
      onSubmit={submit}
      className="panel form-panel space-y-3"
      aria-label="Koreksi identitas pekerjaan"
    >
      <h3 className="font-semibold">
        Ganti identitas pekerjaan · {row.description} ({row.workItemCode})
      </h3>
      <p className="text-sm text-slate-600">
        Pilih pekerjaan versi sebelumnya yang sebenarnya dilanjutkan baris ini. {row.workItemCode}{' '}
        tidak dihapus dan tetap ada di snapshot lama. Pekerjaan yang sudah dipakai baris lain tidak
        ditampilkan.
      </p>
      {error && <Alert>{error}</Alert>}
      <Field
        id="wi-search"
        label="Cari pekerjaan"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
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
        {items && options.length === 0 && (
          <p className="field-hint">Tidak ada pekerjaan yang cocok dan belum dipakai.</p>
        )}
      </div>
      {reopened && <CorrectionReasonField id="wi-reason" />}
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

/** The reason of the previous cell edit on this page, offered again (corrections usually share one). */
let lastReason = '';

/**
 * In-place correction of one source value (D-068): a pencil next to the value turns it into an input in the
 * same cell. Only that field is sent; the API recalculates the dependents and the page data is refreshed.
 */
export function InlineEdit({
  path,
  field,
  value,
  label,
  reopened,
  number,
  hint,
  editable = true,
  children,
}: {
  /** False renders the value only (no pencil), e.g. an approved version. */
  editable?: boolean;
  path: string;
  field: string;
  value: string;
  label: string;
  reopened: boolean;
  /** Integer field (rounding scale); empty clears it. */
  number?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reasonMissing, setReasonMissing] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('value') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();
    if (next === value) return setEditing(false);
    setReasonMissing(reopened && !reason);
    if (reopened && !reason) return;
    lastReason = reason;
    setBusy(true);
    setError(undefined);
    try {
      await api('PATCH', path, {
        [field]: number ? (next === '' ? null : Number(next)) : next,
        ...(reason ? { reason } : {}),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      const details = (err as { details?: { errors?: { message: string }[] } }).details;
      setError([errorMessage(err), ...(details?.errors ?? []).map((e) => e.message)].join(' '));
    } finally {
      setBusy(false);
    }
  }

  if (!editable) return children;
  if (!editing)
    return (
      <span className="inline-edit">
        {children}
        <button
          type="button"
          className="inline-edit-trigger"
          aria-label={`Koreksi ${label}`}
          title={`Koreksi ${label}`}
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" size={13} />
        </button>
      </span>
    );
  return (
    <form
      className="inline-edit-form"
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
      noValidate
      aria-label={`Koreksi ${label}`}
    >
      <input
        name="value"
        className="field"
        defaultValue={value}
        inputMode="decimal"
        aria-label={label}
        aria-describedby={`${id}-hint`}
        title={`Sekarang ${value === '' ? '(kosong)' : value}${hint ? `. ${hint}` : ''}`}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        type="submit"
        className="inline-edit-icon inline-edit-save"
        disabled={busy}
        aria-label="Simpan"
        title="Simpan (Enter)"
      >
        <Icon name="check" size={14} />
      </button>
      <button
        type="button"
        className="inline-edit-icon"
        disabled={busy}
        aria-label="Batal"
        title="Batal (Esc)"
        onClick={() => (setEditing(false), setError(undefined))}
      >
        <Icon name="close" size={14} />
      </button>
      {reopened && (
        <input
          name="reason"
          className="field inline-edit-reason"
          defaultValue={lastReason}
          placeholder={reasonMissing ? 'Isi alasan koreksi dulu' : 'Alasan koreksi (wajib)'}
          aria-label={`Alasan koreksi ${label}`}
          aria-invalid={reasonMissing}
          autoFocus={reasonMissing}
        />
      )}
      <span id={`${id}-hint`} className="sr-only">
        Nilai sekarang {value === '' ? 'kosong' : value}. {hint}
      </span>
      {error && (
        <p className="inline-edit-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
