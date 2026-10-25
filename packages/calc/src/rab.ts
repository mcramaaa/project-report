import { Decimal, type DecimalValue } from './decimal.js';

// RAB math as in the office workbook (D-043). Inputs/outputs are decimal strings.
// Item values are exact; only the total is rounded (REAL COST) and truncated (DIBULATKAN).
const D = Decimal;
const HUNDRED = new D(100);
/** Weight digits sent to clients; weights are not stored (derived from subtotals). */
const WEIGHT_SCALE = 10;

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
  /** ROUND(value, 2): "REAL COST". */
  realCost: string;
  /** REAL COST truncated to whole rupiah: "DIBULATKAN". */
  rounded: string;
}

/** Exact: price × (1 + tax / 100), as `G + G*H/100` in the workbook. */
export function unitPriceWithTax(unitPrice: string, taxPercent: string): string {
  return new D(unitPrice).times(HUNDRED.plus(taxPercent)).div(HUNDRED).toFixed();
}

export function rabTotals(beforeTax: DecimalValue, value: DecimalValue): RabTotals {
  const v = new D(value);
  const realCost = v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    beforeTax: new D(beforeTax).toFixed(),
    tax: v.minus(beforeTax).toFixed(),
    value: v.toFixed(),
    realCost: realCost.toFixed(2),
    rounded: realCost.toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0),
  };
}

export function calculateRab(rows: RabCalcInput[]): { rows: Map<string, RabRowValues>; totals: RabTotals } {
  const values = new Map<string, RabRowValues>();
  let beforeTax = new D(0);
  let value = new D(0);
  for (const row of rows) {
    const complete = row.rowType === 'ITEM' && row.unitPrice !== null && row.taxPercent !== null;
    const withTax = complete ? unitPriceWithTax(row.unitPrice!, row.taxPercent!) : null;
    if (!complete || row.volume === null) {
      values.set(row.id, { unitPriceWithTax: withTax, subtotalBeforeTax: null, subtotal: null, weight: null });
      continue;
    }
    const itemBeforeTax = new D(row.volume).times(row.unitPrice!);
    const subtotal = new D(row.volume).times(withTax!);
    beforeTax = beforeTax.plus(itemBeforeTax);
    value = value.plus(subtotal);
    values.set(row.id, { unitPriceWithTax: withTax, subtotalBeforeTax: itemBeforeTax.toFixed(), subtotal: subtotal.toFixed(), weight: null });
  }
  aggregateRabGroups(rows, values, value.toFixed());
  return { rows: values, totals: rabTotals(beforeTax, value) };
}

/**
 * Fills group rows (SECTION/SUBSECTION/PARENT_ITEM) with the sums of their descendants and sets every
 * row's weight = subtotal / total × 100 (D-043). Used for drafts and for approved snapshots.
 */
export function aggregateRabGroups(rows: Pick<RabCalcInput, 'id' | 'parentId' | 'rowType'>[], values: Map<string, RabRowValues>, totalValue: string): void {
  assertAcyclic(rows);
  const children = new Map<string | null, string[]>();
  for (const row of rows) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  const types = new Map(rows.map((r) => [r.id, r.rowType]));
  const sum = (id: string): { beforeTax: Decimal; subtotal: Decimal } => {
    if (types.get(id) === 'ITEM') {
      const v = values.get(id);
      return { beforeTax: new D(v?.subtotalBeforeTax ?? 0), subtotal: new D(v?.subtotal ?? 0) };
    }
    const total = { beforeTax: new D(0), subtotal: new D(0) };
    for (const child of children.get(id) ?? []) {
      const c = sum(child);
      total.beforeTax = total.beforeTax.plus(c.beforeTax);
      total.subtotal = total.subtotal.plus(c.subtotal);
    }
    return total;
  };
  const total = new D(totalValue);
  const weight = (subtotal: Decimal) => (total.gt(0) ? subtotal.div(total).times(HUNDRED).toDecimalPlaces(WEIGHT_SCALE).toFixed(WEIGHT_SCALE) : new D(0).toFixed(WEIGHT_SCALE));
  for (const row of rows) {
    if (row.rowType === 'ITEM') {
      const v = values.get(row.id);
      if (v?.subtotal != null) v.weight = weight(new D(v.subtotal));
      continue;
    }
    const a = sum(row.id);
    values.set(row.id, { unitPriceWithTax: null, subtotalBeforeTax: a.beforeTax.toFixed(), subtotal: a.subtotal.toFixed(), weight: weight(a.subtotal) });
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
