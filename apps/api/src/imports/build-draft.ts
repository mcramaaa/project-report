import { calculateAnalysisPrice, compareWithWorkbook, Decimal, findAnalysisCycle } from '@laporan-proyek/calc';
import type {
  AnalysisCandidate,
  DraftAnalysis,
  DraftComponent,
  DraftPrice,
  DraftRow,
  EvidenceStep,
  ImportIssue,
  RabImportDraft,
  RabVersionType,
} from '@laporan-proyek/shared';
import { GUIDE_VERSION } from './guide/rab-import-guide';
import { analysisHeaderIn, blockColumns, BlockError, countAnalysisBlocks, readAnalysisBlock, type AnalysisBlock } from './workbook/analysis-block';
import { formatAddress, type FormulaNode } from './workbook/formula';
import { readRabSheet, rabSheetCandidates, RabSheetError } from './workbook/rab-sheet';
import { isBlocking, traceCell, traceExpression, type TraceResult } from './workbook/trace';
import { excelDecimal, type WorkbookModel } from './workbook/workbook-model';

export const PARSER_VERSION = 'rab-parser@1';

export interface DraftSource {
  model: WorkbookModel;
  documentId: string;
  filename: string;
  sha256: string;
  /** RAB = main RAB/recap document; SUPPORT = analysis/price document without a RAB sheet (D-045). */
  role?: 'RAB' | 'SUPPORT';
  rabSheet?: string;
}

export interface OfficialAnalysis {
  analysisVersionId: string;
  code: string | null;
  name: string;
  unit: string | null;
  price: string;
}

export interface PreviousItem {
  workItemId: string;
  code: string;
  description: string;
  groupPath: string;
}

export interface DraftContext {
  targetVersionType: RabVersionType;
  /** Analyses of the previous approved RAB version's package, for rule candidates on broken chains (D-057). */
  officialAnalyses: OfficialAnalysis[];
  /** Items of the latest approved RAB version, for work item candidates of non-contract imports. */
  previousItems: PreviousItem[];
}

/** Input problems the user fixes by choosing differently (sheet, block); the run becomes FAILED. */
export class DraftInputError extends Error {}

const evidence = (t: TraceResult): EvidenceStep[] =>
  t.steps.map((s) => ({ cell: s.cell, formula: s.formula, value: s.value instanceof Date ? s.value.toISOString() : s.value, via: s.via }));

