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

/**
 * Excel keeps 15 significant digits of a float; a cached workbook value matches an exact Decimal result
 * when both agree at that precision (157822.49999999997 vs 157822.5).
 */
export function matchesWorkbookValue(exact: DecimalValue, cached: number): boolean {
  if (!Number.isFinite(cached)) return false;
  const c = new Decimal(cached.toPrecision(15));
  const e = new Decimal(exact);
  if (c.isZero() || e.isZero()) return e.abs().lt('1e-9') && c.abs().lt('1e-9');
  return e.toSignificantDigits(15, Decimal.ROUND_HALF_UP).equals(c);
}

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
