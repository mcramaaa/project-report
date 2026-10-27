import { createHash } from 'node:crypto';
import { Decimal } from '@laporan-proyek/calc';
import type { PackageReviewDto, RabImportDraft } from '@laporan-proyek/shared';
import { normalizeText, workItemEvidence, type PreviousItem } from './build-draft';
import { evaluateImport, latestDecisions, type DecisionRecord, type OfficialVersion } from './evaluate';

/**
 * Package review (D-065): proposals for MC rows whose evidence against the latest approved version is
 * unambiguous. Pure and recomputed from the current base on every read and confirmation; a proposal is never a
 * decision until the reviewer confirms it. Everything else stays an explicit per-row decision.
 */

export type BaseItem = PreviousItem;

export interface PackageBase {
  version: { id: string; label: string } | null;
  items: BaseItem[];
  official: Map<string, OfficialVersion>;
}

const same = (a: string | null, b: string | null) => normalizeText(a ?? '') === normalizeText(b ?? '');

export function proposePackage(draft: RabImportDraft, decisions: DecisionRecord[], base: PackageBase): PackageReviewDto | null {
  if (draft.targetVersionType === 'CONTRACT') return null;
  const latest = latestDecisions(decisions);
  const decided = (rowKey: string, kind: DecisionRecord['kind']) => latest.get(`${rowKey}|${kind}`);
  const blocks = draft.stats.analysisBlocksInSources;
  const sourceHasAnalyses = blocks === undefined ? null : blocks > 0;
  const label = base.version?.label ?? '–';

  const items = draft.rows.filter((r) => r.rowType === 'ITEM');
  // Same evidence as the per-row candidates (D-053, D-067), counted both ways for uniqueness.
  const draftPairs = new Map(base.items.map((b) => [b.workItemId, items.filter((r) => workItemEvidence(r, b)).length]));
  const taken = new Set(items.flatMap((r) => {
    const id = (decided(r.key, 'WORK_ITEM_MATCH')?.value as { workItemId?: string | null } | undefined)?.workItemId;
    return id ? [id] : [];
  }));

  const counts = { fromSource: 0, inherit: 0, match: 0, newItems: 0, problems: 0 };
  const proposals: PackageReviewDto['proposals'] = [];
  for (const row of items) {
    if (row.price.kind === 'ANALYSIS') counts.fromSource++;
    const proposal: PackageReviewDto['proposals'][number] = { rowKey: row.key, description: row.description };
    const counterparts = base.items.filter((b) => workItemEvidence(row, b));

    // Permanent work item: exactly one counterpart, both ways, same unit, not chosen for another row.
    let workItem: BaseItem | undefined;
    const match = decided(row.key, 'WORK_ITEM_MATCH');
    if (match) {
      const id = (match.value as { workItemId: string | null }).workItemId;
      workItem = id ? base.items.find((b) => b.workItemId === id) : undefined;
    } else if (counterparts.length === 0) {
      counts.newItems++;
    } else if (counterparts.length === 1 && draftPairs.get(counterparts[0]!.workItemId) === 1 && same(counterparts[0]!.unit, row.unit) && !taken.has(counterparts[0]!.workItemId)) {
      workItem = counterparts[0]!;
      proposal.workItem = {
        workItemId: workItem.workItemId,
        code: workItem.code,
        reason:
          workItemEvidence(row, workItem) === 'EXACT'
            ? `Satu-satunya pasangan di ${label}: jalur kelompok "${row.groupPath}", uraian dan satuan (${row.unit ?? '–'}) sama → ${workItem.code}.`
            : `Satu-satunya pasangan di ${label}: jalur kelompok "${row.groupPath}", satuan (${row.unit ?? '–'}) dan kode analisa ${workItem.analysisCode} sama; uraian hanya beda tanda baca ("${row.description}" / "${workItem.description}") → ${workItem.code}.`,
      };
    }

    // Analysis inheritance: only when the source has no analyses at all and nothing about the analysis changed.
    const stop = row.price.stoppedAt;
    // Chain ending at a typed value (values-only recap), or a literal RAB price with an explicit NO. ANALISA code.
    const viaValue = row.price.kind === 'UNRESOLVED' && stop !== null && row.price.evidence.at(-1)?.formula === null;
    const literal = row.price.kind === 'DIRECT' && row.analysisCode !== null && row.price.evidence.length === 1;
    // A non-text lookup key (e.g. a sequence number) is no analysis code: no proposal.
    const key = literal || stop?.lookupKey == null ? row.analysisCode : typeof stop.lookupKey === 'string' ? stop.lookupKey : null;
    if (
      sourceHasAnalyses === false &&
      (viaValue || literal) &&
      !decided(row.key, 'ANALYSIS_LINK') &&
      !decided(row.key, 'DIRECT_PRICE') &&
      workItem &&
      key &&
      (!row.analysisCode || same(row.analysisCode, key)) &&
      workItem.analysisCode !== null &&
      same(workItem.analysisCode, key) &&
      row.sourceUnitPrice !== null
    ) {
      const sameCode = [...base.official.values()].filter((a) => a.code !== null && same(a.code, key));
      const a = sameCode.length === 1 ? sameCode[0]! : undefined;
      if (a && same(a.unit, row.unit) && new Decimal(a.price).equals(row.sourceUnitPrice)) {
        proposal.analysis = {
          analysisVersionId: a.analysisVersionId,
          code: a.code,
          reason: `Sumber tanpa analisa; ${literal ? `harga literal ${row.locator.sheet} baris ${row.locator.row} dengan kode NO. ANALISA ${key}` : `rantai harga berhenti di nilai ${stop!.cell} dengan kode ${key}`}. Tepat satu analisa ${a.code} di paket ${label} dengan satuan dan harga ${a.price} sama, dipakai pekerjaan yang sama di ${label}. Disalin ke paket versi ini saat approval.`,
        };
      }
    }
    if (proposal.workItem) counts.match++;
    if (proposal.analysis) counts.inherit++;
    if (proposal.workItem || proposal.analysis) proposals.push(proposal);
  }

  // Rows still blocking if every proposal were confirmed: what remains for explicit review.
  const at = new Date(Math.max(Date.now(), ...decisions.map((d) => d.decidedAt.getTime() + 1)));
  const hypothetical: DecisionRecord[] = proposals.flatMap((p) => [
    ...(p.workItem ? [{ rowKey: p.rowKey, kind: 'WORK_ITEM_MATCH' as const, value: { workItemId: p.workItem.workItemId }, reason: null, decidedBy: '', decidedAt: at }] : []),
    ...(p.analysis ? [{ rowKey: p.rowKey, kind: 'ANALYSIS_LINK' as const, value: { analysisVersionId: p.analysis.analysisVersionId }, reason: null, decidedBy: '', decidedAt: at }] : []),
  ]);
  const after = evaluateImport(draft, [...decisions, ...hypothetical], base.official);
  const itemKeys = new Set(items.map((r) => r.key));
  counts.problems = new Set(after.issues.filter((i) => i.severity === 'BLOCKING' && i.rowKey && itemKeys.has(i.rowKey)).map((i) => i.rowKey)).size;

  // Binds a confirmation to exactly what was shown: base version and every row's kind and target.
  const token = createHash('sha256')
    .update(JSON.stringify([base.version?.id ?? null, proposals.map((p) => [p.rowKey, p.workItem?.workItemId ?? null, p.analysis?.analysisVersionId ?? null])]))
    .digest('hex');
  return { baseVersion: base.version, token, sourceHasAnalyses, counts, proposals };
}
