import { describe, expect, it } from 'vitest';
import { Decimal } from './index.js';

describe('Decimal', () => {
  it('adds decimal strings exactly where JS number does not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('keeps products beyond the decimal.js default of 20 significant digits (regression)', () => {
    expect(new Decimal('561.972461257442').times('155413.4553').toFixed()).toBe('87338081.9874644440593426');
    expect(Decimal.precision).toBe(80);
  });
});
