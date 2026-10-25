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
  const amounts = components.map((c) => new Decimal(c.coefficient).times(c.unitPrice));
  const direct = amounts.reduce((sum, a) => sum.plus(a), new Decimal(0));
  const overhead = options.overheadPercent === null ? new Decimal(0) : direct.times(options.overheadPercent).div(HUNDRED);
  const exact = direct.plus(overhead);
  const price = options.roundingScale === null ? exact : exact.toDecimalPlaces(options.roundingScale, Decimal.ROUND_HALF_UP);
  return {
    componentAmounts: amounts.map((a) => a.toFixed()),
    directCost: direct.toFixed(),
    overheadAmount: overhead.toFixed(),
    priceExact: exact.toFixed(),
    price: price.toFixed(),
  };
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
 */
export function compareWithWorkbook(exact: DecimalValue, cached: number): WorkbookComparison {
  const e = new Decimal(exact);
  const c = Number.isFinite(cached) ? new Decimal(cached.toPrecision(17)) : null;
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

export const matchesWorkbookValue = (exact: DecimalValue, cached: number): boolean => compareWithWorkbook(exact, cached).matches;

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
