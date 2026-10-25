import { describe, expect, it } from 'vitest';
import { Decimal } from './index.js';

describe('Decimal', () => {
  it('adds decimal strings exactly where JS number does not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
  });
});
