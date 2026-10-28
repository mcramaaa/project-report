import { Decimal, type DecimalValue } from './decimal.js';

// Analysis unit price as in the office workbook (D-051). Inputs/outputs are decimal strings.
const HUNDRED = new Decimal(100);

export interface AhspComponentInput {
  coefficient: string;
  unitPrice: string;
}

export interface AhspPrice {
  /** coefficient × unit price per component, exact. */
  componentAmounts: string[];
  /** D = Σ component amounts. */
  directCost: string;
  /** E = overhead % × D; "0" without overhead. */
  overheadAmount: string;
  /** F = D + E, exact. */
  priceExact: string;
  /** F rounded HALF_UP to the source's scale; equal to F when the source does not round. */
  price: string;
}

export function componentAmount(coefficient: DecimalValue, unitPrice: DecimalValue): string {
  return new Decimal(coefficient).times(unitPrice).toFixed();
}

export function calculateAnalysisPrice(
  components: AhspComponentInput[],
  options: { overheadPercent: string | null; roundingScale: number | null },
): AhspPrice {
  const componentAmounts = components.map((c) => componentAmount(c.coefficient, c.unitPrice));
  return { componentAmounts, ...analysisTotals(componentAmounts, options) };
}

/** D-054: one absolute bound for reconciling cached Excel floats (Rp 0.000001); never changes app values. */
export const WORKBOOK_TOLERANCE = '0.000001';
export const WORKBOOK_TOLERANCE_RULE = 'ABS_0.000001';

export interface WorkbookComparison {
  exact: string;
  cached: string;
  diff: string;
  tolerance: string;
  rule: string;
  matches: boolean;
}

/**
 * Compares an exact Decimal result with a cached workbook float (Excel computes in binary floating point,
 * so tiny differences are float noise). Returns the evidence a reviewer sees: values, difference, tolerance.
 * A Decimal reference (e.g. Σ of cached item amounts, added exactly) is compared as is.
 */
export function compareWithWorkbook(exact: DecimalValue, cached: number | Decimal): WorkbookComparison {
  const e = new Decimal(exact);
  const c = typeof cached !== 'number' ? cached : Number.isFinite(cached) ? new Decimal(cached.toPrecision(17)) : null;
  const diff = c ? e.minus(c).abs() : null;
  return {
    exact: e.toFixed(),
    cached: c ? c.toFixed() : String(cached),
    diff: diff ? diff.toFixed() : 'NaN',
    tolerance: WORKBOOK_TOLERANCE,
    rule: WORKBOOK_TOLERANCE_RULE,
    matches: diff !== null && diff.lte(WORKBOOK_TOLERANCE),
  };
}

export const matchesWorkbookValue = (exact: DecimalValue, cached: number): boolean =>
  compareWithWorkbook(exact, cached).matches;

/** Depth-first cycle check over analysis -> sub-analysis edges; returns the cycle path or null. */
export function findAnalysisCycle(edges: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'visiting') return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/** Constant conversion of a list price used by a component (`VLOOKUP(...)/8`), kept as source evidence. */
export interface PriceFactor {
  op: '*' | '/';
  value: string;
}

export const applyPriceFactor = (price: DecimalValue, factor: PriceFactor | null): string =>
  !factor
    ? new Decimal(price).toFixed()
    : factor.op === '*'
      ? new Decimal(price).times(factor.value).toFixed()
      : new Decimal(price).div(factor.value).toFixed();

export interface PackageComponent {
  id: string;
  analysisVersionId: string;
  coefficient: string;
  unitPrice: string;
  amount: string;
  priceItemId: string | null;
  factor: PriceFactor | null;
  subAnalysisVersionId: string | null;
  subPriceBasis: 'EXACT' | 'ROUNDED' | null;
}

export interface PackageAnalysis {
  id: string;
  overheadPercent: string | null;
  roundingScale: number | null;
  directCost: string;
  overheadAmount: string;
  priceExact: string;
  price: string;
}

export interface AnalysisPackage {
  prices: { id: string; price: string }[];
  analyses: PackageAnalysis[];
  components: PackageComponent[];
}

