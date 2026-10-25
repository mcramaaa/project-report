'use client';

import { RAB_ROW_TYPES, type RabIssue, type RabRowDto, type RabRowType, type RabVersionDetailDto } from '@laporan-proyek/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatNumber, formatRounded } from '@/lib/project-fields';
import { RAB_COLUMNS, RAB_ROW_TYPE_LABEL, RAB_STATUS_BADGE, type RabColumn } from '@/lib/rab-ui';

const COLUMNS_KEY = 'rab-columns';
const ITEM_FIELDS = [
  { name: 'volume', label: 'Volume', hint: 'maks. 12 desimal', inputMode: 'decimal' },
  { name: 'unit', label: 'Satuan' },
  { name: 'analysisCode', label: 'No analisa' },
  { name: 'unitPrice', label: 'Harga satuan (Rp)', hint: 'tanpa pemisah ribuan', inputMode: 'decimal' },
  { name: 'taxPercent', label: 'PPN (%)', inputMode: 'decimal' },
] as const;

type Notice = { kind: 'success' | 'error'; text: string; issues?: RabIssue[] };
type Result = { ok: boolean; fieldErrors: Record<string, string> };

function loadColumns(): RabColumn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null') as RabColumn[] | null;
    if (Array.isArray(saved)) return saved.filter((c) => RAB_COLUMNS.some((col) => col.key === c));
  } catch {
    // Storage unavailable or corrupt: fall back to all columns.
  }
  return RAB_COLUMNS.map((c) => c.key);
}

function cell(row: RabRowDto, column: RabColumn): string {
  switch (column) {
    case 'volume':
      return formatNumber(row.volume, { trim: true });
    case 'unit':
      return row.unit ?? '';
    case 'analysisCode':
      return row.analysisCode ?? '';
    case 'taxPercent':
      return row.taxPercent === null ? '' : formatNumber(row.taxPercent, { trim: true });
    case 'weight':
      return formatRounded(row.weight, 4);
    default:
      // Amounts are exact (D-043); show them like the workbook, to 2 decimals.
      return row[column] === null ? '' : formatRounded(row[column], 2);
  }
}

