import { Decimal } from './decimal.js';

// D-079 butir 4: material/equipment needs of a day's work from AHSP coefficients.
const D = Decimal;
export type ResourceCategory = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

export interface AhspComponentNode {
  category: ResourceCategory;
  /** Price item id, or "description|unit" for components typed in the analysis. */
  key: string;
  name: string;
  unit: string | null;
  coefficient: string;
  /** Set when the component is another analysis; its own components are counted instead. */
  subAnalysisId: string | null;
}

export interface ResourceNeed {
  category: ResourceCategory;
  key: string;
  name: string;
  unit: string | null;
  quantity: string;
}

/** Sub-analyses nest a few levels at most in the office workbooks; deeper means a cycle. */
const MAX_DEPTH = 8;

/**
 * Σ volume × coefficient per resource for `categories`, expanding sub-analyses (coefficients multiply down the chain).
 * Work without an analysis contributes nothing. Order: first appearance.
 */
export function resourceNeeds(
  work: { analysisId: string | null; volume: string }[],
  analyses: Map<string, AhspComponentNode[]>,
  categories: ResourceCategory[],
): ResourceNeed[] {
  const totals = new Map<string, { node: AhspComponentNode; quantity: Decimal }>();
  const expand = (analysisId: string, quantity: Decimal, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error(`Analisa ${analysisId} bersarang lebih dari ${MAX_DEPTH} tingkat (siklus?).`);
    for (const c of analyses.get(analysisId) ?? []) {
      const q = quantity.times(c.coefficient);
      if (c.subAnalysisId) {
        expand(c.subAnalysisId, q, depth + 1);
        continue;
      }
      if (!categories.includes(c.category)) continue;
      const k = `${c.category}:${c.key}`;
      const t = totals.get(k);
      if (t) t.quantity = t.quantity.plus(q);
      else totals.set(k, { node: c, quantity: q });
    }
  };
  for (const w of work) if (w.analysisId && new D(w.volume).gt(0)) expand(w.analysisId, new D(w.volume), 0);
  return [...totals.values()].map(({ node, quantity }) => ({
    category: node.category,
    key: node.key,
    name: node.name,
    unit: node.unit,
    quantity: quantity.toDecimalPlaces(12, D.ROUND_HALF_UP).toFixed(),
  }));
}
