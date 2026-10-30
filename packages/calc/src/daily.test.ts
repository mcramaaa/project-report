import { describe, expect, it } from 'vitest';
import { Decimal, DEFAULT_DAILY_FACTORS, allocateDaily } from './index.js';

const sum = (v: string[]) => v.reduce((t, x) => t.plus(x), new Decimal(0)).toFixed();

describe('allocateDaily (D-075)', () => {
  it('splits by the office factors with 4 decimals; the last day takes the rounding remainder', () => {
    const days = allocateDaily('100', DEFAULT_DAILY_FACTORS)!;
    expect(days).toEqual(['11.4286', '17.1429', '15.7143', '16.4286', '14.2857', '12.1429', '12.857']);
    expect(sum(days)).toBe('100');
  });

  it('keeps a 12-decimal week volume exact and skips days with factor 0', () => {
    const days = allocateDaily('33.333333333333', ['1', '0', '1', '1'])!;
    expect(days).toEqual(['11.1111', '0', '11.1111', '11.111133333333']);
    expect(sum(days)).toBe('33.333333333333');
  });

  it('never goes negative on a tiny volume and returns null without an active day', () => {
    const days = allocateDaily('0.00055', ['1', '1', '1', '1', '1', '1', '1'])!;
    expect(days.every((d) => !new Decimal(d).isNegative())).toBe(true);
    expect(sum(days)).toBe('0.00055');
    expect(allocateDaily('5', ['0', '0'])).toBeNull();
  });
});
