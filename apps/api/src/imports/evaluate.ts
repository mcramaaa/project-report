import { calculateRab, Decimal, type RabTotals } from '@laporan-proyek/calc';
import type { DraftRow, ImportIssue, RabImportDecisionKind, RabImportDraft } from '@laporan-proyek/shared';

/**
 * Applies reviewer decisions to a draft (D-051, D-053). Pure: the review page and approval use the same
 * result, so approval only succeeds on what the reviewer saw. Row issues are recomputed from the latest
 * decision per row and kind; analysis issues count only for analyses that are actually used.
 */

export interface DecisionRecord {
  rowKey: string;
  kind: RabImportDecisionKind;
  value: unknown;
  reason: string | null;
  decidedBy: string;
  decidedAt: Date;
}

export interface OfficialVersion {
  analysisVersionId: string;
  code: string | null;
  name: string;
  unit: string | null;
  price: string;
}

export type EffectiveAnalysis = { kind: 'DRAFT'; key: string } | { kind: 'OFFICIAL'; versionId: string };

export interface EffectiveRow {
  row: DraftRow;
  analysis: EffectiveAnalysis | null;
  priceSource: 'ANALYSIS' | 'SOURCE_OVERRIDE' | 'DIRECT' | 'MANUAL';
  unitPrice: string | null;
  analysisUnitPrice: string | null;
  /** undefined = still undecided (non-contract); null = new work item. */
  workItemId: string | null | undefined;
  priceDecision: DecisionRecord | null;
}

export interface Evaluation {
  rows: EffectiveRow[];
  issues: ImportIssue[];
  /** Draft analyses that will be imported: used by rows (directly or as sub-analyses). */
  usedAnalysisKeys: Set<string>;
  totals: RabTotals;
  reconciliation: { realCost: string; rounded: string; workbookRealCost: string | null; workbookRounded: string | null; matches: boolean | null };
}

/** Row issues this module recomputes; the draft's versions of these are replaced. */
const ROW_CODES = new Set(['ANALYSIS_UNRESOLVED', 'PRICE_MISMATCH', 'PRICE_SCALE', 'MISSING_PRICE', 'WORK_ITEM_UNDECIDED', 'ANALYSIS_INVALID', 'DIRECT_PRICE']);

export function latestDecisions(decisions: DecisionRecord[]): Map<string, DecisionRecord> {
  const latest = new Map<string, DecisionRecord>();
  for (const d of [...decisions].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())) latest.set(`${d.rowKey}|${d.kind}`, d);
  return latest;
}

