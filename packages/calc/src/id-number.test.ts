import { describe, expect, it } from 'vitest';
import { parseIdNumber } from './id-number';

describe('parseIdNumber', () => {
  it('reads Indonesian thousands and decimal commas, and plain dot decimals', () => {
    expect(parseIdNumber('4.757,22')).toBe('4757.22');
    expect(parseIdNumber(' 1.234.567,5 ')).toBe('1234567.5');
    expect(parseIdNumber('10,364')).toBe('10.364');
    expect(parseIdNumber('10.5')).toBe('10.5');
    expect(parseIdNumber('30')).toBe('30');
  });
});
