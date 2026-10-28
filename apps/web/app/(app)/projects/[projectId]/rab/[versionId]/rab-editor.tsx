'use client';

import {
  correctionsOf,
  RAB_ROW_TYPES,
  reconciliationSchema,
  type RabIssue,
  type RabRowDto,
  type RabRowType,
  type RabVersionDetailDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { SourceValue, type ValueSource } from '@/components/source-value';
import { workbookSource, rabRowHref } from '@/lib/value-source';
import { Fragment, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Select } from '@/components/ui';
import { ActionMenu } from '@/components/action-menu';
import { Icon } from '@/components/icon';
import { InfoHint } from '@/components/info-hint';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatNumber, formatRounded } from '@/lib/project-fields';
import { canChangeVersion, RAB_COLUMNS, RAB_ROW_TYPE_LABEL, type RabColumn } from '@/lib/rab-ui';
import {
  CorrectionBadge,
  correctionNote,
  CorrectionReasonField,
  InlineReasonForm,
  WorkItemForm,
} from '@/components/corrections';

const COLUMNS_KEY = 'rab-columns';
const collapsedKey = (versionId: string) => `rab-collapsed:${versionId}`;
const ITEM_FIELDS = [
  { name: 'volume', label: 'Volume', hint: 'maks. 12 desimal', inputMode: 'decimal' },
  { name: 'unit', label: 'Satuan' },
  { name: 'analysisCode', label: 'No analisa' },
  {
    name: 'unitPrice',
    label: 'Harga satuan (Rp)',
    hint: 'tanpa pemisah ribuan',
    inputMode: 'decimal',
  },
  { name: 'taxPercent', label: 'PPN (%)', inputMode: 'decimal' },
] as const;

type Notice = { kind: 'success' | 'error'; text: string; issues?: RabIssue[] };
type Result = { ok: boolean; fieldErrors: Record<string, string> };
type DropMark = { rowId: string; edge: 'before' | 'after' };

function loadColumns(): RabColumn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null') as RabColumn[] | null;
    if (Array.isArray(saved)) return saved.filter((c) => RAB_COLUMNS.some((col) => col.key === c));
  } catch {
    // Storage unavailable or corrupt: fall back to all columns.
  }
  return RAB_COLUMNS.map((c) => c.key);
}

/** Saved collapsed groups for a version; per-browser convenience only. */
function loadCollapsed(versionId: string): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(collapsedKey(versionId)) ?? '[]') as unknown;
    if (Array.isArray(saved))
      return new Set(saved.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Storage unavailable or corrupt: everything expanded.
  }
  return new Set();
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

