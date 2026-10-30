import { Decimal } from './decimal.js';

// Daily allocation math (D-075): a week's volume over its project days.
const D = Decimal;
/** Office default factors for Hari 1–7 of a project week (D-011, PRD §15). */
export const DEFAULT_DAILY_FACTORS = ['0.80', '1.20', '1.10', '1.15', '1.00', '0.85', '0.90'] as const;
export const DAILY_VOLUME_SCALE = 4;

/**
 * Volume per day for `factors` (one per day of the week, a short last week passes fewer). Active days have factor > 0;
 * each is rounded HALF_UP to 4 decimals and the last active day takes the rest, so the days add up to `weekVolume` exactly.
 * Null when no day is active.
 */
export function allocateDaily(weekVolume: string, factors: readonly string[]): string[] | null {
  const active = factors.flatMap((f, i) => (new D(f).gt(0) ? [i] : []));
  if (!active.length) return null;
  const total = active.reduce((t, i) => t.plus(factors[i]!), new D(0));
  const out = factors.map(() => '0');
  let rest = new D(weekVolume);
  for (const i of active.slice(0, -1)) {
    // Rounding up on a tiny volume could pass the week total; never let the last day go negative.
    const v = D.min(new D(weekVolume).times(factors[i]!).div(total).toDecimalPlaces(DAILY_VOLUME_SCALE, D.ROUND_HALF_UP), rest);
    out[i] = v.toFixed();
    rest = rest.minus(v);
  }
  out[active.at(-1)!] = rest.toFixed();
  return out;
}