/** One source input edit (D-068); derived values are never edited directly. */
export type PackageEdit =
  | { kind: 'PRICE_ITEM'; priceItemId: string; price: string }
  | { kind: 'COMPONENT'; componentId: string; coefficient?: string; unitPrice?: string; factor?: PriceFactor | null }
  | { kind: 'ANALYSIS'; analysisVersionId: string; overheadPercent?: string | null; roundingScale?: number | null };

export interface PackageRecalculation {
  /** Only rows whose stored values change; unchanged rows keep their stored (source) precision. */
  components: Map<string, { coefficient: string; unitPrice: string; amount: string }>;
  analyses: Map<string, Omit<PackageAnalysis, 'id'>>;
}

/**
 * Applies one source edit inside one package and recalculates only what depends on it:
 * price → components (with their factor) → analysis → components using it as sub-analysis (EXACT/ROUNDED) → ….
 * Untouched components keep their stored amounts. Throws RangeError on a cycle or a relation outside the package.
 */
export function recalculatePackage(pkg: AnalysisPackage, edit: PackageEdit): PackageRecalculation {
  const prices = new Map(pkg.prices.map((p) => [p.id, p.price]));
  const analyses = new Map(pkg.analyses.map((a) => [a.id, { ...a }]));
  const components = new Map(pkg.components.map((c) => [c.id, { ...c }]));
  const edges = new Map<string, string[]>([...analyses.keys()].map((id) => [id, []]));
  for (const c of components.values()) {
    if (!analyses.has(c.analysisVersionId)) throw new RangeError(`Komponen ${c.id} di luar paket.`);
    if (c.priceItemId && !prices.has(c.priceItemId)) throw new RangeError(`Harga komponen ${c.id} di luar paket.`);
    if (c.subAnalysisVersionId) {
      if (!analyses.has(c.subAnalysisVersionId)) throw new RangeError(`Subanalisa komponen ${c.id} di luar paket.`);
      edges.get(c.analysisVersionId)!.push(c.subAnalysisVersionId);
    }
  }
  const cycle = findAnalysisCycle(edges);
  if (cycle) throw new RangeError(`Rantai subanalisa bersiklus: ${cycle.join(' → ')}.`);

  const changedComponents = new Set<string>();
  const dirty = new Set<string>();
  const setComponent = (c: PackageComponent, unitPrice: string, coefficient = c.coefficient) => {
    if (new Decimal(unitPrice).equals(c.unitPrice) && new Decimal(coefficient).equals(c.coefficient)) return;
    c.unitPrice = unitPrice;
    c.coefficient = coefficient;
    c.amount = componentAmount(coefficient, unitPrice);
    changedComponents.add(c.id);
    dirty.add(c.analysisVersionId);
  };

  if (edit.kind === 'PRICE_ITEM') {
    if (!prices.has(edit.priceItemId)) throw new RangeError('Harga dasar tidak ada di paket ini.');
    for (const c of components.values())
      if (c.priceItemId === edit.priceItemId) setComponent(c, applyPriceFactor(edit.price, c.factor));
  } else if (edit.kind === 'COMPONENT') {
    const c = components.get(edit.componentId);
    if (!c) throw new RangeError('Komponen tidak ada di paket ini.');
    if (edit.unitPrice !== undefined && (c.priceItemId || c.subAnalysisVersionId))
      throw new RangeError('Harga komponen ini mengikuti harga dasar/subanalisa; koreksi sumbernya.');
    let unitPrice = edit.unitPrice ?? c.unitPrice;
    if (edit.factor !== undefined) {
      // The conversion re-derives the price from its source: base price or sub-analysis price, then the factor.
      const sub = c.subAnalysisVersionId ? analyses.get(c.subAnalysisVersionId)! : null;
      const base = c.priceItemId ? prices.get(c.priceItemId)! : sub ? (c.subPriceBasis === 'EXACT' ? sub.priceExact : sub.price) : null;
      if (base === null) throw new RangeError('Faktor konversi hanya untuk komponen yang memakai harga dasar atau subanalisa.');
      c.factor = edit.factor;
      unitPrice = applyPriceFactor(base, edit.factor);
    }
    setComponent(c, unitPrice, edit.coefficient ?? c.coefficient);
  } else {
    const a = analyses.get(edit.analysisVersionId);
    if (!a) throw new RangeError('Analisa tidak ada di paket ini.');
    if (edit.overheadPercent !== undefined) a.overheadPercent = edit.overheadPercent;
    if (edit.roundingScale !== undefined) a.roundingScale = edit.roundingScale;
    dirty.add(a.id);
  }

  const byAnalysis = new Map<string, PackageComponent[]>();
  for (const c of components.values())
    byAnalysis.set(c.analysisVersionId, [...(byAnalysis.get(c.analysisVersionId) ?? []), c]);
  // Acyclic, so the worklist ends; an analysis may be recalculated more than once before it settles.
  while (dirty.size) {
    const id = dirty.values().next().value!;
    dirty.delete(id);
    const a = analyses.get(id)!;
    const totals = analysisTotals(
      (byAnalysis.get(id) ?? []).map((c) => c.amount),
      { overheadPercent: a.overheadPercent, roundingScale: a.roundingScale },
    );
    const before = { ...a };
    Object.assign(a, totals);
    if (new Decimal(before.price).equals(a.price) && new Decimal(before.priceExact).equals(a.priceExact)) continue;
    for (const c of components.values())
      if (c.subAnalysisVersionId === id)
        setComponent(c, applyPriceFactor(c.subPriceBasis === 'EXACT' ? a.priceExact : a.price, c.factor));
  }
  const same = (x: string | null, y: string | null) => (x === null || y === null ? x === y : new Decimal(x).equals(y));
  const changedAnalyses = pkg.analyses
    .filter((o) => {
      const a = analyses.get(o.id)!;
      return (
        a.roundingScale !== o.roundingScale ||
        !same(a.overheadPercent, o.overheadPercent) ||
        (['directCost', 'overheadAmount', 'priceExact', 'price'] as const).some((k) => !same(a[k], o[k]))
      );
    })
    .map((o) => o.id);
  return {
    components: new Map(
      [...changedComponents].map((id) => {
        const c = components.get(id)!;
        return [id, { coefficient: c.coefficient, unitPrice: c.unitPrice, amount: c.amount }];
      }),
    ),
    analyses: new Map(
      changedAnalyses.map((id) => {
        const a = analyses.get(id)!;
        return [
          id,
          {
            overheadPercent: a.overheadPercent,
            roundingScale: a.roundingScale,
            directCost: a.directCost,
            overheadAmount: a.overheadAmount,
            priceExact: a.priceExact,
            price: a.price,
          },
        ];
      }),
    ),
  };
}