export const normalizeText = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const sameUnit = (a: string | null, b: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

interface PendingComponent {
  block: AnalysisBlock['components'][number];
  trace: TraceResult;
  source: DraftComponent['source'] | null;
  unitPrice: string | null;
  factor: { op: '*' | '/'; value: string } | null;
  /** Price equals the amount of the component in this row of the same block. */
  amountOfRow?: number;
}

const sameBlockAmount = (block: AnalysisBlock, t: TraceResult) =>
  t.terminal.address.sheet === block.sheet && block.components.some((c) => c.row === t.terminal.address.row && c.priceCell.row === t.terminal.address.row);

/** `<expr> * n`, `<expr> / n`, or `n * <expr>` with a numeric literal n. */
function constantFactor(node: FormulaNode | null): { inner: FormulaNode; op: '*' | '/'; value: string } | null {
  if (!node || node.kind !== 'binary' || (node.op !== '*' && node.op !== '/')) return null;
  if (node.right.kind === 'number') return { inner: node.left, op: node.op, value: String(node.right.value) };
  if (node.op === '*' && node.left.kind === 'number') return { inner: node.right, op: '*', value: String(node.left.value) };
  return null;
}

const applyFactor = (price: string, factor: PendingComponent['factor']) =>
  !factor ? price : factor.op === '*' ? new Decimal(price).times(factor.value).toFixed() : new Decimal(price).div(factor.value).toFixed();

interface PendingAnalysis {
  key: string;
  docIndex: number;
  documentId: string;
  model: WorkbookModel;
  block: AnalysisBlock | null;
  components: PendingComponent[];
  roundings: Set<number | null>;
  usedByRows: Set<string>;
  usedByAnalyses: Set<string>;
}

/**
 * Builds the structured draft (RAB_IMPORT_GUIDE v1): recap rows with their names, analyses proven by
 * formula chains (with sub-analyses), the prices they need, evidence, candidates, and issues. Only what
 * the RAB rows reference becomes part of the draft (D-046); nothing is written to official data here.
 */
export function buildDraft(sources: DraftSource[], ctx: DraftContext): RabImportDraft {
  const issues: ImportIssue[] = [];
  const rows: DraftRow[] = [];
  const analyses = new Map<string, PendingAnalysis>();
  const prices = new Map<string, DraftPrice>();
  const sourceInfo: RabImportDraft['sources'] = [];
  const analysisSheets = new Map<string, { model: WorkbookModel; sheet: string }>();
  let workbookTotals: RabImportDraft['workbookTotals'] = null;

  const supportIndex = new Map<string, { src: DraftSource; docIndex: number; sheet: string; headerRow: number }[]>();
  sources.forEach((src, docIndex) => {
    if (src.role === 'SUPPORT') {
      // No RAB sheet required: index analysis blocks by code; they only become candidates (D-045).
      const sheets: string[] = [];
      for (const sheet of src.model.sheetNames()) {
        let found = false;
        for (let r = 1; r < src.model.rowCount(sheet); r++) {
          const cols = blockColumns(src.model, sheet, r);
          if (!cols || !src.model.formulaOf(src.model.cell(sheet, r, cols.amount))) continue;
          found = true;
          const code = src.model.text(sheet, r, cols.no);
          if (!code) continue;
          const list = supportIndex.get(normalizeText(code)) ?? [];
          list.push({ src, docIndex, sheet, headerRow: r });
          supportIndex.set(normalizeText(code), list);
        }
        if (found) sheets.push(sheet);
      }
      sourceInfo.push({ documentId: src.documentId, filename: src.filename, sha256: src.sha256, role: 'SUPPORT', sheet: null, block: null, analysisSheets: sheets });
      if (sheets.length === 0) issues.push({ code: 'SUPPORT_WITHOUT_ANALYSIS', severity: 'WARNING', message: `${src.filename}: tidak ditemukan blok analisa; dokumen tetap tersimpan sebagai sumber.` });
      return;
    }
    const candidates = rabSheetCandidates(src.model);
    const sheetName = src.rabSheet ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!sheetName) {
      throw new DraftInputError(
        candidates.length === 0
          ? `${src.filename}: tidak ada sheet RAB (header VOLUME dan NO. ANALISA).`
          : `${src.filename}: pilih sheet RAB (${candidates.join(', ')}).`,
      );
    }
    let sheet;
    try {
      sheet = readRabSheet(src.model, sheetName, ctx.targetVersionType);
    } catch (err) {
      if (err instanceof RabSheetError) throw new DraftInputError(`${src.filename}: ${err.message}`);
      throw err;
    }
    sourceInfo.push({ documentId: src.documentId, filename: src.filename, sha256: src.sha256, role: 'RAB', sheet: sheet.sheet, block: sheet.columns.block, analysisSheets: [] });
    if (sheet.totals && sources.filter((x) => x.role !== 'SUPPORT').length === 1) workbookTotals = { value: sheet.totals.value, rounded: sheet.totals.rounded };

    const keyOf = (row: number) => `${docIndex}:${row}`;
    const byRow = new Map(sheet.rows.map((r) => [r.row, r]));
    const pathOf = (parentRow: number | null): string => {
      const parts: string[] = [];
      for (let p = parentRow; p !== null; p = byRow.get(p)?.parentRow ?? null) parts.unshift(byRow.get(p)?.displayNumber ?? '·');
      return parts.join(' › ');
    };

    for (const r of sheet.rows) {
      const key = keyOf(r.row);
      const base: DraftRow = {
        key,
        rowType: r.rowType,
        parentKey: r.parentRow === null ? null : keyOf(r.parentRow),
        displayNumber: r.displayNumber,
        description: r.description,
        groupPath: pathOf(r.parentRow),
        locator: { documentId: src.documentId, sheet: sheet.sheet, row: r.row },
        volume: r.volume,
        unit: r.unit,
        taxPercent: r.taxPercent,
        analysisCode: r.analysisCode,
        sourceUnitPrice: r.sourceUnitPrice,
        price: { kind: 'NONE', analysisKey: null, roundingScale: null, evidence: [], stoppedAt: null },
        analysisCandidates: [],
        workItemCandidates: [],
      };
      if (r.rowType !== 'ITEM') {
        rows.push(base);
        continue;
      }

      const t = traceCell(src.model, r.priceCell.sheet, r.priceCell.row, r.priceCell.col);
      base.price.evidence = evidence(t);
      for (const p of t.problems.filter((x) => !isBlocking(x))) issues.push({ code: 'DUPLICATE_LOOKUP_KEY', severity: 'WARNING', message: p.message, rowKey: key });
      const header = analysisHeaderIn(src.model, t);
      if (header) {
        const analysisKey = `${docIndex}:${header.sheet}:${header.headerRow}`;
        const rounding = t.roundings.length === 0 ? null : t.roundings.length === 1 ? t.roundings[0]! : NaN;
        if (Number.isNaN(rounding)) {
          issues.push({ code: 'ROUNDING_UNSUPPORTED', severity: 'BLOCKING', message: `${r.description}: rantai harga membulatkan lebih dari sekali.`, rowKey: key, resolvedBy: ['DIRECT_PRICE'] });
        }
        base.price = { ...base.price, kind: 'ANALYSIS', analysisKey, roundingScale: Number.isNaN(rounding) ? null : rounding };
        const pending = registerAnalysis(analyses, prices, analysisSheets, issues, src, docIndex, header.sheet, header.headerRow);
        pending.usedByRows.add(key);
        pending.roundings.add(Number.isNaN(rounding) ? null : rounding);
      } else if (t.steps.length === 1 && t.terminalKind === 'VALUE' && r.sourceUnitPrice !== null) {
        base.price.kind = 'DIRECT';
        issues.push({ code: 'DIRECT_PRICE', severity: 'WARNING', message: `${r.description}: harga langsung tanpa analisa (${r.sourceUnitPrice}).`, rowKey: key });
      } else if (r.sourceUnitPrice === null || new Decimal(r.sourceUnitPrice).isZero()) {
        issues.push({ code: 'MISSING_PRICE', severity: 'BLOCKING', message: `${r.description}: item tanpa harga satuan.`, rowKey: key, resolvedBy: ['ANALYSIS_LINK'] });
      } else {
        const lookup = t.lookups.at(-1);
        base.price.kind = 'UNRESOLVED';
        base.price.stoppedAt = { cell: formatAddress(t.terminal.address), value: scalarOf(t.terminal.value), lookupKey: lookup ? scalarOf(lookup.key) : null };
        const why = t.problems.filter(isBlocking).map((p) => p.message).join(' ') || `rantai berhenti di nilai ${formatAddress(t.terminal.address)} tanpa analisa rinci.`;
        issues.push({ code: 'ANALYSIS_UNRESOLVED', severity: 'BLOCKING', message: `${r.description}: ${why}`, rowKey: key, resolvedBy: ['ANALYSIS_LINK', 'DIRECT_PRICE'] });
        base.analysisCandidates = ruleCandidates(ctx.officialAnalyses, base, lookup ? scalarOf(lookup.key) : r.analysisCode);
      }
      if (ctx.targetVersionType !== 'CONTRACT') {
        base.workItemCandidates = ctx.previousItems
          .filter((p) => normalizeText(p.description) === normalizeText(r.description) && p.groupPath === base.groupPath)
          .map((p) => ({ workItemId: p.workItemId, code: p.code, description: p.description, groupPath: p.groupPath }));
        issues.push({
          code: 'WORK_ITEM_UNDECIDED',
          severity: 'BLOCKING',
          message: `${r.description}: tentukan pekerjaan permanen (cocokkan ke versi sebelumnya atau pekerjaan baru).`,
          rowKey: key,
          resolvedBy: ['WORK_ITEM_MATCH'],
        });
      }
      rows.push(base);
    }
  });

  // Supporting-document candidates for rows whose chain did not prove an analysis (incl. external refs).
  const offered = new Map<string, string[]>();
  const usedBeforeCandidates = new Set(analyses.keys());
  for (const row of rows) {
    if (row.price.kind !== 'UNRESOLVED') continue;
    const key = row.price.stoppedAt?.lookupKey ?? row.analysisCode;
    if (typeof key !== 'string') continue;
    for (const hit of supportIndex.get(normalizeText(key)) ?? []) {
      const pending = registerAnalysis(analyses, prices, analysisSheets, issues, hit.src, hit.docIndex, hit.sheet, hit.headerRow);
      offered.set(row.key, [...(offered.get(row.key) ?? []), pending.key]);
    }
  }

  const computed = computeAnalyses(analyses, issues);
  const byKey = new Map(computed.map((a) => [a.key, a]));
  const chosen = new Set<string>();
  for (const row of rows) {
    for (const key of offered.get(row.key) ?? []) {
      const a = byKey.get(key);
      if (!a || !sameUnit(a.unit, row.unit) || row.sourceUnitPrice === null || !new Decimal(a.computed.price).equals(row.sourceUnitPrice)) continue;
      chosen.add(key);
      row.analysisCandidates.push({
        analysisVersionId: null,
        analysisKey: key,
        code: a.code,
        name: a.name,
        unit: a.unit,
        price: a.computed.price,
        reason: `Kode, satuan, dan harga sama dengan analisa di dokumen pendukung (${a.locator.sheet}); relasi lintas file belum terbukti rumus, perlu keputusan reviewer.`,
        origin: 'RULE',
      });
    }
  }
  // Keep analyses used by rows, the chosen candidates, and everything they reference; drop the rest.
  const used = new Set(computed.filter((a) => a.usedByRows.length > 0).map((a) => a.key));
  const keep = new Set<string>();
  const visit = (key: string) => {
    if (keep.has(key)) return;
    keep.add(key);
    for (const c of byKey.get(key)?.components ?? []) if (c.source.kind === 'ANALYSIS') visit(c.source.analysisKey);
  };
  for (const key of [...used, ...chosen]) visit(key);
  const reachableFromUsed = new Set<string>();
  const visitUsed = (key: string) => {
    if (reachableFromUsed.has(key)) return;
    reachableFromUsed.add(key);
    for (const c of byKey.get(key)?.components ?? []) if (c.source.kind === 'ANALYSIS') visitUsed(c.source.analysisKey);
  };
  for (const key of used) visitUsed(key);
  const draftAnalyses = computed.filter((a) => keep.has(a.key)).map((a) => ({ ...a, candidateOnly: !reachableFromUsed.has(a.key) }));
  const priceKeys = new Set(draftAnalyses.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'PRICE_ITEM' ? [c.source.priceKey] : []))));
  for (const k of [...prices.keys()]) if (!priceKeys.has(k)) prices.delete(k);
  // Drop only issues of support candidates that were not offered to any row.
  const keptIssues = issues.filter((i) => !i.analysisKey || usedBeforeCandidates.has(i.analysisKey) || keep.has(i.analysisKey));
  issues.length = 0;
  issues.push(...keptIssues);
  checkRowPrices(rows, draftAnalyses, issues);

  let analysesInWorkbook = 0;
  for (const { model, sheet } of analysisSheets.values()) analysesInWorkbook += countAnalysisBlocks(model, sheet);
  sourceInfo.forEach((info, docIndex) => {
    if (info.role === 'RAB') info.analysisSheets = [...analysisSheets.keys()].filter((k) => k.startsWith(`${docIndex}:`)).map((k) => k.slice(k.indexOf(':') + 1));
  });
  const imported = draftAnalyses.filter((a) => !a.candidateOnly);
  const subKeys = new Set(imported.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'ANALYSIS' ? [c.source.analysisKey] : []))));
  return {
    guideVersion: GUIDE_VERSION,
    parserVersion: PARSER_VERSION,
    targetVersionType: ctx.targetVersionType,
    sources: sourceInfo,
    rows,
    analyses: draftAnalyses,
    prices: [...prices.values()],
    workbookTotals,
    priceMetadata: priceMetadata(sources, [...prices.values()]),
    stats: {
      items: rows.filter((r) => r.rowType === 'ITEM').length,
      analysesInWorkbook,
      analysesImported: imported.length,
      subAnalyses: imported.filter((a) => subKeys.has(a.key)).length,
      components: imported.reduce((n, a) => n + a.components.length, 0),
      pricesImported: new Set(imported.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'PRICE_ITEM' ? [c.source.priceKey] : [])))).size,
    },
    issues,
  };
}

