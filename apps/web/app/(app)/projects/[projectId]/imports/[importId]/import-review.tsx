'use client';

import { SourceValue } from '@/components/source-value';
import { workbookSource } from '@/lib/value-source';

import {
  rabVersionLabel,
  type DraftAnalysis,
  type DraftRow,
  type ImportIssue,
  type PackageReviewDto,
  type RabImportDetailDto,
  type RabImportSummaryDto,
  type WorkItemSearchDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { InlineReasonForm } from '@/components/corrections';
import { Alert, Badge, Button, EmptyState, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORY_LABEL, IMPORT_STATUS } from '@/lib/import-ui';
import { formatNumber, formatRounded } from '@/lib/project-fields';

type Decision = { rowKey: string; kind: string; value: unknown; reason?: string };
type Filter = 'all' | 'open' | 'warning';

const SEVERITY_TONE = { BLOCKING: 'red', WARNING: 'blue', INFO: 'slate' } as const;

export function ImportReview({
  projectId,
  initial,
  canReview,
  canApprove,
}: {
  projectId: string;
  initial: RabImportDetailDto;
  canReview: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
    issues?: ImportIssue[];
  }>();
  const [filter, setFilter] = useState<Filter>('open');
  const { import: run, draft, issues, decisions, aiRuns, reconciliation } = detail;
  const base = `/projects/${projectId}/rab-imports/${run.id}`;
  const reviewable = run.status === 'NEEDS_REVIEW';

  // Processing happens in the background; poll until the run settles.
  useEffect(() => {
    if (run.status !== 'UPLOADED' && run.status !== 'PROCESSING') return;
    const id = setInterval(() => {
      api<RabImportDetailDto>('GET', base).then(setDetail, () => undefined);
    }, 2000);
    return () => clearInterval(id);
  }, [run.status, base]);

  const issuesByRow = useMemo(() => {
    const m = new Map<string, ImportIssue[]>();
    for (const i of issues) if (i.rowKey) m.set(i.rowKey, [...(m.get(i.rowKey) ?? []), i]);
    return m;
  }, [issues]);
  const latest = useMemo(() => {
    const m = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) m.set(`${d.rowKey}|${d.kind}`, d);
    return m;
  }, [decisions]);
  const blocking = issues.filter((i) => i.severity === 'BLOCKING');
  const general = issues.filter((i) => !i.rowKey);
  const items = draft?.rows.filter((r) => r.rowType === 'ITEM') ?? [];
  const shown = items.filter(
    (r) =>
      filter === 'all' ||
      (issuesByRow.get(r.key) ?? []).some((i) =>
        filter === 'open' ? i.severity === 'BLOCKING' : i.severity !== 'BLOCKING',
      ),
  );
  const analyses = new Map((draft?.analyses ?? []).map((a) => [a.key, a]));

  async function run_(method: string, path: string, body: unknown, success: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const out = await api<RabImportDetailDto | RabImportSummaryDto>(
        method,
        `${base}${path}`,
        body,
      );
      if ('import' in out) setDetail(out);
      setNotice({ kind: 'success', text: success });
      return out;
    } catch (err) {
      const details = (err as { details?: { issues?: ImportIssue[] } }).details;
      setNotice({ kind: 'error', text: errorMessage(err), issues: details?.issues });
      return null;
    } finally {
      setBusy(false);
    }
  }

  const decide = (list: Decision[], success: string) =>
    run_('POST', '/decisions', { decisions: list }, success);

  // D-065: the backend proposes and re-validates; nothing is recorded until this explicit confirmation.
  function confirmPackage() {
    const proposals = detail.packageReview?.proposals ?? [];
    if (
      proposals.length &&
      window.confirm(
        `Konfirmasi ${proposals.length} usulan paket? Keputusan dicatat atas nama Anda; baris lain tetap diputuskan per item.`,
      )
    ) {
      void run_(
        'POST',
        '/confirm-proposals',
        // The token binds the confirmation to the proposals shown; the backend refuses if they changed.
        {
          baseVersionId: detail.packageReview!.baseVersion?.id ?? null,
          token: detail.packageReview!.token,
        },
        `${proposals.length} usulan dikonfirmasi.`,
      ).then((out) => {
        // Rejected (e.g. proposals changed): show the current proposals instead of the stale ones.
        if (!out) api<RabImportDetailDto>('GET', base).then(setDetail, () => undefined);
      });
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel rab-header" aria-labelledby="run-title">
        <div className="min-w-0">
          <h2 id="run-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            Impor {rabVersionLabel({ versionType: run.targetVersionType, revisionNumber: run.targetRevisionNumber })}{' '}
            <Badge tone={IMPORT_STATUS[run.status].tone}>{IMPORT_STATUS[run.status].label}</Badge>
          </h2>
          <p className="text-sm text-slate-600">
            Panduan {run.guideVersion} · percobaan {run.attemptNumber} · {run.createdBy.name}
          </p>
          {draft && (
            <ul className="mt-1 text-sm text-slate-600">
              {draft.sources.map((s) => (
                <li key={s.documentId}>
                  {s.filename} —{' '}
                  {s.role === 'RAB'
                    ? `RAB, sheet ${s.sheet}${s.block ? ` (blok ${s.block})` : ''}`
                    : 'pendukung'}
                  {s.analysisSheets.length > 0 && `; analisa: ${s.analysisSheets.join(', ')}`}
                </li>
              ))}
            </ul>
          )}
          {run.errorMessage && <Alert>{run.errorMessage}</Alert>}
          {run.rabVersionId && (
            <Link className="link-button" href={`/projects/${projectId}/rab/${run.rabVersionId}`}>
              Buka RAB hasil impor
            </Link>
          )}
        </div>
        {draft && (
          <dl className="calendar-preview">
            <div>
              <dt>Item</dt>
              <dd>
                <SourceValue
                  title="Jumlah item impor"
                  value={String(draft.stats.items)}
                  sources={[{ label: 'Item pekerjaan dalam draft', href: '#rows-title' }]}
                >
                  {draft.stats.items}
                </SourceValue>
              </dd>
            </div>
            <div>
              <dt>Analisa diimpor / di workbook</dt>
              <dd>
                {draft.stats.analysesImported} / {draft.stats.analysesInWorkbook} (
                {draft.stats.subAnalyses} subanalisa)
              </dd>
            </div>
            <div>
              <dt>Komponen · harga</dt>
              <dd>
                {draft.stats.components} · {draft.stats.pricesImported}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {(run.status === 'UPLOADED' || run.status === 'PROCESSING') && (
        <Alert kind="info">Sedang diproses… halaman diperbarui otomatis.</Alert>
      )}
      {notice && (
        <Alert kind={notice.kind}>
          {notice.text}
          {notice.issues && (
            <ul className="mt-1 list-disc pl-5">
              {notice.issues.slice(0, 10).map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {reconciliation && (
        <section className="panel form-panel" aria-labelledby="recon-title">
          <h2 id="recon-title" className="text-base font-semibold">
            Rekonsiliasi total (D-043)
          </h2>
          <p className="text-sm">
            Aplikasi: Rp{' '}
            <SourceValue
              title="Total hasil impor"
              value={reconciliation.realCost}
              formula="Agregasi item RAB, PPN dan pembulatan real cost 2 desimal"
              sources={[{ label: 'Item pekerjaan draft', href: '#rows-title' }]}
            >
              {formatNumber(reconciliation.realCost)}
            </SourceValue>{' '}
            · dibulatkan Rp{' '}
            <SourceValue
              title="Total impor dibulatkan"
              value={reconciliation.rounded}
              formula="TRUNC(real cost, 0)"
              sources={[
                {
                  label: 'Real cost hasil impor',
                  value: reconciliation.realCost,
                  href: '#recon-title',
                },
              ]}
            >
              {formatNumber(reconciliation.rounded)}
            </SourceValue>
            {reconciliation.workbookRealCost && (
              <>
                {' '}
                — workbook: Rp{' '}
                <SourceValue
                  title="Real cost workbook"
                  value={reconciliation.workbookRealCost}
                  note="Nilai cached workbook yang dicatat saat rekonsiliasi impor."
                  sources={(draft?.sources ?? [])
                    .filter((source) => source.role === 'RAB')
                    .flatMap((source) =>
                      workbookSource(projectId, {
                        documentId: source.documentId,
                        sheet: source.sheet,
                      }),
                    )}
                >
                  {formatNumber(reconciliation.workbookRealCost)}
                </SourceValue>
                {reconciliation.workbookRounded && (
                  <>
                    {' '}
                    · dibulatkan Rp{' '}
                    <SourceValue
                      title="Pembulatan workbook"
                      value={reconciliation.workbookRounded}
                      note="Nilai pembulatan sumber yang dicatat pada rekonsiliasi."
                      sources={(draft?.sources ?? [])
                        .filter((source) => source.role === 'RAB')
                        .flatMap((source) =>
                          workbookSource(projectId, {
                            documentId: source.documentId,
                            sheet: source.sheet,
                          }),
                        )}
                    >
                      {formatNumber(reconciliation.workbookRounded)}
                    </SourceValue>
                  </>
                )}{' '}
                <Badge tone={reconciliation.matches ? 'green' : 'red'}>
                  {reconciliation.matches ? 'Cocok' : 'Berbeda'}
                </Badge>
              </>
            )}
          </p>
          {reconciliation.rowsChecked > 0 ? (
            <p className="text-sm">
              Item dicocokkan dengan nilai cached workbook (toleransi Rp 0,000001, D-054):{' '}
              {reconciliation.rowsChecked} item,{' '}
              <Badge tone={reconciliation.rowsMismatched ? 'red' : 'green'}>
                {reconciliation.rowsMismatched
                  ? `${reconciliation.rowsMismatched} berbeda`
                  : 'semua cocok'}
              </Badge>
              {reconciliation.totalStatus && (
                <>
                  {' '}
                  · total{' '}
                  <Badge
                    tone={
                      reconciliation.totalStatus === 'MISMATCH'
                        ? 'red'
                        : reconciliation.totalStatus === 'FLOAT_RESIDUE'
                          ? 'blue'
                          : 'green'
                    }
                  >
                    {reconciliation.totalStatus === 'MISMATCH'
                      ? 'selisih nominal'
                      : reconciliation.totalStatus === 'FLOAT_RESIDUE'
                        ? 'cocok · sisa float Excel di sel total'
                        : 'cocok'}
                  </Badge>
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Rekonsiliasi per item belum tersedia (draft lama atau harga item belum diputuskan).
            </p>
          )}
          {reconciliation.entries.length > 0 && (
            <ul className="text-sm text-slate-600">
              {reconciliation.entries.map((e) => (
                <li key={e.what}>
                  {e.what}: aplikasi {e.exact} · workbook {e.cached} · selisih {e.diff}{' '}
                  {e.matches ? '≤' : '>'} {e.tolerance}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {draft && (
        <section className="space-y-3" aria-labelledby="issues-title">
          <h2 id="issues-title" className="text-base font-semibold">
            Pemeriksaan: {blocking.length} harus diputuskan ·{' '}
            {issues.filter((i) => i.severity === 'WARNING').length} peringatan ·{' '}
            {issues.filter((i) => i.severity === 'INFO').length} info
          </h2>
          {general.length > 0 && (
            <ul className="panel form-panel space-y-1 text-sm">
              {general.map((i, n) => (
                <li key={n}>
                  <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge> {i.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {detail.packageReview && (
        <PackageReview
          review={detail.packageReview}
          editable={canReview && reviewable && !busy}
          onConfirm={confirmPackage}
        />
      )}

      {draft && (
        <section className="space-y-3" aria-labelledby="rows-title">
          <h2 id="rows-title" className="text-base font-semibold">
            Item pekerjaan (nama mengikuti rekap)
          </h2>
          <nav className="access-tabs" aria-label="Filter item">
            {(
              [
                ['open', 'Perlu keputusan'],
                ['warning', 'Peringatan'],
                ['all', 'Semua'],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {shown.length === 0 ? (
            <EmptyState>Tidak ada item pada filter ini.</EmptyState>
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
                    <th scope="col" className="num">
                      Volume
                    </th>
                    <th scope="col" className="num">
                      Harga sumber
                    </th>
                    <th scope="col">Analisa &amp; bukti</th>
                    <th scope="col">Keputusan</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <RowReview
                      key={r.key}
                      projectId={projectId}
                      importPath={base}
                      row={r}
                      issues={issuesByRow.get(r.key) ?? []}
                      analysis={r.price.analysisKey ? analyses.get(r.price.analysisKey) : undefined}
                      decided={(kind) => latest.get(`${r.key}|${kind}`)}
                      editable={canReview && reviewable && !busy}
                      onDecide={(d, success) => decide([d], success)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {draft && draft.analyses.length > 0 && (
        <section className="space-y-3" aria-labelledby="analyses-title">
          <h2 id="analyses-title" className="text-base font-semibold">
            Analisa terpakai ({draft.analyses.filter((a) => !a.candidateOnly).length}) dan kandidat
            ({draft.analyses.filter((a) => a.candidateOnly).length})
          </h2>
          <div className="space-y-2">
            {draft.analyses.map((a) => (
              <AnalysisDraft key={a.key} analysis={a} projectId={projectId} />
            ))}
          </div>
        </section>
      )}

      {aiRuns.length > 0 && (
        <section className="space-y-2" aria-labelledby="ai-title">
          <h2 id="ai-title" className="text-base font-semibold">
            Panggilan AI
          </h2>
          <ul className="panel form-panel space-y-1 text-sm">
            {aiRuns.map((a) => (
              <li key={a.id}>
                <Badge tone={a.status === 'SUCCEEDED' ? 'green' : 'red'}>{a.status}</Badge>{' '}
                {a.model} · percobaan {a.attempt} · {a.instructionVersion}
                {a.error && ` · ${a.error}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Only when an action or hint applies; an approved run otherwise rendered an empty card. */}
      {(canApprove || canReview) &&
        ((canApprove && reviewable) ||
          (canReview && (run.status === 'FAILED' || run.status === 'REJECTED')) ||
          (blocking.length > 0 && reviewable)) && (
        <section
          className="panel form-panel flex flex-wrap items-end gap-3"
          aria-label="Aksi impor"
        >
          {canApprove && reviewable && (
            <>
              <Button
                disabled={busy || blocking.length > 0}
                onClick={() =>
                  window.confirm(
                    'Approve impor? Daftar harga dan analisa resmi dibuat, serta RAB versi DRAFT yang tertaut. RAB tetap perlu di-approve di tab RAB.',
                  ) &&
                  run_('POST', '/approve', undefined, 'Impor di-approve; RAB DRAFT dibuat.').then(
                    () => router.refresh(),
                  )
                }
              >
                Approve impor
              </Button>
              <RejectForm
                busy={busy}
                onReject={(reason) => run_('POST', '/reject', { reason }, 'Impor ditolak.')}
              />
            </>
          )}
          {canReview && (run.status === 'FAILED' || run.status === 'REJECTED') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                const out = await run_('POST', '/retry', undefined, 'Run baru dibuat.');
                if (out && !('import' in out))
                  router.push(`/projects/${projectId}/imports/${out.id}`);
              }}
            >
              Ulangi (run baru)
            </Button>
          )}
          {blocking.length > 0 && reviewable && (
            <p className="field-hint w-full">
              Approve aktif setelah semua {blocking.length} masalah diputuskan.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function PackageReview({
  review,
  editable,
  onConfirm,
}: {
  review: PackageReviewDto;
  editable: boolean;
  onConfirm: () => void;
}) {
  const { counts, proposals } = review;
  return (
    <section className="panel form-panel space-y-2" aria-labelledby="package-title">
      <h2 id="package-title" className="text-base font-semibold">
        Review paket terhadap {review.baseVersion?.label ?? 'versi approved terakhir'}
      </h2>
      <p className="text-sm text-slate-600">
        {review.sourceHasAnalyses === null
          ? 'Draft lama tanpa data blok analisa sumber: pewarisan analisa tidak diusulkan.'
          : review.sourceHasAnalyses
            ? 'Sumber memuat analisa: sumber baru menjadi dasar; analisa tidak diwariskan otomatis.'
            : 'Sumber tidak memuat analisa: analisa dapat diwariskan sebagai salinan dari versi dasar.'}
      </p>
      <dl className="calendar-preview">
        <div>
          <dt>Item dengan analisa sumber</dt>
          <dd>{counts.fromSource}</dd>
        </div>
        <div>
          <dt>Item dengan usulan warisan analisa</dt>
          <dd>{counts.inherit}</dd>
        </div>
        <div>
          <dt>Item dengan usulan pekerjaan cocok</dt>
          <dd>{counts.match}</dd>
        </div>
        <div>
          <dt>Item baru tanpa pasangan</dt>
          <dd>{counts.newItems}</dd>
        </div>
        <div>
          <dt>Item masih bermasalah setelah konfirmasi</dt>
          <dd>{counts.problems}</dd>
        </div>
      </dl>
      {proposals.length > 0 ? (
        <>
          <details className="text-sm">
            <summary>Lihat {proposals.length} usulan beserta buktinya</summary>
            <ul className="mt-1 space-y-1">
              {proposals.map((p) => (
                <li key={p.rowKey}>
                  <strong>{p.description}</strong>
                  {p.workItem && <span className="block text-xs">Pekerjaan: {p.workItem.reason}</span>}
                  {p.analysis && <span className="block text-xs">Analisa: {p.analysis.reason}</span>}
                </li>
              ))}
            </ul>
          </details>
          {editable && (
            <Button variant="secondary" onClick={onConfirm}>
              Konfirmasi {proposals.length} usulan paket
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-600">Tidak ada usulan paket yang terbuka.</p>
      )}
      <p className="field-hint">
        Usulan AI, kandidat ganda, pekerjaan baru, konflik harga/satuan, dan perubahan analisa tetap
        diputuskan per item di bawah. Approval impor tetap terpisah.
      </p>
    </section>
  );
}

function RowReview({
  projectId,
  importPath,
  row,
  issues,
  analysis,
  decided,
  editable,
  onDecide,
}: {
  projectId: string;
  importPath: string;
  row: DraftRow;
  issues: ImportIssue[];
  analysis: DraftAnalysis | undefined;
  decided: (kind: string) => RabImportDetailDto['decisions'][number] | undefined;
  editable: boolean;
  onDecide: (d: Decision, success: string) => void;
}) {
  const has = (code: string) => issues.some((i) => i.code === code);
  const link = decided('ANALYSIS_LINK');
  const price = decided('PRICE_CHOICE');
  const direct = decided('DIRECT_PRICE');
  const work = decided('WORK_ITEM_MATCH');
  const [overriding, setOverriding] = useState(false);
  return (
    <tr>
      <td className="rab-sticky-no">{row.displayNumber}</td>
      <td className="rab-sticky-desc">
        {row.description}
        <span className="block text-xs text-slate-500">
          {row.groupPath} · baris {row.locator.row}
        </span>
      </td>
      <td className="num">
        <SourceValue
          title={`Volume sumber · ${row.description}`}
          value={row.volume}
          sources={workbookSource(projectId, row.locator)}
        >
          {formatNumber(row.volume, { trim: true })}
        </SourceValue>{' '}
        {row.unit}
      </td>
      <td className="num">
        <SourceValue
          title={`Harga sumber · ${row.description}`}
          value={row.sourceUnitPrice}
          sources={workbookSource(projectId, row.locator)}
          note="Harga pada dokumen sumber, belum menjadi harga resmi sebelum approval."
        >
          {formatRounded(row.sourceUnitPrice, 2)}
        </SourceValue>
      </td>
      <td className="rab-wrap">
        {row.price.kind === 'ANALYSIS' && analysis ? (
          <span>
            <Badge tone="green">Terbukti rumus</Badge> {analysis.code} — {analysis.name}
          </span>
        ) : row.price.kind === 'DIRECT' ? (
          <Badge>Harga langsung</Badge>
        ) : (
          <Badge tone="red">Belum terbukti</Badge>
        )}
        {row.price.evidence.length > 0 && (
          <details className="text-xs">
            <summary>Rantai rumus ({row.price.evidence.length} langkah)</summary>
            <ol className="list-decimal pl-5">
              {row.price.evidence.map((e, n) => (
                <li key={n} className="font-mono">
                  <SourceValue
                    title={`Bukti rumus · ${e.cell}`}
                    value={String(e.value)}
                    formula={e.formula ?? undefined}
                    sources={workbookSource(projectId, {
                      documentId: row.locator.documentId,
                      sheet: e.cell.includes('!')
                        ? e.cell.slice(0, e.cell.lastIndexOf('!'))
                        : row.locator.sheet,
                      cell: e.cell.split('!').at(-1),
                    })}
                  >
                    {e.cell}
                    {e.formula ? ` = ${e.formula}` : ''} → {String(e.value)}
                  </SourceValue>
                </li>
              ))}
            </ol>
          </details>
        )}
        {issues.map((i, n) => (
          <p key={n} className="text-xs text-slate-600">
            <Badge tone={SEVERITY_TONE[i.severity]}>{i.code}</Badge> {i.message}
          </p>
        ))}
      </td>
      <td className="rab-wrap">
        <div className="space-y-1 text-xs">
          {link && <p>Analisa dipilih oleh {link.decidedBy.name}</p>}
          {direct && <p>Harga langsung diterima oleh {direct.decidedBy.name}</p>}
          {price && (
            <p>
              Harga:{' '}
              {(price.value as { source: string }).source === 'SOURCE_OVERRIDE'
                ? `override sumber (${price.reason})`
                : 'harga analisa'}{' '}
              — {price.decidedBy.name}
            </p>
          )}
          {work && (
            <p>
              Pekerjaan:{' '}
              {(work.value as { workItemId: string | null }).workItemId ? 'dicocokkan' : 'baru'} —{' '}
              {work.decidedBy.name}
            </p>
          )}
          {editable && has('ANALYSIS_UNRESOLVED') && (
            <div className="row-actions">
              {row.analysisCandidates.map((c) => (
                <Button
                  key={c.analysisVersionId ?? c.analysisKey}
                  variant="secondary"
                  title={c.reason}
                  onClick={() =>
                    onDecide(
                      {
                        rowKey: row.key,
                        kind: 'ANALYSIS_LINK',
                        value: c.analysisVersionId
                          ? { analysisVersionId: c.analysisVersionId }
                          : { analysisKey: c.analysisKey },
                        reason: c.reason,
                      },
                      `Analisa ${c.code ?? ''} dipilih.`,
                    )
                  }
                >
                  {c.analysisVersionId ? 'Salin' : 'Pakai'} {c.code}{' '}
                  {c.origin === 'AI' ? '(AI)' : ''}
                </Button>
              ))}
              {row.sourceUnitPrice && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    onDecide(
                      { rowKey: row.key, kind: 'DIRECT_PRICE', value: { accept: true } },
                      'Harga langsung diterima.',
                    )
                  }
                >
                  Harga langsung
                </Button>
              )}
            </div>
          )}
          {editable && (has('PRICE_MISMATCH') || has('PRICE_SCALE')) && (
            <div className="row-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  onDecide(
                    { rowKey: row.key, kind: 'PRICE_CHOICE', value: { source: 'ANALYSIS' } },
                    'Harga analisa dipakai.',
                  )
                }
              >
                Pakai harga analisa
              </Button>
              <Button
                variant="secondary"
                aria-expanded={overriding}
                onClick={() => setOverriding((open) => !open)}
              >
                Override harga sumber
              </Button>
            </div>
          )}
          {editable && overriding && (has('PRICE_MISMATCH') || has('PRICE_SCALE')) && (
            <InlineReasonForm
              id={`override-${row.key}`}
              title="Pertahankan harga sumber"
              description="Harga di dokumen sumber dipakai walau berbeda dengan analisa; alasan dicatat bersama keputusan."
              label="Alasan override (wajib)"
              confirmLabel="Pertahankan harga sumber"
              busy={false}
              onCancel={() => setOverriding(false)}
              onSubmit={(reason) => {
                setOverriding(false);
                onDecide(
                  {
                    rowKey: row.key,
                    kind: 'PRICE_CHOICE',
                    value: { source: 'SOURCE_OVERRIDE' },
                    reason,
                  },
                  'Harga sumber dipertahankan.',
                );
              }}
            />
          )}
          {editable && has('WORK_ITEM_UNDECIDED') && (
            <div className="row-actions">
              {row.workItemCandidates.map((c) => (
                <Button
                  key={c.workItemId}
                  variant="secondary"
                  title={`${c.groupPath} · ${c.description}${c.unit ? ` · ${c.unit}` : ''}${c.analysisCode ? ` · ${c.analysisCode}` : ''}${c.reason ? `\n${c.reason}` : ''}`}
                  onClick={() =>
                    onDecide(
                      {
                        rowKey: row.key,
                        kind: 'WORK_ITEM_MATCH',
                        value: { workItemId: c.workItemId },
                        reason: c.reason,
                      },
                      `Dicocokkan ke ${c.code}.`,
                    )
                  }
                >
                  Cocokkan {c.code}
                  {c.reason ? ' (beda tanda baca)' : ''}
                </Button>
              ))}
              <WorkItemSearch
                importPath={importPath}
                row={row}
                onPick={(item) =>
                  onDecide(
                    {
                      rowKey: row.key,
                      kind: 'WORK_ITEM_MATCH',
                      value: { workItemId: item.workItemId },
                      reason: `Dipilih manual dari pencarian: ${item.code} "${item.description}".`.slice(0, 1000),
                    },
                    `Dicocokkan ke ${item.code}.`,
                  )
                }
              />
              <Button
                variant="secondary"
                onClick={() =>
                  onDecide(
                    { rowKey: row.key, kind: 'WORK_ITEM_MATCH', value: { workItemId: null } },
                    'Pekerjaan baru.',
                  )
                }
              >
                Pekerjaan baru
              </Button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function AnalysisDraft({ analysis: a, projectId }: { analysis: DraftAnalysis; projectId: string }) {
  const failed = a.reconciliation.filter((r) => !r.matches).length;
  return (
    <details className="panel form-panel">
      <summary className="cursor-pointer">
        <span className="font-mono">{a.code}</span> {a.name} — Rp{' '}
        <SourceValue
          title={`Harga draft analisa ${a.code ?? a.name}`}
          value={a.computed.price}
          formula={
            a.roundingScale === null
              ? 'Biaya langsung + overhead (tanpa pembulatan)'
              : `ROUND(biaya langsung + overhead, ${a.roundingScale}), HALF_UP`
          }
          sources={workbookSource(projectId, a.locator)}
        >
          {formatRounded(a.computed.price, 2)}
        </SourceValue>
        /{a.unit}
        {a.candidateOnly && ' · kandidat'} · {a.components.length} komponen · rekonsiliasi{' '}
        {a.reconciliation.length - failed}/{a.reconciliation.length} cocok
      </summary>
      <p className="mt-2 text-xs text-slate-600">
        Biaya langsung{' '}
        <SourceValue
          title="Biaya langsung draft"
          value={a.computed.directCost}
          formula="Σ (koefisien × harga satuan efektif)"
          sources={a.components.map((c) => ({
            label: c.description,
            value: c.amount,
            href: workbookSource(projectId, c.locator)[0]?.href,
          }))}
        >
          {formatRounded(a.computed.directCost, 6)}
        </SourceValue>{' '}
        + overhead{' '}
        <SourceValue
          title="Overhead draft (%)"
          value={a.overheadPercent}
          sources={workbookSource(projectId, a.locator)}
          note="Persentase per analisa sesuai sumber; tanpa overhead bila tidak tercatat."
        >
          {a.overheadPercent ?? 0}%
        </SourceValue>{' '}
        ={' '}
        <SourceValue
          title="Harga eksak draft"
          value={a.computed.priceExact}
          formula="Biaya langsung + nilai overhead"
          sources={[
            { label: 'Biaya langsung', value: a.computed.directCost },
            { label: 'Nilai overhead', value: a.computed.overheadAmount },
          ]}
        >
          {formatRounded(a.computed.priceExact, 6)}
        </SourceValue>
        {a.roundingScale !== null && (
          <>
            {' '}
            → dibulatkan {a.roundingScale} desimal ={' '}
            <SourceValue
              title="Harga draft setelah pembulatan"
              value={a.computed.price}
              formula={`ROUND(harga eksak, ${a.roundingScale}), HALF_UP`}
              sources={[{ label: 'Harga eksak', value: a.computed.priceExact }]}
            >
              {formatNumber(a.computed.price)}
            </SourceValue>
          </>
        )}{' '}
        · sumber {a.locator.sheet}!{a.locator.cell}
      </p>
      <div className="workbook-wrap">
        <table className="rab-grid mt-2">
          <thead>
            <tr>
              <th scope="col">Kategori</th>
              <th scope="col">Komponen</th>
              <th scope="col" className="num">
                Koefisien
              </th>
              <th scope="col" className="num">
                Harga
              </th>
              <th scope="col" className="num">
                Nilai
              </th>
              <th scope="col">Sumber harga</th>
            </tr>
          </thead>
          <tbody>
            {a.components.map((c, n) => (
              <tr key={n}>
                <td>{CATEGORY_LABEL[c.category]}</td>
                <td>
                  {c.description} <span className="text-xs text-slate-500">{c.unit}</span>
                </td>
                <td className="num">
                  <SourceValue
                    title={`Koefisien draft · ${c.description}`}
                    value={c.coefficient}
                    sources={workbookSource(projectId, c.locator)}
                  >
                    {formatNumber(c.coefficient, { trim: true })}
                  </SourceValue>
                </td>
                <td className="num">
                  <SourceValue
                    title={`Harga draft · ${c.description}`}
                    value={c.unitPrice}
                    sources={workbookSource(projectId, c.locator)}
                  >
                    {formatRounded(c.unitPrice, 2)}
                  </SourceValue>
                </td>
                <td className="num">
                  <SourceValue
                    title={`Jumlah draft · ${c.description}`}
                    value={c.amount}
                    formula="Koefisien × harga satuan efektif"
                    sources={[
                      { label: 'Koefisien', value: c.coefficient },
                      { label: 'Harga satuan', value: c.unitPrice },
                      ...workbookSource(projectId, c.locator),
                    ]}
                  >
                    {formatRounded(c.amount, 2)}
                  </SourceValue>
                </td>
                <td className="text-xs">
                  {c.source.kind === 'PRICE_ITEM'
                    ? `daftar harga${c.source.factor ? ` ${c.source.factor.op} ${c.source.factor.value}` : ''}`
                    : c.source.kind === 'ANALYSIS'
                      ? `subanalisa (${c.source.basis === 'EXACT' ? 'eksak' : 'dibulatkan'})`
                      : 'nilai di analisa'}
                  <span className="block font-mono text-slate-500">{c.evidence.at(-1)?.cell}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** D-067: explicit manual choice among the latest approved version's work items, also when no candidate exists. */
function WorkItemSearch({
  importPath,
  row,
  onPick,
}: {
  importPath: string;
  row: DraftRow;
  onPick: (item: WorkItemSearchDto['items'][number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<WorkItemSearchDto>();
  const [error, setError] = useState<string>();
  const search = (query: string, page: number) =>
    api<WorkItemSearchDto>(
      'GET',
      `${importPath}/work-items?${new URLSearchParams({ q: query, page: String(page) })}`,
    ).then(
      (r) => {
        setResult(r);
        setError(undefined);
      },
      (e) => setError(errorMessage(e)),
    );
  if (!open)
    return (
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          setQ(row.description);
          search(row.description, 1);
        }}
      >
        Cari pekerjaan lama
      </Button>
    );
  const pages = result ? Math.ceil(result.total / result.pageSize) : 0;
  return (
    <div className="w-full space-y-1">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(q, 1);
        }}
      >
        <Field
          id={`wi-search-${row.key}`}
          label={`Cari di ${result?.baseVersion?.label ?? 'versi approved terakhir'} (uraian, WI, kode analisa)`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="secondary">
          Cari
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Tutup
        </Button>
      </form>
      {error && <p className="field-error">{error}</p>}
      {result && result.items.length === 0 && <p>Tidak ada pekerjaan yang cocok.</p>}
      {result && result.items.length > 0 && (
        <ul className="space-y-1">
          {result.items.map((i) => (
            <li key={i.workItemId} className="flex items-start gap-2">
              <Button variant="secondary" onClick={() => onPick(i)}>
                Pilih {i.code}
              </Button>
              <span>
                {i.description}
                <span className="block text-slate-500">
                  {i.groupPath || '–'} · {i.unit ?? '–'} · analisa {i.analysisCode ?? '–'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="row-actions">
          <Button variant="secondary" disabled={result!.page <= 1} onClick={() => search(q, result!.page - 1)}>
            Sebelumnya
          </Button>
          <span>
            Halaman {result!.page}/{pages} ({result!.total})
          </span>
          <Button variant="secondary" disabled={result!.page >= pages} onClick={() => search(q, result!.page + 1)}>
            Berikutnya
          </Button>
        </div>
      )}
    </div>
  );
}

function RejectForm({ busy, onReject }: { busy: boolean; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        id="reject-reason"
        label="Alasan menolak"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        variant="danger"
        disabled={busy || reason.trim().length < 3}
        onClick={() => window.confirm('Tolak impor ini? Run tetap tersimpan.') && onReject(reason)}
      >
        Tolak
      </Button>
    </div>
  );
}
