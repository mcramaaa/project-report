import { Decimal } from './decimal.js';

// Weekly progress math (D-073). Inputs/outputs are decimal strings; volumes keep 12 decimals.
const D = Decimal;
export const PROGRESS_VOLUME_SCALE = 12;

/** PERCENT_CUMULATIVE → this week's volume = % × baseline ÷ 100 − cumulative before; null when it would be negative. */
export function weeklyVolumeFromPercent(percent: string, baselineVolume: string, previousCumulative: string): string | null {
  const target = new D(percent).times(baselineVolume).div(100).toDecimalPlaces(PROGRESS_VOLUME_SCALE, D.ROUND_HALF_UP);
  const weekly = target.minus(previousCumulative);
  return weekly.isNegative() ? null : weekly.toFixed();
}

export interface ProgressSummary {
  cumulative: string;
  /** Cumulative ÷ baseline × 100; null without a baseline volume. May exceed 100 after a smaller baseline (D-071). */
  percent: string | null;
  /** Baseline − cumulative; negative when over the baseline. */
  remaining: string | null;
}

export function progressSummary(previousCumulative: string, thisWeek: string, baselineVolume: string | null): ProgressSummary {
  const cumulative = new D(previousCumulative).plus(thisWeek);
  if (baselineVolume === null || new D(baselineVolume).lte(0)) return { cumulative: cumulative.toFixed(), percent: null, remaining: null };
  return {
    cumulative: cumulative.toFixed(),
    percent: cumulative.div(baselineVolume).times(100).toFixed(),
    remaining: new D(baselineVolume).minus(cumulative).toFixed(),
  };
}