const scalarOf = (v: unknown): string | number | boolean | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : (v as string | number | boolean);

function ruleCandidates(official: OfficialAnalysis[], row: DraftRow, lookupKey: unknown): AnalysisCandidate[] {
  if (typeof lookupKey !== 'string' || row.sourceUnitPrice === null) return [];
  const code = normalizeText(lookupKey);
  return official
    .filter((a) => a.code !== null && normalizeText(a.code) === code && sameUnit(a.unit, row.unit) && new Decimal(a.price).equals(row.sourceUnitPrice!))
    .map((a) => ({
      analysisVersionId: a.analysisVersionId,
      analysisKey: null,
      code: a.code,
      name: a.name,
      unit: a.unit,
      price: a.price,
      reason: 'Kode, satuan, dan harga sama dengan analisa di paket versi RAB sebelumnya (usulan; bila dipilih, analisa disalin ke paket versi ini).',
      origin: 'RULE' as const,
    }));
}

function registerAnalysis(
  analyses: Map<string, PendingAnalysis>,
  prices: Map<string, DraftPrice>,
  analysisSheets: Map<string, { model: WorkbookModel; sheet: string }>,
  issues: ImportIssue[],
  src: DraftSource,
  docIndex: number,
  sheet: string,
  headerRow: number,
): PendingAnalysis {
  const key = `${docIndex}:${sheet}:${headerRow}`;
  const existing = analyses.get(key);
  if (existing) return existing;
  const pending: PendingAnalysis = {
    key,
    docIndex,
    documentId: src.documentId,
    model: src.model,
    block: null,
    components: [],
    roundings: new Set(),
    usedByRows: new Set(),
    usedByAnalyses: new Set(),
  };
  analyses.set(key, pending);
  analysisSheets.set(`${docIndex}:${sheet}`, { model: src.model, sheet });
  try {
    pending.block = readAnalysisBlock(src.model, sheet, headerRow);
  } catch (err) {
    if (!(err instanceof BlockError)) throw err;
    issues.push({ code: 'ANALYSIS_STRUCTURE', severity: 'BLOCKING', message: `Analisa ${sheet}!${headerRow}: ${err.message}.`, analysisKey: key });
    return pending;
  }
  for (const comp of pending.block.components) {
    // A list price scaled by a constant (`VLOOKUP(...)/8`) is evaluated exactly; the factor is evidence.
    const priceCell = src.model.cell(comp.priceCell.sheet, comp.priceCell.row, comp.priceCell.col);
    const scaled = constantFactor(src.model.formulaOf(priceCell));
    const t = scaled ? traceExpression(src.model, priceCell, scaled.inner) : traceCell(src.model, comp.priceCell.sheet, comp.priceCell.row, comp.priceCell.col);
    const pc: PendingComponent = { block: comp, trace: t, source: null, unitPrice: null, factor: scaled ? { op: scaled.op, value: scaled.value } : null };
    if (comp.blankCoefficient) {
      issues.push({ code: 'BLANK_COEFFICIENT', severity: 'WARNING', message: `Analisa ${pending.block.code ?? key}, "${comp.description}": koefisien kosong (Excel menghitung 0).`, analysisKey: key });
    }
    pending.components.push(pc);
    const header = analysisHeaderIn(src.model, t);
    if (header && !(header.sheet === pending.block.sheet && header.headerRow === headerRow)) {
      const sub = registerAnalysis(analyses, prices, analysisSheets, issues, src, docIndex, header.sheet, header.headerRow);
      sub.usedByAnalyses.add(key);
      const rounding = t.roundings[0] ?? null;
      // Only rounded use fixes the sub-analysis rounding; exact use reads its unrounded price.
      if (t.roundings.length) sub.roundings.add(rounding);
      pc.source = { kind: 'ANALYSIS', analysisKey: sub.key, basis: t.roundings.length ? 'ROUNDED' : 'EXACT', roundingScale: rounding };
    } else if (t.steps.length === 1 && !pc.factor && (t.terminalKind === 'VALUE' || t.terminalKind === 'EMPTY')) {
      // Literal price typed in the analysis (blank = 0, as Excel computes it).
      pc.source = { kind: 'LITERAL' };
      pc.unitPrice = excelDecimal(t.terminal.value) ?? '0';
    } else if (t.terminalKind !== 'EMPTY' && t.lookups.length > 0 && t.problems.every((p) => !isBlocking(p))) {
      // Reached through a lookup into a price list; the list may compute its price (e.g. =J274/40).
      if (t.terminalKind === 'FORMULA') {
        issues.push({
          code: 'PRICE_FORMULA',
          severity: 'INFO',
          message: `Harga "${comp.description}" dihitung di daftar harga (${formatAddress(t.terminal.address)} = ${t.terminal.formula}); nilai dipakai apa adanya.`,
          analysisKey: key,
        });
      }
      const lookup = t.lookups.at(-1)!;
      const priceKey = `${docIndex}:${formatAddress(t.terminal.address)}`;
      if (!prices.has(priceKey)) {
        prices.set(priceKey, {
          key: priceKey,
          name: src.model.text(lookup.matchKey.sheet, lookup.matchKey.row, lookup.matchKey.col),
          unit: comp.unit,
          price: excelDecimal(t.terminal.value) ?? '0',
          locator: { documentId: src.documentId, sheet: t.terminal.address.sheet, cell: formatAddress({ ...t.terminal.address, sheet: null }) },
          evidence: evidence(t),
        });
      }
      pc.source = { kind: 'PRICE_ITEM', priceKey, ...(pc.factor ? { factor: pc.factor } : {}) };
      pc.unitPrice = applyFactor(prices.get(priceKey)!.price, pc.factor);
    } else if (t.terminalKind === 'FORMULA' && !pc.factor && t.problems.every((p) => !isBlocking(p)) && sameBlockAmount(pending.block, t)) {
      // Price taken from another component's amount in the same analysis (e.g. accessories = SUM(H384)).
      pc.source = { kind: 'LITERAL' };
      pc.amountOfRow = t.terminal.address.row;
      issues.push({
        code: 'PRICE_FROM_COMPONENT',
        severity: 'INFO',
        message: `Analisa ${pending.block.code ?? key}, "${comp.description}": harga = nilai komponen baris ${t.terminal.address.row} (${formatAddress(priceCell.address)} = ${priceCell.formula}).`,
        analysisKey: key,
      });
    } else {
      const why =
        t.problems.filter(isBlocking).map((p) => p.message).join(' ') ||
        `harga tidak dapat ditelusuri ke daftar harga atau analisa (berhenti di ${formatAddress(t.terminal.address)}${t.terminal.formula ? ` = ${t.terminal.formula}` : ''}).`;
      issues.push({ code: 'COMPONENT_PRICE_UNTRACEABLE', severity: 'BLOCKING', message: `Analisa ${pending.block.code ?? key}, komponen "${comp.description}": ${why}`, analysisKey: key });
    }
  }
  return pending;
}

