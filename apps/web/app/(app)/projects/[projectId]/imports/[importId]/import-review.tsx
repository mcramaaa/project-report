'use client';

import type { DraftAnalysis, DraftRow, ImportIssue, RabImportDetailDto, RabImportSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORY_LABEL, IMPORT_STATUS, VERSION_LABEL } from '@/lib/import-ui';
import { formatNumber, formatRounded } from '@/lib/project-fields';

type Decision = { rowKey: string; kind: string; value: unknown; reason?: string };
type Filter = 'all' | 'open' | 'warning';

const SEVERITY_TONE = { BLOCKING: 'red', WARNING: 'blue', INFO: 'slate' } as const;

export function ImportReview({ projectId, initial, canReview, canApprove }: { projectId: string; initial: RabImportDetailDto; canReview: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string; issues?: ImportIssue[] }>();
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
  const shown = items.filter((r) => filter === 'all' || (issuesByRow.get(r.key) ?? []).some((i) => (filter === 'open' ? i.severity === 'BLOCKING' : i.severity !== 'BLOCKING')));
  const analyses = new Map((draft?.analyses ?? []).map((a) => [a.key, a]));

  async function run_(method: string, path: string, body: unknown, success: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const out = await api<RabImportDetailDto | RabImportSummaryDto>(method, `${base}${path}`, body);
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

  const decide = (list: Decision[], success: string) => run_('POST', '/decisions', { decisions: list }, success);

  function acceptSingleCandidates() {
    const list: Decision[] = [];
    for (const r of items) {
      const open = issuesByRow.get(r.key) ?? [];
      if (open.some((i) => i.code === 'ANALYSIS_UNRESOLVED') && r.analysisCandidates.length === 1) {
        const c = r.analysisCandidates[0]!;
        list.push({ rowKey: r.key, kind: 'ANALYSIS_LINK', value: c.analysisVersionId ? { analysisVersionId: c.analysisVersionId } : { analysisKey: c.analysisKey }, reason: `Reviewer menerima kandidat tunggal: ${c.reason}`.slice(0, 1000) });
      }
      if (open.some((i) => i.code === 'WORK_ITEM_UNDECIDED') && r.workItemCandidates.length === 1) {
        list.push({ rowKey: r.key, kind: 'WORK_ITEM_MATCH', value: { workItemId: r.workItemCandidates[0]!.workItemId }, reason: 'Reviewer menerima kandidat tunggal (jalur kelompok + uraian sama).' });
      }
    }
    if (!list.length) return setNotice({ kind: 'error', text: 'Tidak ada baris dengan tepat satu kandidat yang masih terbuka.' });
    if (window.confirm(`Catat ${list.length} keputusan untuk baris yang hanya memiliki satu kandidat? Setiap keputusan tercatat atas nama Anda.`)) {
      void decide(list, `${list.length} keputusan dicatat.`);
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel rab-header" aria-labelledby="run-title">
        <div className="min-w-0">
          <h2 id="run-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            Impor {VERSION_LABEL[run.targetVersionType]} <Badge tone={IMPORT_STATUS[run.status].tone}>{IMPORT_STATUS[run.status].label}</Badge>
          </h2>
          <p className="text-sm text-slate-600">
            Panduan {run.guideVersion} · percobaan {run.attemptNumber} · {run.createdBy.name}
          </p>
          {draft && (
            <ul className="mt-1 text-sm text-slate-600">
              {draft.sources.map((s) => (
                <li key={s.documentId}>
                  {s.filename} — {s.role === 'RAB' ? `RAB, sheet ${s.sheet}${s.block ? ` (blok ${s.block})` : ''}` : 'pendukung'}
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
              <dd>{draft.stats.items}</dd>
            </div>
            <div>
              <dt>Analisa diimpor / di workbook</dt>
              <dd>
                {draft.stats.analysesImported} / {draft.stats.analysesInWorkbook} ({draft.stats.subAnalyses} subanalisa)
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

      {(run.status === 'UPLOADED' || run.status === 'PROCESSING') && <Alert kind="info">Sedang diproses… halaman diperbarui otomatis.</Alert>}
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
            Aplikasi: Rp {formatNumber(reconciliation.realCost)} · dibulatkan Rp {formatNumber(reconciliation.rounded)}
            {reconciliation.workbookRealCost && (
              <>
                {' '}
                — workbook: Rp {formatNumber(reconciliation.workbookRealCost)}
                {reconciliation.workbookRounded && ` · dibulatkan Rp ${formatNumber(reconciliation.workbookRounded)}`}{' '}
                <Badge tone={reconciliation.matches ? 'green' : 'red'}>{reconciliation.matches ? 'Cocok' : 'Berbeda'}</Badge>
              </>
            )}
          </p>
        </section>
      )}

      {draft && (
        <section className="space-y-3" aria-labelledby="issues-title">
          <h2 id="issues-title" className="text-base font-semibold">
            Pemeriksaan: {blocking.length} harus diputuskan · {issues.filter((i) => i.severity === 'WARNING').length} peringatan · {issues.filter((i) => i.severity === 'INFO').length} info
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
          {canReview && reviewable && (
            <Button variant="secondary" disabled={busy} onClick={acceptSingleCandidates}>
              Terima semua kandidat tunggal
            </Button>
          )}
        </section>
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
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
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
                    <th scope="col" className="rab-sticky-no">No</th>
                    <th scope="col" className="rab-sticky-desc">Uraian</th>
                    <th scope="col" className="num">Volume</th>
                    <th scope="col" className="num">Harga sumber</th>
                    <th scope="col">Analisa &amp; bukti</th>
                    <th scope="col">Keputusan</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <RowReview
                      key={r.key}
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
            Analisa terpakai ({draft.analyses.filter((a) => !a.candidateOnly).length}) dan kandidat ({draft.analyses.filter((a) => a.candidateOnly).length})
          </h2>
          <div className="space-y-2">
            {draft.analyses.map((a) => (
              <AnalysisDraft key={a.key} analysis={a} />
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
                <Badge tone={a.status === 'SUCCEEDED' ? 'green' : 'red'}>{a.status}</Badge> {a.model} · percobaan {a.attempt} · {a.instructionVersion}
                {a.error && ` · ${a.error}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(canApprove || canReview) && (
        <section className="panel form-panel flex flex-wrap items-end gap-3" aria-label="Aksi impor">
          {canApprove && reviewable && (
            <>
              <Button
                disabled={busy || blocking.length > 0}
                onClick={() =>
                  window.confirm('Approve impor? Daftar harga dan analisa resmi dibuat, serta RAB versi DRAFT yang tertaut. RAB tetap perlu di-approve di tab RAB.') &&
                  run_('POST', '/approve', undefined, 'Impor di-approve; RAB DRAFT dibuat.').then(() => router.refresh())
                }
              >
                Approve impor
              </Button>
              <RejectForm busy={busy} onReject={(reason) => run_('POST', '/reject', { reason }, 'Impor ditolak.')} />
            </>
          )}
          {canReview && (run.status === 'FAILED' || run.status === 'REJECTED') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                const out = await run_('POST', '/retry', undefined, 'Run baru dibuat.');
                if (out && !('import' in out)) router.push(`/projects/${projectId}/imports/${out.id}`);
              }}
            >
              Ulangi (run baru)
            </Button>
          )}
          {blocking.length > 0 && reviewable && <p className="field-hint w-full">Approve aktif setelah semua {blocking.length} masalah diputuskan.</p>}
        </section>
      )}
    </div>
  );
}

function RowReview({
  row,
  issues,
  analysis,
  decided,
  editable,
  onDecide,
}: {
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
        {formatNumber(row.volume, { trim: true })} {row.unit}
      </td>
      <td className="num">{formatRounded(row.sourceUnitPrice, 2)}</td>
      <td>
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
                  {e.cell}
                  {e.formula ? ` = ${e.formula}` : ''} → {String(e.value)}
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
      <td>
        <div className="space-y-1 text-xs">
          {link && <p>Analisa dipilih oleh {link.decidedBy.name}</p>}
          {direct && <p>Harga langsung diterima oleh {direct.decidedBy.name}</p>}
          {price && (
            <p>
              Harga: {(price.value as { source: string }).source === 'SOURCE_OVERRIDE' ? `override sumber (${price.reason})` : 'harga analisa'} — {price.decidedBy.name}
            </p>
          )}
          {work && <p>Pekerjaan: {(work.value as { workItemId: string | null }).workItemId ? 'dicocokkan' : 'baru'} — {work.decidedBy.name}</p>}
          {editable && has('ANALYSIS_UNRESOLVED') && (
            <div className="row-actions">
              {row.analysisCandidates.map((c) => (
                <Button
                  key={c.analysisVersionId ?? c.analysisKey}
                  variant="secondary"
                  title={c.reason}
                  onClick={() =>
                    onDecide(
                      { rowKey: row.key, kind: 'ANALYSIS_LINK', value: c.analysisVersionId ? { analysisVersionId: c.analysisVersionId } : { analysisKey: c.analysisKey }, reason: c.reason },
                      `Analisa ${c.code ?? ''} dipilih.`,
                    )
                  }
                >
                  Pakai {c.code} {c.origin === 'AI' ? '(AI)' : ''}
                </Button>
              ))}
              {row.sourceUnitPrice && (
                <Button variant="secondary" onClick={() => onDecide({ rowKey: row.key, kind: 'DIRECT_PRICE', value: { accept: true } }, 'Harga langsung diterima.')}>
                  Harga langsung
                </Button>
              )}
            </div>
          )}
          {editable && (has('PRICE_MISMATCH') || has('PRICE_SCALE')) && (
            <div className="row-actions">
              <Button variant="secondary" onClick={() => onDecide({ rowKey: row.key, kind: 'PRICE_CHOICE', value: { source: 'ANALYSIS' } }, 'Harga analisa dipakai.')}>
                Pakai harga analisa
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const reason = window.prompt('Alasan override harga sumber (wajib):')?.trim();
                  if (reason) onDecide({ rowKey: row.key, kind: 'PRICE_CHOICE', value: { source: 'SOURCE_OVERRIDE' }, reason }, 'Harga sumber dipertahankan.');
                }}
              >
                Override harga sumber
              </Button>
            </div>
          )}
          {editable && has('WORK_ITEM_UNDECIDED') && (
            <div className="row-actions">
              {row.workItemCandidates.map((c) => (
                <Button key={c.workItemId} variant="secondary" title={`${c.groupPath} · ${c.description}`} onClick={() => onDecide({ rowKey: row.key, kind: 'WORK_ITEM_MATCH', value: { workItemId: c.workItemId } }, `Dicocokkan ke ${c.code}.`)}>
                  Cocokkan {c.code}
                </Button>
              ))}
              <Button variant="secondary" onClick={() => onDecide({ rowKey: row.key, kind: 'WORK_ITEM_MATCH', value: { workItemId: null } }, 'Pekerjaan baru.')}>
                Pekerjaan baru
              </Button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function AnalysisDraft({ analysis: a }: { analysis: DraftAnalysis }) {
  const failed = a.reconciliation.filter((r) => !r.matches).length;
  return (
    <details className="panel form-panel">
      <summary className="cursor-pointer">
        <span className="font-mono">{a.code}</span> {a.name} — Rp {formatRounded(a.computed.price, 2)}/{a.unit}
        {a.candidateOnly && ' · kandidat'} · {a.components.length} komponen · rekonsiliasi {a.reconciliation.length - failed}/{a.reconciliation.length} cocok
      </summary>
      <p className="mt-2 text-xs text-slate-600">
        Biaya langsung {formatRounded(a.computed.directCost, 6)} + overhead {a.overheadPercent ?? 0}% = {formatRounded(a.computed.priceExact, 6)}
        {a.roundingScale !== null && ` → dibulatkan ${a.roundingScale} desimal = ${formatNumber(a.computed.price)}`} · sumber {a.locator.sheet}!{a.locator.cell}
      </p>
      <table className="rab-grid mt-2">
        <thead>
          <tr>
            <th scope="col">Kategori</th>
            <th scope="col">Komponen</th>
            <th scope="col" className="num">Koefisien</th>
            <th scope="col" className="num">Harga</th>
            <th scope="col" className="num">Nilai</th>
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
              <td className="num">{formatNumber(c.coefficient, { trim: true })}</td>
              <td className="num">{formatRounded(c.unitPrice, 2)}</td>
              <td className="num">{formatRounded(c.amount, 2)}</td>
              <td className="text-xs">
                {c.source.kind === 'PRICE_ITEM' ? `daftar harga${c.source.factor ? ` ${c.source.factor.op} ${c.source.factor.value}` : ''}` : c.source.kind === 'ANALYSIS' ? `subanalisa (${c.source.basis === 'EXACT' ? 'eksak' : 'dibulatkan'})` : 'nilai di analisa'}
                <span className="block font-mono text-slate-500">{c.evidence.at(-1)?.cell}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function RejectForm({ busy, onReject }: { busy: boolean; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field id="reject-reason" label="Alasan menolak" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => window.confirm('Tolak impor ini? Run tetap tersimpan.') && onReject(reason)}>
        Tolak
      </Button>
    </div>
  );
}