export function evaluateImport(draft: RabImportDraft, decisions: DecisionRecord[], official: Map<string, OfficialVersion>): Evaluation {
  const latest = latestDecisions(decisions);
  const get = (rowKey: string, kind: RabImportDecisionKind) => latest.get(`${rowKey}|${kind}`) ?? null;
  const analyses = new Map(draft.analyses.map((a) => [a.key, a]));
  const issues: ImportIssue[] = [];
  const rows: EffectiveRow[] = [];

  for (const row of draft.rows) {
    if (row.rowType !== 'ITEM') {
      rows.push({ row, analysis: null, priceSource: 'MANUAL', unitPrice: null, analysisUnitPrice: null, workItemId: null, priceDecision: null });
      continue;
    }
    const link = get(row.key, 'ANALYSIS_LINK');
    const direct = get(row.key, 'DIRECT_PRICE');
    const choice = get(row.key, 'PRICE_CHOICE');
    // The later of a link or a direct-price decision wins.
    const useDirect = direct && (!link || direct.decidedAt >= link.decidedAt);

    let analysis: EffectiveAnalysis | null = null;
    if (!useDirect && link) {
      const v = link.value as { analysisKey?: string; analysisVersionId?: string };
      analysis = v.analysisKey ? { kind: 'DRAFT', key: v.analysisKey } : v.analysisVersionId ? { kind: 'OFFICIAL', versionId: v.analysisVersionId } : null;
    } else if (!useDirect && row.price.kind === 'ANALYSIS' && row.price.analysisKey) {
      analysis = { kind: 'DRAFT', key: row.price.analysisKey };
    }

    const effective: EffectiveRow = { row, analysis, priceSource: 'DIRECT', unitPrice: null, analysisUnitPrice: null, workItemId: null, priceDecision: null };
    const label = row.description;
    if (analysis) {
      const price = analysis.kind === 'DRAFT' ? analyses.get(analysis.key)?.computed.price : official.get(analysis.versionId)?.price;
      if (price === undefined) {
        issues.push({ code: 'ANALYSIS_INVALID', severity: 'BLOCKING', message: `${label}: analisa tidak dapat dibaca atau tidak ditemukan.`, rowKey: row.key, resolvedBy: ['DIRECT_PRICE', 'ANALYSIS_LINK'] });
      } else {
        effective.analysisUnitPrice = price;
        if (row.sourceUnitPrice !== null && new Decimal(price).equals(row.sourceUnitPrice)) {
          effective.priceSource = 'ANALYSIS';
          effective.unitPrice = price;
        } else if (choice) {
          const source = (choice.value as { source: string }).source;
          effective.priceDecision = choice;
          effective.priceSource = source === 'SOURCE_OVERRIDE' ? 'SOURCE_OVERRIDE' : 'ANALYSIS';
          effective.unitPrice = source === 'SOURCE_OVERRIDE' ? row.sourceUnitPrice : price;
        } else {
          issues.push({
            code: 'PRICE_MISMATCH',
            severity: 'BLOCKING',
            message: `${label}: harga analisa ${price} ≠ harga RAB ${row.sourceUnitPrice ?? '–'}; pilih harga analisa atau override harga sumber dengan alasan.`,
            rowKey: row.key,
            resolvedBy: ['PRICE_CHOICE'],
          });
        }
      }
    } else if (useDirect || row.price.kind === 'DIRECT') {
      effective.priceSource = 'DIRECT';
      effective.unitPrice = row.sourceUnitPrice;
      issues.push({ code: 'DIRECT_PRICE', severity: 'WARNING', message: `${label}: harga langsung tanpa analisa (${row.sourceUnitPrice ?? '–'}).`, rowKey: row.key });
      if (row.sourceUnitPrice === null) issues.push({ code: 'MISSING_PRICE', severity: 'BLOCKING', message: `${label}: item tanpa harga satuan.`, rowKey: row.key, resolvedBy: ['ANALYSIS_LINK'] });
    } else if (row.sourceUnitPrice === null || new Decimal(row.sourceUnitPrice).isZero()) {
      issues.push({ code: 'MISSING_PRICE', severity: 'BLOCKING', message: `${label}: item tanpa harga satuan.`, rowKey: row.key, resolvedBy: ['ANALYSIS_LINK'] });
    } else {
      issues.push({
        code: 'ANALYSIS_UNRESOLVED',
        severity: 'BLOCKING',
        message: draft.issues.find((i) => i.rowKey === row.key && i.code === 'ANALYSIS_UNRESOLVED')?.message ?? `${label}: analisa belum terbukti.`,
        rowKey: row.key,
        resolvedBy: ['ANALYSIS_LINK', 'DIRECT_PRICE'],
      });
    }
    if (effective.unitPrice !== null && new Decimal(effective.unitPrice).decimalPlaces() > 2) {
      issues.push({ code: 'PRICE_SCALE', severity: 'BLOCKING', message: `${label}: harga satuan ${effective.unitPrice} lebih dari 2 desimal (D-043).`, rowKey: row.key, resolvedBy: ['PRICE_CHOICE'] });
    }

    if (draft.targetVersionType === 'CONTRACT') {
      effective.workItemId = null;
    } else {
      const match = get(row.key, 'WORK_ITEM_MATCH');
      effective.workItemId = match ? (match.value as { workItemId: string | null }).workItemId : undefined;
      if (!match) {
        issues.push({ code: 'WORK_ITEM_UNDECIDED', severity: 'BLOCKING', message: `${label}: tentukan pekerjaan permanen (cocokkan atau baru).`, rowKey: row.key, resolvedBy: ['WORK_ITEM_MATCH'] });
      }
    }
    rows.push(effective);
  }

  const counts = new Map<string, string[]>();
  for (const r of rows) if (r.workItemId) counts.set(r.workItemId, [...(counts.get(r.workItemId) ?? []), r.row.key]);
  for (const [id, keys] of counts) {
    if (keys.length > 1) {
      for (const key of keys) issues.push({ code: 'WORK_ITEM_DUPLICATE', severity: 'BLOCKING', message: `Pekerjaan permanen ${id} dipilih untuk ${keys.length} baris.`, rowKey: key, resolvedBy: ['WORK_ITEM_MATCH'] });
    }
  }

  // Analyses used by the effective rows, and their sub-analyses.
  const usedAnalysisKeys = new Set<string>();
  const visit = (key: string) => {
    if (usedAnalysisKeys.has(key)) return;
    usedAnalysisKeys.add(key);
    for (const c of analyses.get(key)?.components ?? []) if (c.source.kind === 'ANALYSIS') visit(c.source.analysisKey);
  };
  for (const r of rows) if (r.analysis?.kind === 'DRAFT') visit(r.analysis.key);

  // Keep the draft's non-row issues: analysis issues only while the analysis is used.
  for (const i of draft.issues) {
    if (i.rowKey && ROW_CODES.has(i.code)) continue;
    if (i.analysisKey && !usedAnalysisKeys.has(i.analysisKey)) continue;
    if (i.rowKey && i.code === 'ROUNDING_UNSUPPORTED' && rows.find((r) => r.row.key === i.rowKey)?.priceSource === 'DIRECT') continue;
    issues.push(i);
  }

  const totals = calculateRab(
    rows.map((r) => ({
      id: r.row.key,
      parentId: r.row.parentKey,
      rowType: r.row.rowType,
      volume: r.row.volume,
      unitPrice: r.unitPrice,
      taxPercent: r.row.taxPercent,
    })),
  ).totals;
  const wb = draft.workbookTotals;
  const workbookRealCost = wb ? new Decimal(wb.value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : null;
  const matches = wb ? totals.realCost === workbookRealCost && (wb.rounded === null || totals.rounded === wb.rounded) : null;
  if (matches === false) {
    issues.push({
      code: 'RAB_TOTAL_MISMATCH',
      severity: 'WARNING',
      message: `Total aplikasi ${totals.realCost} (dibulatkan ${totals.rounded}) berbeda dengan workbook ${workbookRealCost} (dibulatkan ${wb?.rounded ?? '–'}).`,
    });
  }
  return { rows, issues, usedAnalysisKeys, totals, reconciliation: { realCost: totals.realCost, rounded: totals.rounded, workbookRealCost, workbookRounded: wb?.rounded ?? null, matches } };
}

export const blockingIssues = (issues: ImportIssue[]) => issues.filter((i) => i.severity === 'BLOCKING');