/** `permissions` are the user's project permissions, empty when the project is closed (UI hints only). */
export function RabEditor({
  projectId,
  initial,
  permissions,
}: {
  projectId: string;
  initial: RabVersionDetailDto;
  permissions: string[];
}) {
  const [detail, setDetail] = useState(initial);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [adding, setAdding] = useState<{ parentId: string | null }>();
  const [workItemFor, setWorkItemFor] = useState<string>();
  const [draggingId, setDraggingId] = useState<string>();
  const [dropMark, setDropMark] = useState<DropMark>();
  const [search, setSearch] = useState('');
  const [columns, setColumns] = useState<RabColumn[]>(RAB_COLUMNS.map((c) => c.key));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { version, rows, totals, issues } = detail;
  const reopened = version.status === 'REOPENED';
  // An open version: a draft, or an approved one reopened for correction (D-068).
  const draft = version.status === 'DRAFT' || reopened;
  const canEdit = canChangeVersion(version.status, permissions, 'rab.edit');
  const canApprove = draft && permissions.includes('rab.approve');
  const canReopen = version.status === 'APPROVED' && permissions.includes('rab.reopen');
  // D-070: whoever may open a correction may also abandon it.
  const canCancelCorrection = reopened && permissions.includes('rab.reopen');
  const editable = canEdit && !busy;
  const [reopening, setReopening] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const base = `/projects/${projectId}/rab-versions/${version.id}`;
  const shown = RAB_COLUMNS.filter((c) => columns.includes(c.key));

  // Read saved choices after mount (localStorage is browser-only).
  useEffect(() => {
    const saved = loadColumns();
    const savedCollapsed = loadCollapsed(version.id);
    const selected = decodeURIComponent(window.location.hash.slice(1)).replace(/^rab-row-/, '');
    for (
      let row = initial.rows.find((r) => r.id === selected);
      row?.parentId;
      row = initial.rows.find((r) => r.id === row!.parentId)
    )
      savedCollapsed.delete(row.parentId);

    const id = requestAnimationFrame(() => (setColumns(saved), setCollapsed(savedCollapsed)));
    return () => cancelAnimationFrame(id);
  }, [version.id, initial.rows]);

  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const groupIds = rows.filter((r) => r.rowType !== 'ITEM').map((r) => r.id);
  const hasChildren = new Set(rows.map((r) => r.parentId));
  /** Hidden when any ancestor is collapsed; group rows keep showing their totals. */
  const hidden = (row: RabRowDto) => {
    for (let p = row.parentId; p; p = parentOf.get(p) ?? null) if (collapsed.has(p)) return true;
    return false;
  };

  useEffect(() => {
    function focusRow() {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash.startsWith('rab-row-')) return;
      const id = hash.slice(8);
      setSearch('');
      setCollapsed((current) => {
        const next = new Set(current);
        for (
          let row = rows.find((r) => r.id === id);
          row?.parentId;
          row = rows.find((r) => r.id === row!.parentId)
        )
          next.delete(row.parentId);
        return next;
      });
      setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'center' }), 50);
    }
    focusRow();
    window.addEventListener('hashchange', focusRow);
    return () => window.removeEventListener('hashchange', focusRow);
  }, [rows]);

  const matches = new Set<string>();
  if (search.trim())
    for (const row of rows) {
      if (
        `${row.description} ${row.displayNumber ?? ''} ${row.analysisCode ?? ''}`
          .toLocaleLowerCase('id')
          .includes(search.trim().toLocaleLowerCase('id'))
      ) {
        matches.add(row.id);
        for (let p = row.parentId; p; p = parentOf.get(p) ?? null) matches.add(p);
      }
    }
  const rowSource = (row: RabRowDto, key: RabColumn) => {
    const href = (r: RabRowDto) => rabRowHref(projectId, version.id, r.id);
    const inputSources: ValueSource[] = workbookSource(projectId, row.sourceLocator);
    const sameRow = (label: string, value: string | null): ValueSource => ({
      label,
      value,
      href: href(row),
    });
    const analysisSource: ValueSource[] = row.analysis
      ? [
          {
            label: `Analisa ${row.analysis.code ?? row.analysis.name}`,
            value: row.analysisUnitPrice ?? row.unitPrice,
            href: `/projects/${projectId}/rab/${row.analysis.rabVersionId}/analyses/${row.analysis.analysisId}#analysis-version-${row.analysis.versionId}`,
          },
        ]
      : [];
    let formula: string | undefined;
    let sources = inputSources;
    let note = row.rowType === 'ITEM' ? 'Nilai input pada item RAB ini.' : undefined;
    if (row.rowType !== 'ITEM') {
      const children = rows.filter((r) => r.parentId === row.id);
      sources = children.map((r) => ({ label: r.description, value: r.subtotal, href: href(r) }));
      formula =
        key === 'weight'
          ? 'Jumlah kelompok ÷ total RAB eksak × 100'
          : 'Jumlah nilai anak langsung; rincian setiap kelompok dapat dibuka.';
      if (key === 'weight')
        sources.push({ label: 'Total RAB eksak', value: totals.value, href: '#rab-total' });
    } else if (key === 'unitPrice') {
      sources =
        row.priceSource === 'ANALYSIS' ? analysisSource : [...inputSources, ...analysisSource];
      note =
        row.priceSource === 'ANALYSIS'
          ? 'Harga mengikuti versi analisa yang dirujuk item ini.'
          : row.priceSource === 'SOURCE_OVERRIDE'
            ? `Harga sumber dipertahankan melalui keputusan reviewer. ${row.priceNote ?? ''}`
            : row.priceSource === 'DIRECT'
              ? `Harga langsung dari sumber. ${row.priceNote ?? ''}`
              : 'Harga dimasukkan manual pada item RAB; tidak memiliki rumus analisa.';
      if (row.priceSource === 'SOURCE_OVERRIDE' && row.priceDecidedAt)
        sources.push({ label: 'Waktu keputusan reviewer', value: row.priceDecidedAt });
      if (row.sourceUnitPrice != null)
        sources.push({ label: 'Harga pada dokumen sumber', value: row.sourceUnitPrice });
    } else if (key === 'subtotal') {
      formula = 'Volume × harga satuan × (1 + PPN ÷ 100), tanpa pembulatan per item';
      sources = [
        sameRow('Volume', row.volume),
        ...analysisSource,
        sameRow('Harga satuan efektif', row.unitPrice),
        sameRow('PPN (%)', row.taxPercent),
      ];
      note = 'Nilai tampilan dibulatkan; nilai perhitungan menggunakan presisi lengkap.';
    } else if (key === 'unitPriceWithTax') {
      formula = 'Harga satuan × (1 + PPN ÷ 100)';
      sources = [
        ...analysisSource,
        sameRow('Harga satuan efektif', row.unitPrice),
        sameRow('PPN (%)', row.taxPercent),
      ];
      note = undefined;
    } else if (key === 'weight') {
      formula = 'Jumlah item ÷ total RAB eksak × 100';
      sources = [
        sameRow('Jumlah item', row.subtotal),
        { label: 'Total RAB eksak', value: totals.value, href: '#rab-total' },
      ];
      note = 'Pembagi memakai total eksak sebelum pembulatan real cost.';
    }
    // Cached Excel value checked at import (D-054/D-063); the app value is never replaced by it.
    const what = key === 'subtotal' ? 'jumlah' : key === 'unitPriceWithTax' ? 'harga + PPN' : null;
    if (row.rowType === 'ITEM' && what && inputSources.length) {
      const stored = (row.sourceLocator as { reconciliation?: unknown } | null)?.reconciliation;
      const recon = reconciliationSchema
        .array()
        .safeParse(stored)
        .data?.find((e) => e.what === what);
      if (recon)
        sources.push({
          label: `Nilai tersimpan di Excel saat impor: ${recon.matches ? 'cocok' : 'berbeda'} (selisih ${recon.diff} ${recon.matches ? '≤' : '>'} toleransi ${recon.tolerance})`,
          value: recon.cached,
          href: inputSources[0]?.href,
        });
      else
        note = `${note ?? ''} Rekonsiliasi dengan nilai Excel belum tersedia untuk item ini (impor lama).`;
    }
    if (!sources.length && !formula)
      note = `${note ?? ''} Alamat Excel tidak tercatat untuk nilai ini.`;
    const last = correctionsOf(row.sourceLocator).at(-1);
    if (row.rowType === 'ITEM' && last) note = `${note ?? ''} ${correctionNote(last)}`;
    return {
      title: `${RAB_COLUMNS.find((c) => c.key === key)?.label} · ${row.description}`,
      value: row[key],
      formula,
      sources,
      note,
    };
  };
  const totalSources: ValueSource[] = rows
    .filter((r) => r.parentId === null)
    .map((r) => ({
      label: r.description,
      value: r.subtotal,
      href: rabRowHref(projectId, version.id, r.id),
    }));

  function saveCollapsed(next: Set<string>) {
    setCollapsed(next);
    try {
      localStorage.setItem(collapsedKey(version.id), JSON.stringify([...next]));
    } catch {
      // Per-browser convenience only.
    }
  }
  const toggleGroup = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveCollapsed(next);
  };
  /** Opens the ancestors of a row so the row being edited or added stays visible. */
  const reveal = (id: string | null) => {
    const next = new Set(collapsed);
    for (let p: string | null = id; p; p = parentOf.get(p) ?? null) next.delete(p);
    if (next.size !== collapsed.size) saveCollapsed(next);
  };

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
  async function run(
    method: string,
    path: string,
    body: unknown,
    success: string,
  ): Promise<Result> {
    // Every change to a reopened version carries the reason typed where the change is made.
    const plain =
      path === '/approve' ||
      path === '/reopen' ||
      path === '/cancel-correction' ||
      path === '/items/reorder';
    if (reopened && !plain && !(body as { reason?: string } | undefined)?.reason?.trim())
      return { ok: false, fieldErrors: { reason: 'Isi alasan koreksi.' } };
    setBusy(true);
    setNotice(undefined);
    try {
      setDetail(await api<RabVersionDetailDto>(method, `${base}${path}`, body));
      setNotice({ kind: 'success', text: success });
      return { ok: true, fieldErrors: {} };
    } catch (err) {
      const details =
        err instanceof ApiError
          ? (err.details as { errors?: RabIssue[]; warnings?: RabIssue[] } | undefined)
          : undefined;
      const issues = [...(details?.errors ?? []), ...(details?.warnings ?? [])].filter(
        (i) => !('path' in i),
      );
      setNotice({ kind: 'error', text: errorMessage(err), issues });
      return { ok: false, fieldErrors: err instanceof ApiError ? err.fieldErrors : {} };
    } finally {
      setBusy(false);
    }
  }

  function dragOverRow(event: DragEvent<HTMLTableRowElement>, row: RabRowDto) {
    const source = rows.find((candidate) => candidate.id === draggingId);
    if (!source || source.id === row.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (source.parentId !== row.parentId) {
      setDropMark(undefined);
      return;
    }
    const edge =
      event.clientY <
      event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2
        ? 'before'
        : 'after';
    setDropMark((current) =>
      current?.rowId === row.id && current.edge === edge ? current : { rowId: row.id, edge },
    );
  }

  async function dropRow(event: DragEvent<HTMLTableRowElement>, target: RabRowDto) {
    event.preventDefault();
    const source = rows.find((candidate) => candidate.id === draggingId);
    setDraggingId(undefined);
    setDropMark(undefined);
    if (!source || source.id === target.id) return;
    if (source.parentId !== target.parentId) {
      setNotice({
        kind: 'error',
        text: 'Baris hanya dapat diurutkan di dalam kelompok yang sama. Gunakan Ubah untuk mengganti induk.',
      });
      return;
    }
    const siblings = rows.filter((candidate) => candidate.parentId === source.parentId);
    const ordered = siblings.filter((candidate) => candidate.id !== source.id);
    const targetIndex = ordered.findIndex((candidate) => candidate.id === target.id);
    if (targetIndex < 0) return;
    const edge =
      dropMark?.rowId === target.id
        ? dropMark.edge
        : event.clientY <
            event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2
          ? 'before'
          : 'after';
    ordered.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source);
    if (ordered.every((candidate, index) => candidate.id === siblings[index]?.id)) return;
    // Order changes no value: saved at once, also while reopened (no reason, D-068).
    await run(
      'POST',
      '/items/reorder',
      { parentId: source.parentId, itemIds: ordered.map((candidate) => candidate.id) },
      'Urutan pekerjaan berhasil diubah.',
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel rab-summary" aria-label={`Ringkasan dokumen RAB ${version.label}`}>
        <div className="rab-summary-top">
          {draft && canEdit ? (
            <DocumentForm
              key={version.id}
              version={version}
              reopened={reopened}
              busy={busy}
              onSave={(body) => run('PATCH', '', body, 'Data dokumen disimpan.')}
            />
          ) : (
            <dl className="rab-doc-meta">
              <div>
                <dt>Nomor dokumen</dt>
                <dd>{version.documentNumber ?? '–'}</dd>
              </div>
              <div>
                <dt>Tanggal dokumen</dt>
                <dd>{version.documentDate ? formatDate(version.documentDate) : '–'}</dd>
              </div>
              {version.approvedBy && (
                <div>
                  <dt>Approved oleh</dt>
                  <dd>{version.approvedBy.name}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="rab-summary-actions">
            <Link
              className="btn btn-secondary btn-compact"
              href={`/projects/${projectId}/rab/${version.id}/history`}
            >
              Riwayat &amp; snapshot
            </Link>
            {canReopen && (
              <Button
                variant="secondary"
                className="btn-compact"
                disabled={busy}
                aria-expanded={reopening}
                onClick={() => setReopening((open) => !open)}
              >
                <Icon name="edit" size={14} />
                Buka untuk koreksi
              </Button>
            )}
            {canCancelCorrection && (
              <Button
                variant="secondary"
                className="btn-compact"
                disabled={busy}
                aria-expanded={cancelling}
                onClick={() => setCancelling((open) => !open)}
              >
                Batalkan koreksi
              </Button>
            )}
          </div>
        </div>
        {canReopen && reopening && (
          <InlineReasonForm
            id="rab-reopen-reason"
            title={`Buka kembali RAB ${version.label} untuk koreksi`}
            description="Kondisi approved sekarang disimpan sebagai snapshot dan versi harus di-approve ulang. Dokumen Excel asli dan versi lain tidak berubah; selama koreksi, versi baru dan impor resmi ditahan."
            confirmLabel="Buka kembali"
            busy={busy}
            onCancel={() => setReopening(false)}
            onSubmit={async (reason) => {
              const result = await run(
                'POST',
                '/reopen',
                { reason },
                `RAB ${version.label} dibuka untuk koreksi; snapshot approved disimpan.`,
              );
              if (result.ok) setReopening(false);
            }}
          />
        )}
        {canCancelCorrection && cancelling && (
          <InlineReasonForm
            id="rab-cancel-correction-reason"
            destructive
            title={`Batalkan koreksi RAB ${version.label}`}
            description="Semua perubahan sejak versi ini dibuka dikembalikan ke kondisi approved terakhir: nilai baris, harga dasar, analisa, urutan, dan data dokumen. Baris yang ditambahkan selama koreksi dihapus. Riwayat koreksi tetap tersimpan, dan versi kembali Approved tanpa approve ulang."
            confirmLabel="Batalkan koreksi"
            label="Alasan membatalkan (wajib)"
            busy={busy}
            onCancel={() => setCancelling(false)}
            onSubmit={async (reason) => {
              const result = await run(
                'POST',
                '/cancel-correction',
                { reason },
                `Koreksi RAB ${version.label} dibatalkan; kondisi approved terakhir dipulihkan.`,
              );
              if (result.ok) setCancelling(false);
            }}
          />
        )}
        {reopened && (
          <p className="rab-summary-note">
            {canEdit
              ? 'Sedang dikoreksi. Ubah nilai langsung pada baris RAB, detail analisa, atau tab Bahan/Upah/Alat; setiap perubahan meminta alasan dan ditandai sebagai koreksi.'
              : 'Sedang dikoreksi; role Anda hanya dapat melihat versi ini.'}
          </p>
        )}
        <dl className="rab-totals">
          <div>
            <dt>Total sebelum PPN</dt>
            <dd className="tabular-nums">
              <SourceValue
                title="Total sebelum PPN"
                value={totals.beforeTax}
                formula="Σ (volume × harga satuan) seluruh item pekerjaan"
                sources={rows
                  .filter((r) => r.rowType === 'ITEM')
                  .map((r) => ({
                    label: r.description,
                    value: r.subtotalBeforeTax,
                    href: rabRowHref(projectId, version.id, r.id),
                  }))}
              >
                Rp {formatRounded(totals.beforeTax, 2)}
              </SourceValue>
            </dd>
          </div>
          <div>
            <dt>Total (real cost)</dt>
            <dd className="tabular-nums">
              <SourceValue
                title="Total (real cost)"
                value={totals.realCost}
                formula="ROUND(total eksak termasuk PPN, 2), HALF_UP"
                sources={[{ label: 'Total eksak', value: totals.value }, ...totalSources]}
              >
                Rp {formatNumber(totals.realCost)}
              </SourceValue>
            </dd>
          </div>
          <div>
            <dt>Dibulatkan</dt>
            <dd className="tabular-nums">
              <SourceValue
                title="Total dibulatkan"
                value={totals.rounded}
                formula="TRUNC(real cost, 0)"
                sources={[{ label: 'Real cost', value: totals.realCost, href: '#rab-total' }]}
              >
                Rp {formatNumber(totals.rounded)}
              </SourceValue>
            </dd>
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

      {draft && (
        <div className="rab-review-grid">
          <IssuesPanel errors={issues.errors} warnings={issues.warnings} />
          {(canApprove || canEdit) && (
            <ApprovalPanel
              issues={issues}
              reopened={reopened}
              canApprove={canApprove}
              canDiscard={canEdit && !reopened}
              busy={busy}
              onApprove={(acknowledgeWarnings) =>
                run(
                  'POST',
                  '/approve',
                  { acknowledgeWarnings },
                  `RAB ${version.label} di-approve dan terkunci.`,
                )
              }
              onDiscard={(text) =>
                run('POST', '/discard', { reason: text }, `Draft ${version.label} dibatalkan.`)
              }
            />
          )}
        </div>
      )}

      <div className="toolbar rab-toolbar">
        <div className="rab-search">
          <label className="field-label" htmlFor="rab-search">
            Cari pekerjaan
          </label>
          <input
            className="field"
            id="rab-search"
            placeholder="Uraian, nomor, atau kode analisa…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="rab-toolbar-view" role="group" aria-label="Pengaturan tampilan tabel">
          <span className="rab-toolbar-label">Tampilan tabel</span>
          <details className="column-picker">
            <summary className="btn btn-secondary">Kolom</summary>
            <fieldset>
              <legend className="sr-only">Kolom yang ditampilkan</legend>
              {RAB_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={columns.includes(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />{' '}
                  {c.label}
                </label>
              ))}
            </fieldset>
          </details>
          {groupIds.length > 0 && (
            <div className="rab-view-actions" role="group" aria-label="Kelompok pekerjaan">
              <Button variant="secondary" onClick={() => saveCollapsed(new Set(groupIds))}>
                Ciutkan semua
              </Button>
              <Button
                variant="secondary"
                disabled={collapsed.size === 0}
                onClick={() => saveCollapsed(new Set())}
              >
                Buka semua
              </Button>
            </div>
          )}
        </div>
        {editable && (
          <Button
            variant="primary"
            className="rab-add-button"
            onClick={() => (setEditingId(undefined), setAdding({ parentId: null }))}
          >
            + Tambah bagian / pekerjaan
          </Button>
        )}
        <p className="rab-toolbar-hint">
          Klik nilai bergaris putus-putus untuk melihat rumus dan membuka sumbernya.
        </p>
      </div>

      {adding && editable && (
        <RowForm
          title={`Tambah baris${adding.parentId ? ` di bawah "${rows.find((r) => r.id === adding.parentId)?.description}"` : ' di tingkat teratas'}`}
          allowedTypes={
            adding.parentId ? RAB_ROW_TYPES.filter((t) => t !== 'SECTION') : RAB_ROW_TYPES
          }
          reopened={reopened}
          busy={busy}
          onCancel={() => setAdding(undefined)}
          onSubmit={async (body) => {
            const result = await run(
              'POST',
              '/items',
              { ...body, parentId: adding.parentId },
              'Baris ditambahkan.',
            );
            if (result.ok) setAdding(undefined);
            return result;
          }}
        />
      )}

      {rows.length === 0 ? (
        <p className="empty-state">
          Belum ada baris.{' '}
          {editable ? 'Mulai dengan menambah bagian (SECTION) atau item pekerjaan.' : ''}
        </p>
      ) : (
        <div className="panel rab-grid-wrap">
          <table className="rab-grid">
            <thead>
              <tr>
                <th scope="col" className="rab-sticky-no">
                  No
                </th>
                <th scope="col" className="rab-sticky-desc">
                  Uraian
                </th>
                {shown.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.key === 'unit' || c.key === 'analysisCode' ? '' : 'num'}
                  >
                    {c.label}
                  </th>
                ))}
                {editable && (
                  <th scope="col" className="rab-actions-cell">
                    <span className="sr-only">Aksi</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => (search.trim() ? matches.has(row.id) : !hidden(row)))
                .map((row) =>
                  editingId === row.id && editable ? (
                    <tr key={row.id}>
                      <td colSpan={shown.length + 3} className="rab-form-cell">
                        <RowForm
                          title={`Ubah ${RAB_ROW_TYPE_LABEL[row.rowType].toLowerCase()}`}
                          row={row}
                          parents={rows.filter(
                            (r) =>
                              r.rowType !== 'ITEM' &&
                              r.id !== row.id &&
                              !isDescendant(rows, r.id, row.id),
                          )}
                          reopened={reopened}
                          busy={busy}
                          onCancel={() => setEditingId(undefined)}
                          onSubmit={async (body) => {
                            const result = await run(
                              'PATCH',
                              `/items/${row.id}`,
                              body,
                              'Baris disimpan.',
                            );
                            if (result.ok) setEditingId(undefined);
                            return result;
                          }}
                        />
                      </td>
                    </tr>
                  ) : workItemFor === row.id && editable && version.previousVersionId ? (
                    <tr key={row.id}>
                      <td colSpan={shown.length + 3} className="rab-form-cell">
                        <WorkItemForm
                          projectId={projectId}
                          previousVersionId={version.previousVersionId}
                          row={row}
                          usedWorkItemIds={
                            new Set(rows.map((r) => r.workItemId).filter((id) => id !== null))
                          }
                          reopened={reopened}
                          busy={busy}
                          onCancel={() => setWorkItemFor(undefined)}
                          onSubmit={async (workItemId, reason) => {
                            const result = await run(
                              'POST',
                              `/items/${row.id}/work-item`,
                              { workItemId, ...(reopened ? { reason } : {}) },
                              'Identitas pekerjaan dikoreksi; pekerjaan lama tetap tersimpan.',
                            );
                            if (result.ok) setWorkItemFor(undefined);
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <Fragment key={row.id}>
                      <tr
                        id={`rab-row-${row.id}`}
                        className={[
                          row.rowType === 'ITEM'
                            ? ''
                            : `rab-group rab-${row.rowType.toLowerCase()}`,
                          draggingId === row.id ? 'rab-dragging' : '',
                          dropMark?.rowId === row.id ? `rab-drop-${dropMark.edge}` : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onDragOver={(event) => dragOverRow(event, row)}
                        onDrop={(event) => void dropRow(event, row)}
                      >
                        <td className="rab-sticky-no">
                          {editable && (
                            <button
                              type="button"
                              className="rab-drag-handle"
                              draggable={!busy}
                              aria-label={`Seret ${row.description} untuk mengubah urutan`}
                              title="Seret untuk mengubah urutan"
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', row.id);
                                setDraggingId(row.id);
                              }}
                              onDragEnd={() => {
                                setDraggingId(undefined);
                                setDropMark(undefined);
                              }}
                            >
                              <span aria-hidden="true">☰</span>
                            </button>
                          )}
                          {row.displayNumber}
                        </td>
                        <td
                          className="rab-sticky-desc"
                          style={{ paddingLeft: `${12 + row.depth * 18}px` }}
                        >
                          {row.rowType !== 'ITEM' && hasChildren.has(row.id) ? (
                            <button
                              type="button"
                              className="rab-toggle"
                              aria-expanded={!collapsed.has(row.id)}
                              aria-label={`${collapsed.has(row.id) ? 'Buka' : 'Ciutkan'} ${row.description}`}
                              onClick={() => toggleGroup(row.id)}
                            >
                              <span aria-hidden="true">{collapsed.has(row.id) ? '▸' : '▾'}</span>
                            </button>
                          ) : (
                            row.rowType !== 'ITEM' && (
                              <span className="rab-toggle-space" aria-hidden="true" />
                            )
                          )}
                          {row.description}
                          {row.workItemCode && <span className="rab-code">{row.workItemCode}</span>}
                          <CorrectionBadge locator={row.sourceLocator} />
                        </td>
                        {shown.map((c) => (
                          <td
                            key={c.key}
                            className={c.key === 'unit' || c.key === 'analysisCode' ? '' : 'num'}
                          >
                            {c.key === 'analysisCode' && row.analysis ? (
                              <Link
                                className="link-button"
                                href={`/projects/${projectId}/rab/${row.analysis.rabVersionId}/analyses/${row.analysis.analysisId}`}
                                title={row.analysis.name}
                              >
                                {row.analysisCode ?? row.analysis.code}
                              </Link>
                            ) : row[c.key] !== null && row[c.key] !== '' ? (
                              <SourceValue {...rowSource(row, c.key)}>
                                {cell(row, c.key)}
                              </SourceValue>
                            ) : (
                              cell(row, c.key)
                            )}
                            {c.key === 'unitPrice' &&
                              (row.priceSource === 'SOURCE_OVERRIDE' ||
                                row.priceSource === 'DIRECT') && (
                                <InfoHint
                                  label={
                                    row.priceSource === 'SOURCE_OVERRIDE'
                                      ? 'Harga sumber dipertahankan (override)'
                                      : 'Harga langsung dari sumber'
                                  }
                                  text={
                                    row.priceNote ??
                                    (row.priceSource === 'SOURCE_OVERRIDE'
                                      ? 'Harga dokumen sumber dipakai walau berbeda dengan analisa, berdasarkan keputusan reviewer.'
                                      : 'Item ini tidak memakai analisa; harganya diambil langsung dari dokumen sumber.')
                                  }
                                  tone="amber"
                                />
                              )}
                          </td>
                        ))}
                        {editable && (
                          <td className="rab-actions-cell">
                            <div className="rab-row-actions">
                              <ActionMenu
                                label={`Tindakan ${row.description}`}
                                items={[
                                  {
                                    label: 'Ubah',
                                    onSelect: () => (
                                      setAdding(undefined),
                                      setWorkItemFor(undefined),
                                      setEditingId(row.id)
                                    ),
                                  },
                                  ...(row.rowType !== 'ITEM'
                                    ? [
                                        {
                                          label: '+ Sub-bagian',
                                          onSelect: () => (
                                            setEditingId(undefined),
                                            reveal(row.id),
                                            setAdding({ parentId: row.id })
                                          ),
                                        },
                                      ]
                                    : []),
                                  ...(row.rowType === 'ITEM' && version.previousVersionId
                                    ? [
                                        {
                                          label: 'Ganti WI',
                                          onSelect: () => (
                                            setEditingId(undefined),
                                            setWorkItemFor(row.id)
                                          ),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: 'Hapus baris',
                                    destructive: true,
                                    separatorBefore: true,
                                    onSelect: () => {
                                      if (reopened) setDeletingId(row.id);
                                      else if (window.confirm(`Hapus baris "${row.description}"?`))
                                        void run(
                                          'DELETE',
                                          `/items/${row.id}`,
                                          undefined,
                                          'Baris dihapus.',
                                        );
                                    },
                                  },
                                ]}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                      {deletingId === row.id && editable && (
                        <tr>
                          <td colSpan={shown.length + 3} className="rab-form-cell">
                            <InlineReasonForm
                              id="rab-delete-reason"
                              destructive
                              title={`Hapus baris "${row.description}"`}
                              description="Baris dan nilainya dihapus dari versi yang sedang dikoreksi; kondisi sebelumnya tetap ada di snapshot."
                              confirmLabel="Hapus baris"
                              busy={busy}
                              onCancel={() => setDeletingId(undefined)}
                              onSubmit={async (reason) => {
                                const result = await run(
                                  'DELETE',
                                  `/items/${row.id}`,
                                  { reason },
                                  'Baris dihapus.',
                                );
                                if (result.ok) setDeletingId(undefined);
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ),
                )}
            </tbody>
            <tfoot>
              <tr id="rab-total" className="rab-total">
                <td className="rab-sticky-no" />
                <th scope="row" className="rab-sticky-desc">
                  Total
                </th>
                {shown.map((c) => (
                  <td key={c.key} className="num">
                    {c.key === 'subtotal' ? (
                      <SourceValue
                        title="Total RAB"
                        value={totals.realCost}
                        formula="ROUND(Σ jumlah item termasuk PPN, 2), HALF_UP"
                        sources={totalSources}
                      >
                        {formatNumber(totals.realCost)}
                      </SourceValue>
                    ) : c.key === 'weight' && totals.realCost !== '0.00' ? (
                      <SourceValue
                        title="Total bobot"
                        value="100"
                        formula="Σ bobot seluruh item = 100% pada total RAB bukan nol"
                        sources={totalSources}
                      >
                        100,0000
                      </SourceValue>
                    ) : (
                      ''
                    )}
                  </td>
                ))}
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function isDescendant(rows: RabRowDto[], candidateId: string, ancestorId: string): boolean {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const seen = new Set<string>();
  for (
    let id = parentOf.get(candidateId) ?? null;
    id !== null && !seen.has(id);
    id = parentOf.get(id) ?? null
  ) {
    if (id === ancestorId) return true;
    seen.add(id);
  }
  return false;
}

function IssuesPanel({ errors, warnings }: { errors: RabIssue[]; warnings: RabIssue[] }) {
  return (
    <section className="panel form-panel rab-issues" aria-labelledby="rab-issues">
      <h2 id="rab-issues" className="section-heading">
        Pemeriksaan
      </h2>
      {errors.length === 0 && warnings.length === 0 && (
        <Alert kind="success">Tidak ada error atau peringatan. Draft siap di-approve.</Alert>
      )}
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
        <details className="issue-details" open={warnings.length <= 3}>
          <summary>
            <Badge tone="amber">{warnings.length} peringatan</Badge> perlu dikonfirmasi saat approve
          </summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DocumentForm({
  version,
  reopened,
  busy,
  onSave,
}: {
  version: RabVersionDetailDto['version'];
  reopened: boolean;
  busy: boolean;
  onSave: (body: Record<string, string>) => Promise<Result>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await onSave({
      documentNumber: String(form.get('documentNumber') ?? ''),
      documentDate: String(form.get('documentDate') ?? ''),
      ...(reopened ? { reason: String(form.get('reason') ?? '') } : {}),
    });
    setErrors(result.fieldErrors);
  }
  return (
    <form onSubmit={submit} className="rab-doc-form" aria-label="Data dokumen RAB">
      <Field
        id="rab-doc-number"
        name="documentNumber"
        label="Nomor dokumen"
        defaultValue={version.documentNumber ?? ''}
      />
      <Field
        id="rab-doc-date"
        name="documentDate"
        type="date"
        label="Tanggal dokumen"
        defaultValue={version.documentDate ?? ''}
      />
      {reopened && <CorrectionReasonField id="rab-doc-reason" error={errors.reason} />}
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
  reopened,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  row?: RabRowDto;
  allowedTypes?: readonly RabRowType[];
  parents?: RabRowDto[];
  reopened: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, string | null>) => Promise<Result>;
}) {
  const [rowType, setRowType] = useState<RabRowType>(
    row?.rowType ?? allowedTypes?.at(-1) ?? 'ITEM',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const linked = Boolean(row?.analysis);
  const formRef = useRef<HTMLFormElement>(null);
  // The form opens inside the scrolling grid; bring all of it (including Simpan) into view.
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | null> = {
      displayNumber: String(form.get('displayNumber') ?? ''),
      description: String(form.get('description') ?? ''),
    };
    if (!row) body.rowType = rowType;
    // A linked item's price follows its analysis (D-051): never send it, so volume/description edits succeed.
    if (rowType === 'ITEM')
      for (const f of ITEM_FIELDS)
        if (!(linked && f.name === 'unitPrice')) body[f.name] = String(form.get(f.name) ?? '');
    if (row && parents && row.rowType !== 'SECTION')
      body.parentId = String(form.get('parentId') ?? '') || null;
    if (reopened) body.reason = String(form.get('reason') ?? '');
    setErrors((await onSubmit(body)).fieldErrors);
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="panel form-panel space-y-3"
      aria-label={title}
    >
      <h3 className="font-semibold">{title}</h3>
      <div className="form-grid">
        {!row && allowedTypes && (
          <div>
            <label htmlFor="rab-row-type" className="field-label">
              Jenis baris
            </label>
            <Select
              id="rab-row-type"
              value={rowType}
              onChange={(e) => setRowType(e.target.value as RabRowType)}
            >
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
        <Field
          id="rab-display-number"
          name="displayNumber"
          label="No"
          defaultValue={row?.displayNumber ?? ''}
          error={errors.displayNumber}
        />
        <Field
          id="rab-description"
          name="description"
          label="Uraian"
          required
          defaultValue={row?.description ?? ''}
          error={errors.description}
        />
        {rowType === 'ITEM' &&
          ITEM_FIELDS.map((f) =>
            linked && f.name === 'unitPrice' ? (
              <div key={f.name}>
                <span className="field-label">{f.label}</span>
                <p className="field tabular-nums" aria-readonly="true">
                  {row?.unitPrice}
                </p>
                <p className="field-hint">
                  Mengikuti analisa {row?.analysis?.code ?? row?.analysis?.name}; koreksi harga
                  dasar, koefisien, atau overhead pada analisa tersebut.
                </p>
              </div>
            ) : (
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
            ),
          )}
      </div>
      {reopened && <CorrectionReasonField id="rab-row-reason" error={errors.reason} />}
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
  reopened,
  canApprove,
  canDiscard,
  busy,
  onApprove,
  onDiscard,
}: {
  issues: RabVersionDetailDto['issues'];
  reopened: boolean;
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
    if (
      window.confirm(
        'Batalkan draft ini? Draft tetap tersimpan sebagai riwayat dan tidak dapat diubah lagi.',
      )
    )
      void onDiscard(reason);
  }

  return (
    <section className="panel form-panel space-y-4" aria-labelledby="rab-approval">
      <h2 id="rab-approval" className="section-heading">
        Approval
      </h2>
      {canApprove && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            {reopened
              ? 'Approval ulang menjalankan seluruh pemeriksaan lagi, mengunci versi yang sama, dan menyimpan snapshot baru. Snapshot sebelumnya tetap tersimpan.'
              : 'Setelah di-approve, versi ini terkunci. Nilai per baris, total, dan paket analisa disimpan sebagai snapshot.'}
          </p>
          {issues.warnings.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />{' '}
              Saya sudah memeriksa {issues.warnings.length} peringatan.
            </label>
          )}
          <Button
            disabled={busy || blocked}
            onClick={() =>
              window.confirm(
                reopened
                  ? 'Approve ulang RAB hasil koreksi ini?'
                  : 'Approve RAB ini? Versi akan terkunci.',
              ) && onApprove(acknowledged)
            }
          >
            {reopened ? 'Approve ulang' : 'Approve RAB'}
          </Button>
        </div>
      )}
      {canDiscard && (
        <form onSubmit={discard} noValidate className="flex flex-wrap items-end gap-2">
          <Field
            id="rab-discard-reason"
            name="reason"
            label="Alasan membatalkan draft (wajib)"
            required
          />
          <Button type="submit" variant="danger" disabled={busy}>
            Batalkan draft
          </Button>
        </form>
      )}
    </section>
  );
}
