import { Decimal } from '@laporan-proyek/calc';
import type { DraftRow } from '@laporan-proyek/shared';

export type SourcePriceFormula = NonNullable<DraftRow['sourcePriceFormula']>;

/** Excel rounding of the formula: ROUNDDOWN/ROUNDUP go toward/away from zero, ROUND is half away from zero. */
const MODE = { DOWN: Decimal.ROUND_DOWN, UP: Decimal.ROUND_UP, NEAREST: Decimal.ROUND_HALF_UP } as const;

/** The source price the formula gives for `base` (decimal-safe): base × factor, then the formula's rounding. */
export function applySourceFormula(base: string, f: SourcePriceFormula): string {
  let price = new Decimal(base);
  for (const r of f.preRoundings ?? []) price = price.toDecimalPlaces(r.scale, MODE[r.mode]);
  const product = price.times(f.factor);
  return f.rounding === null || f.scale === null ? product.toFixed() : product.toDecimalPlaces(f.scale, MODE[f.rounding]).toFixed();
}

/** The analysis price explains the source price through the formula (D-092). */
export function formulaMatches(analysisPrice: string, sourcePrice: string | null, f: SourcePriceFormula | undefined): boolean {
  return !!f && sourcePrice !== null && new Decimal(applySourceFormula(analysisPrice, f)).equals(sourcePrice);
}

/** Price note stored on the RAB item when the source price is kept through the formula. */
export function formulaNote(f: SourcePriceFormula): string {
  const name = (m: 'DOWN' | 'UP' | 'NEAREST' | null) => (m === 'DOWN' ? 'ROUNDDOWN' : m === 'UP' ? 'ROUNDUP' : m === 'NEAREST' ? 'ROUND' : null);
  const fn = name(f.rounding);
  let base = 'harga analisa';
  for (const r of f.preRoundings ?? []) base = `${name(r.mode)}(${base}; ${r.scale})`;
  const expr = `${base} × ${f.factor.replace('.', ',')}`;
  return `Harga sumber = ${fn ? `${fn}(${expr}; ${f.scale})` : expr} (${f.baseCell} → kolom harga, D-092).`;
}
