import { Decimal } from '@laporan-proyek/calc';
import { cellsOf, rowsOf, setCells, type Xlsx } from './workbook-xml';

/** An item row of a progress sheet (M.n / B.n): the input cell holds the cumulative % of the item's volume. */
export type WorkbookItem = { row: number; description: string; volume: string; inputCol: string };

/**
 * Item rows are the rows whose volume-to-date is computed as `+<input>*<volume>/100` (K = R*G/100 in the office
 * workbook); the input column and the volume column come from that formula, so the layout is read, not assumed.
 */
export async function progressItemRows(x: Xlsx, sheet: string): Promise<WorkbookItem[]> {
  const shared = await x.sharedStrings();
  const rows = [...rowsOf(await x.read(sheet))].map(([row, xml]) => ({ row, cells: cellsOf(xml) }));
  // Shared formulas: the master cell carries the text, the others only its id; the pattern is the same per row.
  const pattern = (formula: string, row: number) => new RegExp(`^\\+?([A-Z]+)${row}\\*([A-Z]+)${row}\\/100$`).exec(formula.replace(/\s/g, ''));
  const masters = new Map<string, RegExpExecArray>();
  for (const { row, cells } of rows)
    for (const c of cells) {
      const m = c.formula && c.shared !== null ? pattern(c.formula, row) : null;
      if (m) masters.set(c.shared!, m);
    }
  const out: WorkbookItem[] = [];
  for (const { row, cells } of rows) {
    const calc = cells.map((c) => (c.formula ? pattern(c.formula, row) : c.shared !== null ? (masters.get(c.shared) ?? null) : null)).find(Boolean);
    if (!calc) continue;
    const [, inputCol, volumeCol] = calc;
    const volume = cells.find((c) => c.col === volumeCol)?.value;
    const texts = cells
      .filter((c) => c.value && (c.type === 'str' || c.type === 's' || c.type === 'inlineStr'))
      .map((c) => (c.type === 's' ? (shared[Number(c.value)] ?? '') : c.value!));
    const description = texts.sort((a, b) => b.length - a.length)[0] ?? '';
    if (!volume || !inputCol) continue;
    out.push({ row, description, volume, inputCol });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

/** Same item when the names agree, one is a cut-short form of the other, or the workbook cell has no cached text. */
function similar(workbook: string, app: string): boolean {
  const a = norm(workbook);
  const b = norm(app);
  return a === b || b.startsWith(a) || a.startsWith(b) || a.length <= 4;
}

/**
 * Pairs workbook item rows with the app's baseline items. Both follow the RAB order, so with equal counts they pair
 * by position and the names only confirm it; otherwise they pair by name, duplicates in turn. `unmatched` lists the
 * workbook rows without a partner, so the caller can refuse a workbook that belongs to another RAB.
 */
export function matchItems<T extends { description: string }>(rows: WorkbookItem[], items: T[]): { pairs: [WorkbookItem, T][]; unmatched: WorkbookItem[] } {
  if (rows.length === items.length) {
    const pairs = rows.map((r, i) => [r, items[i]!] as [WorkbookItem, T]);
    const off = pairs.filter(([r, it]) => !similar(r.description, it.description));
    if (off.length <= Math.max(3, rows.length * 0.02)) return { pairs, unmatched: [] };
  }
  const queues = new Map<string, T[]>();
  for (const it of items) (queues.get(norm(it.description)) ?? queues.set(norm(it.description), []).get(norm(it.description))!).push(it);
  const pairs: [WorkbookItem, T][] = [];
  const unmatched: WorkbookItem[] = [];
  for (const r of rows) {
    const it = queues.get(norm(r.description))?.shift();
    if (it) pairs.push([r, it]);
    else unmatched.push(r);
  }
  return { pairs, unmatched };
}

/** Cumulative % = cumulative volume / workbook volume × 100, so the workbook's own K = R×G/100 gives the app's volume back. */
export function cumulativePercent(cumulative: Decimal, volume: string): number | null {
  const v = new Decimal(volume);
  if (v.isZero()) return null;
  return Number(cumulative.div(v).times(100).toSignificantDigits(15).toFixed());
}

/** Writes each week's cumulative % into its progress sheet; returns the weeks written. */
export async function fillProgressSheets(
  x: Xlsx,
  sheets: { week: number; name: string }[],
  pairs: [WorkbookItem, { workItemId: string }][],
  cumulative: (workItemId: string, week: number) => Decimal,
): Promise<void> {
  for (const s of sheets) {
    const values = new Map<string, number | null>();
    for (const [row, item] of pairs) values.set(`${row.inputCol}${row.row}`, cumulativePercent(cumulative(item.workItemId, s.week), row.volume) ?? 0);
    x.write(s.name, setCells(await x.read(s.name), values));
  }
}