function computeAnalyses(pending: Map<string, PendingAnalysis>, issues: ImportIssue[]): DraftAnalysis[] {
  const edges = new Map([...pending.values()].map((a) => [a.key, a.components.flatMap((c) => (c.source?.kind === 'ANALYSIS' ? [c.source.analysisKey] : []))]));
  const cycle = findAnalysisCycle(edges);
  if (cycle) {
    issues.push({ code: 'ANALYSIS_CYCLE', severity: 'BLOCKING', message: `Analisa saling merujuk: ${cycle.join(' → ')}.`, analysisKey: cycle[0] });
    return [];
  }

  const done = new Map<string, DraftAnalysis>();
  const compute = (a: PendingAnalysis): DraftAnalysis | null => {
    if (done.has(a.key)) return done.get(a.key)!;
    if (!a.block) return null;
    const scales = [...a.roundings];
    const roundingScale = scales.length === 1 ? scales[0]! : null;
    if (new Set(scales.map(String)).size > 1) {
      issues.push({ code: 'ROUNDING_CONFLICT', severity: 'BLOCKING', message: `Analisa ${a.block.code ?? a.key} dipakai dengan pembulatan berbeda (${scales.join(', ')}).`, analysisKey: a.key });
    }
    const label = a.block.code ?? a.key;
    // Every cached-Excel comparison is kept as review evidence (D-054), not only the failures.
    const entries: DraftAnalysis['reconciliation'] = [];
    const check = (what: string, exact: string, cached: number) => {
      const cmp = compareWithWorkbook(exact, cached);
      entries.push({ what, ...cmp });
      if (!cmp.matches) {
        issues.push({
          code: 'RECONCILIATION',
          severity: 'BLOCKING',
          message: `Analisa ${label}, ${what}: aplikasi ${cmp.exact} ≠ workbook ${cmp.cached} (selisih ${cmp.diff} > toleransi ${cmp.tolerance}).`,
          analysisKey: a.key,
        });
      }
    };
    const components: DraftComponent[] = [];
    for (const c of a.components) {
      let unitPrice = c.unitPrice;
      if (c.source?.kind === 'ANALYSIS') {
        const sub = compute(pending.get(c.source.analysisKey)!);
        if (!sub) {
          issues.push({ code: 'SUB_ANALYSIS_INVALID', severity: 'BLOCKING', message: `Analisa ${a.block.code ?? a.key}: subanalisa ${c.source.analysisKey} tidak terbaca.`, analysisKey: a.key });
          continue;
        }
        unitPrice =
          c.source.basis === 'EXACT' ? sub.computed.priceExact : new Decimal(sub.computed.priceExact).toDecimalPlaces(c.source.roundingScale ?? 0, Decimal.ROUND_HALF_UP).toFixed();
        const cached = c.trace.steps[0]!.value;
        if (typeof cached === 'number') check(`harga subanalisa "${c.block.description}"`, unitPrice, cached);
      }
      if (c.amountOfRow !== undefined) {
        const ref = components.find((x) => x.locator.row === c.amountOfRow);
        unitPrice = ref ? ref.amount : null;
        if (!ref) issues.push({ code: 'COMPONENT_PRICE_UNTRACEABLE', severity: 'BLOCKING', message: `Analisa ${a.block.code}: "${c.block.description}" merujuk komponen yang belum terhitung.`, analysisKey: a.key });
      }
      if (!c.source || unitPrice === null) continue;
      components.push({
        category: c.block.category,
        description: c.block.description,
        unit: c.block.unit,
        coefficient: c.block.coefficient,
        unitPrice,
        sourceAmount: c.block.sourceAmount,
        amount: new Decimal(c.block.coefficient).times(unitPrice).toFixed(),
        source: c.source,
        locator: { documentId: a.documentId, sheet: a.block.sheet, row: c.block.row },
        evidence: evidence(c.trace),
      });
    }
    const computed = calculateAnalysisPrice(components, { overheadPercent: a.block.overheadPercent, roundingScale });
    components.forEach((c, i) => {
      const raw = a.components.find((p) => p.block.row === c.locator.row)?.block.sourceAmountRaw;
      if (raw !== null && raw !== undefined) check(`nilai "${c.description}"`, computed.componentAmounts[i]!, raw);
    });
    if (a.block.sourceDirectCostRaw !== null) check('biaya langsung', computed.directCost, a.block.sourceDirectCostRaw);
    if (a.block.sourcePriceExactRaw !== null) check('harga eksak', computed.priceExact, a.block.sourcePriceExactRaw);
    const result: DraftAnalysis = {
      key: a.key,
      code: a.block.code,
      name: a.block.name,
      unit: a.block.unit,
      discipline: null,
      locator: { documentId: a.documentId, sheet: a.block.sheet, row: a.block.headerRow, cell: a.block.priceCell.replace(/^.*!/, '') },
      overheadPercent: a.block.overheadPercent,
      roundingScale,
      computed: { directCost: computed.directCost, overheadAmount: computed.overheadAmount, priceExact: computed.priceExact, price: computed.price },
      source: { directCost: a.block.sourceDirectCost, priceExact: a.block.sourcePriceExact },
      components,
      usedByRows: [...a.usedByRows],
      usedByAnalyses: [...a.usedByAnalyses],
      candidateOnly: false,
      reconciliation: entries,
    };
    done.set(a.key, result);
    return result;
  };
  return [...pending.values()].map(compute).filter((a): a is DraftAnalysis => a !== null);
}

