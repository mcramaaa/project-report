import { Decimal } from 'decimal.js';

// RAB math (D-042, provisional until OD-009). Inputs/outputs are decimal strings.
// Default decimal.js precision (20 significant digits) is too small for DECIMAL(18,4) × DECIMAL(20,2).
const D = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_UP });
const MONEY = 2;
const WEIGHT = 6;
const HUNDRED = new D(100);

export type RabRowType = 'SECTION' | 'SUBSECTION' | 'PARENT_ITEM' | 'ITEM';

export interface RabCalcInput {
  id: string;
  parentId: string | null;
  rowType: RabRowType;
  volume: string | null;
  unitPrice: string | null;
  taxPercent: string | null;
}

export interface RabRowValues {
  /** ITEM only; null while price or tax is missing. */
  unitPriceWithTax: string | null;
  /** ITEM: own amount; other rows: sum of their descendants. null for an incomplete ITEM. */
  subtotalBeforeTax: string | null;
  subtotal: string | null;
  weight: string | null;
}

export interface RabTotals {
  beforeTax: string;
  tax: string;
  value: string;
}

export function unitPriceWithTax(unitPrice: string, taxPercent: string): string {
  return new D(unitPrice).times(HUNDRED.plus(taxPercent)).div(HUNDRED).toDecimalPlaces(MONEY).toFixed(MONEY);
}

export function calculateRab(rows: RabCalcInput[]): { rows: Map<string, RabRowValues>; totals: RabTotals } {
  const values = new Map<string, RabRowValues>();
  const items: { id: string; beforeTax: Decimal; subtotal: Decimal }[] = [];

  for (const row of rows) {
    if (row.rowType !== 'ITEM' || row.unitPrice === null || row.taxPercent === null || row.volume === null) {
      const withTax = row.rowType === 'ITEM' && row.unitPrice !== null && row.taxPercent !== null ? unitPriceWithTax(row.unitPrice, row.taxPercent) : null;
      values.set(row.id, { unitPriceWithTax: withTax, subtotalBeforeTax: null, subtotal: null, weight: null });
      continue;
    }
    const withTax = unitPriceWithTax(row.unitPrice, row.taxPercent);
    const beforeTax = new D(row.volume).times(row.unitPrice).toDecimalPlaces(MONEY);
    const subtotal = new D(row.volume).times(withTax).toDecimalPlaces(MONEY);
    items.push({ id: row.id, beforeTax, subtotal });
    values.set(row.id, { unitPriceWithTax: withTax, subtotalBeforeTax: beforeTax.toFixed(MONEY), subtotal: subtotal.toFixed(MONEY), weight: null });
  }

  const beforeTax = items.reduce((sum, i) => sum.plus(i.beforeTax), new D(0));
  const value = items.reduce((sum, i) => sum.plus(i.subtotal), new D(0));

  // Weights: 6 decimals; the rounding remainder goes to the largest amount (first on ties) so they total exactly 100.
  const weights = new Map<string, Decimal>();
  if (value.gt(0)) {
    for (const i of items) weights.set(i.id, i.subtotal.div(value).times(HUNDRED).toDecimalPlaces(WEIGHT));
    const largest = items.reduce((best, i) => (i.subtotal.gt(best.subtotal) ? i : best));
    const remainder = HUNDRED.minus([...weights.values()].reduce((sum, w) => sum.plus(w), new D(0)));
    weights.set(largest.id, weights.get(largest.id)!.plus(remainder));
  } else {
    for (const i of items) weights.set(i.id, new D(0));
  }
  for (const [id, weight] of weights) values.get(id)!.weight = weight.toFixed(WEIGHT);

  aggregateRabGroups(rows, values);

  return { rows: values, totals: { beforeTax: beforeTax.toFixed(MONEY), tax: value.minus(beforeTax).toFixed(MONEY), value: value.toFixed(MONEY) } };
}

/**
 * Fills group rows (SECTION/SUBSECTION/PARENT_ITEM) with the sums of their descendants' item values.
 * Used for drafts (after calculateRab) and for approved versions (stored snapshot values).
 */
export function aggregateRabGroups(rows: Pick<RabCalcInput, 'id' | 'parentId' | 'rowType'>[], values: Map<string, RabRowValues>): void {
  const children = new Map<string | null, string[]>();
  for (const row of rows) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  const types = new Map(rows.map((r) => [r.id, r.rowType]));
  assertAcyclic(rows);
  const sum = (id: string): { beforeTax: Decimal; subtotal: Decimal; weight: Decimal } => {
    if (types.get(id) === 'ITEM') {
      const v = values.get(id);
      return { beforeTax: new D(v?.subtotalBeforeTax ?? 0), subtotal: new D(v?.subtotal ?? 0), weight: new D(v?.weight ?? 0) };
    }
    const total = { beforeTax: new D(0), subtotal: new D(0), weight: new D(0) };
    for (const child of children.get(id) ?? []) {
      const c = sum(child);
      total.beforeTax = total.beforeTax.plus(c.beforeTax);
      total.subtotal = total.subtotal.plus(c.subtotal);
      total.weight = total.weight.plus(c.weight);
    }
    return total;
  };
  for (const row of rows) {
    if (row.rowType === 'ITEM') continue;
    const a = sum(row.id);
    values.set(row.id, { unitPriceWithTax: null, subtotalBeforeTax: a.beforeTax.toFixed(MONEY), subtotal: a.subtotal.toFixed(MONEY), weight: a.weight.toFixed(WEIGHT) });
  }
}

/** Rejects parent cycles (A → B → A, self-parent) with a clear error instead of unbounded recursion. */
export function assertAcyclic(rows: Pick<RabCalcInput, 'id' | 'parentId'>[]): void {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const safe = new Set<string>();
  for (const row of rows) {
    const path = new Set<string>();
    for (let id: string | null = row.id; id !== null && !safe.has(id); id = parentOf.get(id) ?? null) {
      if (path.has(id)) throw new RangeError(`Hierarki RAB bersiklus pada baris ${id}.`);
      path.add(id);
    }
    for (const id of path) safe.add(id);
  }
}