export function RabEditor({ projectId, initial, canEdit, canApprove }: { projectId: string; initial: RabVersionDetailDto; canEdit: boolean; canApprove: boolean }) {
  const [detail, setDetail] = useState(initial);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [adding, setAdding] = useState<{ parentId: string | null }>();
  const [columns, setColumns] = useState<RabColumn[]>(RAB_COLUMNS.map((c) => c.key));
  const { version, rows, totals, issues } = detail;
  const draft = version.status === 'DRAFT';
  const editable = draft && canEdit && !busy;
  const base = `/projects/${projectId}/rab-versions/${version.id}`;
  const shown = RAB_COLUMNS.filter((c) => columns.includes(c.key));

  // Read the saved column choice after mount (localStorage is browser-only).
  useEffect(() => {
    const saved = loadColumns();
    const id = requestAnimationFrame(() => setColumns(saved));
    return () => cancelAnimationFrame(id);
  }, []);

  function toggleColumn(key: RabColumn) {
    const next = columns.includes(key) ? columns.filter((c) => c !== key) : [...columns, key];
    setColumns(next);
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // Per-browser convenience only.
    }
  }

  /** Every RAB mutation returns the fresh version detail; failures return the field errors for the form. */
  async function run(method: string, path: string, body: unknown, success: string): Promise<Result> {
    setBusy(true);
    setNotice(undefined);
    try {
      setDetail(await api<RabVersionDetailDto>(method, `${base}${path}`, body));
      setNotice({ kind: 'success', text: success });
      return { ok: true, fieldErrors: {} };
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { errors?: RabIssue[]; warnings?: RabIssue[] } | undefined) : undefined;
      const issues = [...(details?.errors ?? []), ...(details?.warnings ?? [])].filter((i) => !('path' in i));
      setNotice({ kind: 'error', text: errorMessage(err), issues });
      return { ok: false, fieldErrors: err instanceof ApiError ? err.fieldErrors : {} };
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel rab-header" aria-labelledby="rab-title">
        <div className="min-w-0">
          <h2 id="rab-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            RAB {version.label} <Badge tone={RAB_STATUS_BADGE[version.status].tone}>{RAB_STATUS_BADGE[version.status].label}</Badge>
          </h2>
          <p className="text-sm text-slate-600">
            Dokumen: {version.documentNumber ?? '–'}
            {version.documentDate && ` · ${formatDate(version.documentDate)}`}
            {version.approvedBy && ` · approved oleh ${version.approvedBy.name}`}
          </p>
        </div>
        <dl className="calendar-preview">
          <div>
            <dt>Total sebelum PPN</dt>
            <dd className="tabular-nums">Rp {formatRounded(totals.beforeTax, 2)}</dd>
          </div>
          <div>
            <dt>Total (real cost)</dt>
            <dd className="tabular-nums">Rp {formatNumber(totals.realCost)}</dd>
          </div>
          <div>
            <dt>Dibulatkan</dt>
            <dd className="tabular-nums">Rp {formatNumber(totals.rounded)}</dd>
          </div>
        </dl>
      </section>

      {notice && (
        <Alert kind={notice.kind}>
          {notice.text}
          {notice.issues && notice.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {notice.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {draft && canEdit && <DocumentForm key={version.id} version={version} busy={busy} onSave={(body) => run('PATCH', '', body, 'Data dokumen disimpan.')} />}
      {draft && <IssuesPanel errors={issues.errors} warnings={issues.warnings} />}

      <div className="toolbar">
        <details className="column-picker">
          <summary className="btn btn-secondary">Kolom</summary>
          <fieldset>
            <legend className="sr-only">Kolom yang ditampilkan</legend>
            {RAB_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} /> {c.label}
              </label>
            ))}
          </fieldset>
        </details>
        {editable && (
          <Button variant="secondary" onClick={() => (setEditingId(undefined), setAdding({ parentId: null }))}>
            Tambah baris teratas
          </Button>
        )}
      </div>

      {adding && editable && (
        <RowForm
          title={`Tambah baris${adding.parentId ? ` di bawah "${rows.find((r) => r.id === adding.parentId)?.description}"` : ' di tingkat teratas'}`}
          allowedTypes={adding.parentId ? RAB_ROW_TYPES.filter((t) => t !== 'SECTION') : RAB_ROW_TYPES}
          busy={busy}
          onCancel={() => setAdding(undefined)}
          onSubmit={async (body) => {
            const result = await run('POST', '/items', { ...body, parentId: adding.parentId }, 'Baris ditambahkan.');
            if (result.ok) setAdding(undefined);
            return result;
          }}
        />
      )}

      {rows.length === 0 ? (
        <p className="empty-state">Belum ada baris. {editable ? 'Mulai dengan menambah bagian (SECTION) atau item pekerjaan.' : ''}</p>
      ) : (
        <div className="panel rab-grid-wrap">
          <table className="rab-grid">
            <thead>
              <tr>
                <th scope="col" className="rab-sticky-no">No</th>
                <th scope="col" className="rab-sticky-desc">Uraian</th>
                {shown.map((c) => (
                  <th key={c.key} scope="col" className={c.key === 'unit' || c.key === 'analysisCode' ? '' : 'num'}>
                    {c.label}
                  </th>
                ))}
                {editable && <th scope="col">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                editingId === row.id && editable ? (
                  <tr key={row.id}>
                    <td colSpan={shown.length + 3}>
                      <RowForm
                        title={`Ubah ${RAB_ROW_TYPE_LABEL[row.rowType].toLowerCase()}`}
                        row={row}
                        parents={rows.filter((r) => r.rowType !== 'ITEM' && r.id !== row.id && !isDescendant(rows, r.id, row.id))}
                        busy={busy}
                        onCancel={() => setEditingId(undefined)}
                        onSubmit={async (body) => {
                          const result = await run('PATCH', `/items/${row.id}`, body, 'Baris disimpan.');
                          if (result.ok) setEditingId(undefined);
                          return result;
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className={row.rowType === 'ITEM' ? '' : `rab-group rab-${row.rowType.toLowerCase()}`}>
                    <td className="rab-sticky-no">{row.displayNumber}</td>
                    <td className="rab-sticky-desc" style={{ paddingLeft: `${12 + row.depth * 18}px` }}>
                      {row.description}
                      {row.workItemCode && <span className="rab-code">{row.workItemCode}</span>}
                    </td>
                    {shown.map((c) => (
                      <td key={c.key} className={c.key === 'unit' || c.key === 'analysisCode' ? '' : 'num'}>
                        {cell(row, c.key)}
                      </td>
                    ))}
                    {editable && (
                      <td>
                        <div className="row-actions">
                          <Button variant="secondary" onClick={() => (setAdding(undefined), setEditingId(row.id))}>
                            Ubah
                          </Button>
                          {row.rowType !== 'ITEM' && (
                            <Button variant="secondary" onClick={() => (setEditingId(undefined), setAdding({ parentId: row.id }))}>
                              + Sub
                            </Button>
                          )}
                          <Button variant="secondary" aria-label={`Naikkan ${row.description}`} onClick={() => run('POST', `/items/${row.id}/move`, { direction: 'up' }, 'Urutan diubah.')}>
                            ↑
                          </Button>
                          <Button variant="secondary" aria-label={`Turunkan ${row.description}`} onClick={() => run('POST', `/items/${row.id}/move`, { direction: 'down' }, 'Urutan diubah.')}>
                            ↓
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => window.confirm(`Hapus baris "${row.description}"?`) && run('DELETE', `/items/${row.id}`, undefined, 'Baris dihapus.')}
                          >
                            Hapus
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
            <tfoot>
              <tr className="rab-total">
                <td className="rab-sticky-no" />
                <th scope="row" className="rab-sticky-desc">
                  Total
                </th>
                {shown.map((c) => (
                  <td key={c.key} className="num">
                    {c.key === 'subtotal' ? formatNumber(totals.realCost) : c.key === 'weight' && totals.realCost !== '0.00' ? '100,0000' : ''}
                  </td>
                ))}
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {draft && (canApprove || canEdit) && (
        <ApprovalPanel
          issues={issues}
          canApprove={canApprove}
          canDiscard={canEdit}
          busy={busy}
          onApprove={(acknowledgeWarnings) => run('POST', '/approve', { acknowledgeWarnings }, `RAB ${version.label} di-approve dan terkunci.`)}
          onDiscard={(reason) => run('POST', '/discard', { reason }, `Draft ${version.label} dibatalkan.`)}
        />
      )}
    </div>
  );
}

function isDescendant(rows: RabRowDto[], candidateId: string, ancestorId: string): boolean {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const seen = new Set<string>();
  for (let id = parentOf.get(candidateId) ?? null; id !== null && !seen.has(id); id = parentOf.get(id) ?? null) {
    if (id === ancestorId) return true;
    seen.add(id);
  }
  return false;
}

function IssuesPanel({ errors, warnings }: { errors: RabIssue[]; warnings: RabIssue[] }) {
  if (errors.length === 0 && warnings.length === 0) return <Alert kind="success">Tidak ada error atau peringatan. Draft siap di-approve.</Alert>;
  return (
    <section className="panel form-panel space-y-2" aria-labelledby="rab-issues">
      <h2 id="rab-issues" className="text-base font-semibold">
        Pemeriksaan draft
      </h2>
      {errors.length > 0 && (
        <Alert>
          {errors.length} error harus diperbaiki sebelum approve:
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert kind="info">
          {warnings.length} peringatan harus dikonfirmasi saat approve:
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}
    </section>
  );
}

function DocumentForm({ version, busy, onSave }: { version: RabVersionDetailDto['version']; busy: boolean; onSave: (body: Record<string, string>) => Promise<Result> }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({ documentNumber: String(form.get('documentNumber') ?? ''), documentDate: String(form.get('documentDate') ?? '') });
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="Data dokumen RAB">
      <Field id="rab-doc-number" name="documentNumber" label="Nomor dokumen" defaultValue={version.documentNumber ?? ''} />
      <Field id="rab-doc-date" name="documentDate" type="date" label="Tanggal dokumen" defaultValue={version.documentDate ?? ''} />
      <Button type="submit" variant="secondary" disabled={busy}>
        Simpan dokumen
      </Button>
    </form>
  );
}

function RowForm({
  title,
  row,
  allowedTypes,
  parents,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  row?: RabRowDto;
  allowedTypes?: readonly RabRowType[];
  parents?: RabRowDto[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, string | null>) => Promise<Result>;
}) {
  const [rowType, setRowType] = useState<RabRowType>(row?.rowType ?? allowedTypes?.at(-1) ?? 'ITEM');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | null> = {
      displayNumber: String(form.get('displayNumber') ?? ''),
      description: String(form.get('description') ?? ''),
    };
    if (!row) body.rowType = rowType;
    if (rowType === 'ITEM') for (const f of ITEM_FIELDS) body[f.name] = String(form.get(f.name) ?? '');
    if (row && parents && row.rowType !== 'SECTION') body.parentId = String(form.get('parentId') ?? '') || null;
    setErrors((await onSubmit(body)).fieldErrors);
  }

  return (
    <form onSubmit={submit} noValidate className="panel form-panel space-y-3" aria-label={title}>
      <h3 className="font-semibold">{title}</h3>
      <div className="form-grid">
        {!row && allowedTypes && (
          <div>
            <label htmlFor="rab-row-type" className="field-label">
              Jenis baris
            </label>
            <Select id="rab-row-type" value={rowType} onChange={(e) => setRowType(e.target.value as RabRowType)}>
              {allowedTypes.map((t) => (
                <option key={t} value={t}>
                  {RAB_ROW_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
        )}
        {row && parents && row.rowType !== 'SECTION' && (
          <div>
            <label htmlFor="rab-parent" className="field-label">
              Induk
            </label>
            <Select id="rab-parent" name="parentId" defaultValue={row.parentId ?? ''}>
              <option value="">(tingkat teratas)</option>
              {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {'— '.repeat(p.depth)}
                    {p.displayNumber ? `${p.displayNumber}. ` : ''}
                    {p.description}
                  </option>
                ))}
            </Select>
          </div>
        )}
        <Field id="rab-display-number" name="displayNumber" label="No" defaultValue={row?.displayNumber ?? ''} error={errors.displayNumber} />
        <Field id="rab-description" name="description" label="Uraian" required defaultValue={row?.description ?? ''} error={errors.description} />
        {rowType === 'ITEM' &&
          ITEM_FIELDS.map((f) => (
            <div key={f.name}>
              <Field
                id={`rab-${f.name}`}
                name={f.name}
                label={f.label}
                inputMode={'inputMode' in f ? f.inputMode : undefined}
                defaultValue={row?.[f.name] ?? ''}
                error={errors[f.name]}
              />
              {'hint' in f && <p className="field-hint">{f.hint}</p>}
            </div>
          ))}
      </div>
      <div className="row-actions">
        <Button type="submit" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  );
}

function ApprovalPanel({
  issues,
  canApprove,
  canDiscard,
  busy,
  onApprove,
  onDiscard,
}: {
  issues: RabVersionDetailDto['issues'];
  canApprove: boolean;
  canDiscard: boolean;
  busy: boolean;
  onApprove: (acknowledgeWarnings: boolean) => Promise<Result>;
  onDiscard: (reason: string) => Promise<Result>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = issues.errors.length > 0 || (issues.warnings.length > 0 && !acknowledged);

  function discard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    if (window.confirm('Batalkan draft ini? Draft tetap tersimpan sebagai riwayat dan tidak dapat diubah lagi.')) void onDiscard(reason);
  }

  return (
    <section className="panel form-panel space-y-4" aria-labelledby="rab-approval">
      <h2 id="rab-approval" className="text-base font-semibold">
        Approval
      </h2>
      {canApprove && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Setelah di-approve, versi ini terkunci permanen. Nilai per baris dan total disimpan sebagai snapshot.</p>
          {issues.warnings.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> Saya sudah memeriksa {issues.warnings.length} peringatan di atas.
            </label>
          )}
          <Button disabled={busy || blocked} onClick={() => window.confirm('Approve RAB ini? Versi akan terkunci permanen.') && onApprove(acknowledged)}>
            Approve RAB
          </Button>
        </div>
      )}
      {canDiscard && (
        <form onSubmit={discard} noValidate className="flex flex-wrap items-end gap-2">
          <Field id="rab-discard-reason" name="reason" label="Alasan membatalkan draft (wajib)" required />
          <Button type="submit" variant="danger" disabled={busy}>
            Batalkan draft
          </Button>
        </form>
      )}
    </section>
  );
}