/** RAB price vs analysis price (D-051): differences and prices beyond 2 decimals need a reviewer choice. */
function checkRowPrices(rows: DraftRow[], analyses: DraftAnalysis[], issues: ImportIssue[]): void {
  const byKey = new Map(analyses.map((a) => [a.key, a]));
  for (const row of rows) {
    if (row.price.kind !== 'ANALYSIS' || !row.price.analysisKey) continue;
    const a = byKey.get(row.price.analysisKey);
    if (!a) {
      issues.push({ code: 'ANALYSIS_INVALID', severity: 'BLOCKING', message: `${row.description}: analisa tidak dapat dibaca.`, rowKey: row.key, resolvedBy: ['DIRECT_PRICE'] });
      continue;
    }
    if (row.sourceUnitPrice === null || !new Decimal(a.computed.price).equals(row.sourceUnitPrice)) {
      issues.push({
        code: 'PRICE_MISMATCH',
        severity: 'BLOCKING',
        message: `${row.description}: harga analisa ${a.computed.price} ≠ harga RAB ${row.sourceUnitPrice ?? '–'}.`,
        rowKey: row.key,
        resolvedBy: ['PRICE_CHOICE'],
      });
    } else if (new Decimal(a.computed.price).decimalPlaces() > 2) {
      issues.push({ code: 'PRICE_SCALE', severity: 'BLOCKING', message: `${row.description}: harga analisa ${a.computed.price} lebih dari 2 desimal.`, rowKey: row.key, resolvedBy: ['PRICE_CHOICE'] });
    }
  }
}

/** "Lokasi : Denpasar" / "Tahun : 2026" in the first rows of the price sheets actually used. */
function priceMetadata(sources: DraftSource[], used: DraftPrice[]): { location: string | null; period: string | null } {
  const found = { location: null as string | null, period: null as string | null };
  const seen = new Set<string>();
  for (const p of used) {
    const src = sources.find((x) => x.documentId === p.locator.documentId);
    const id = `${p.locator.documentId}|${p.locator.sheet}`;
    if (!src || seen.has(id)) continue;
    seen.add(id);
    for (let r = 1; r <= 12; r++) {
      for (let c = 1; c <= 8; c++) {
        const label = src.model.text(p.locator.sheet, r, c).toUpperCase();
        const field = label === 'LOKASI' ? 'location' : label === 'TAHUN' ? 'period' : null;
        if (!field || found[field]) continue;
        for (let k = c + 1; k <= c + 6; k++) {
          const v = src.model.text(p.locator.sheet, r, k).replace(/^:\s*/, '');
          if (v && v !== ':') {
            found[field] = v.slice(0, 100);
            break;
          }
        }
      }
    }
  }
  return found;
}