/** D, E, F and the used price from component amounts, as `calculateAnalysisPrice` does. */
export function analysisTotals(
  amounts: string[],
  options: { overheadPercent: string | null; roundingScale: number | null },
): Omit<AhspPrice, 'componentAmounts'> {
  const direct = amounts.reduce((sum, a) => sum.plus(a), new Decimal(0));
  const overhead =
    options.overheadPercent === null ? new Decimal(0) : direct.times(options.overheadPercent).div(HUNDRED);
  const exact = direct.plus(overhead);
  const price =
    options.roundingScale === null ? exact : exact.toDecimalPlaces(options.roundingScale, Decimal.ROUND_HALF_UP);
  return { directCost: direct.toFixed(), overheadAmount: overhead.toFixed(), priceExact: exact.toFixed(), price: price.toFixed() };
}

/** Worksheet group subtotals; sums exact stored amounts without display rounding. */
export function analysisCategoryTotals(
  components: { category: 'LABOR' | 'MATERIAL' | 'EQUIPMENT'; amount: string }[],
): Record<'LABOR' | 'MATERIAL' | 'EQUIPMENT', string> {
  const totals = { LABOR: new Decimal(0), MATERIAL: new Decimal(0), EQUIPMENT: new Decimal(0) };
  for (const c of components) totals[c.category] = totals[c.category].plus(c.amount);
  return {
    LABOR: totals.LABOR.toFixed(),
    MATERIAL: totals.MATERIAL.toFixed(),
    EQUIPMENT: totals.EQUIPMENT.toFixed(),
  };
}
