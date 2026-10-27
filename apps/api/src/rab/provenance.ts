import { createHash } from 'node:crypto';
import { Decimal } from '@laporan-proyek/calc';
import { correctionsOf, type CorrectionMark } from '@laporan-proyek/shared';
import type { Prisma } from '../generated/prisma/client';

/**
 * D-068 provenance: the original source locator (Excel cell, evidence) stays; each correction is appended to
 * `corrections`, so the UI can tell a manual correction or a recalculation apart from the workbook value.
 */
export function withCorrection(locator: unknown, mark: CorrectionMark): Prisma.InputJsonObject {
  const base = locator && typeof locator === 'object' && !Array.isArray(locator) ? locator : {};
  return { ...base, corrections: [...correctionsOf(locator), mark] } as unknown as Prisma.InputJsonObject;
}

type Scalar = string | number | null;

/** Fields whose value really changes; decimals compare by value ("1.50" = "1.5"). */
export function changedFields(before: Record<string, Scalar>, after: Record<string, Scalar | undefined>): CorrectionMark['changes'] {
  const changes: CorrectionMark['changes'] = {};
  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const prev = before[key] ?? null;
    const same =
      prev === null || next === null
        ? prev === next
        : isDecimal(prev) && isDecimal(next)
          ? new Decimal(prev).equals(next)
          : prev === next;
    if (!same) changes[key] = [prev, next];
  }
  return changes;
}

const isDecimal = (v: Scalar) => (typeof v === 'number' ? true : /^-?\d+(\.\d+)?$/.test(v ?? ''));

/** JSON with object keys sorted at every level: the same payload always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

export const checksumOf = (payload: unknown) => createHash('sha256').update(canonicalJson(payload)).digest('hex');

/** True when the exact value fits a DECIMAL(_, scale) column without rounding. */
export const fitsScale = (value: string, scale: number) => new Decimal(value).decimalPlaces() <= scale;
