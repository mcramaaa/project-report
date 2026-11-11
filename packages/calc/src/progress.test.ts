import { describe, expect, it } from 'vitest';
import { progressSummary, weeklyVolumeFromPercent } from './index.js';

describe('weeklyVolumeFromPercent (D-073)', () => {
  it('turns a cumulative percent into this week\'s volume, exactly', () => {
    expect(weeklyVolumeFromPercent('45', '120', '30')).toBe('24');
    expect(weeklyVolumeFromPercent('100', '0.3', '0.1')).toBe('0.2'); // no float drift
  });

  it('rounds the cumulative target HALF_UP to 12 decimals', () => {
    expect(weeklyVolumeFromPercent('33.333333', '1', '0')).toBe('0.33333333');
    expect(weeklyVolumeFromPercent('100', '0.0000000000005', '0')).toBe('0.000000000001');
  });

  it('rejects a percent below what was already reported', () => {
    expect(weeklyVolumeFromPercent('20', '100', '30')).toBeNull();
    expect(weeklyVolumeFromPercent('30', '100', '30')).toBe('0');
  });
});

describe('progressSummary', () => {
  it('gives cumulative, percent and remaining', () => {
    expect(progressSummary('30', '24', '120')).toEqual({ cumulative: '54', percent: '45', remaining: '66' });
  });

  it('shows over-baseline progress after a smaller baseline instead of hiding it', () => {
    expect(progressSummary('110', '0', '100')).toEqual({ cumulative: '110', percent: '110', remaining: '-10' });
  });

  it('has no percent without a baseline volume', () => {
    expect(progressSummary('5', '0', null)).toEqual({ cumulative: '5', percent: null, remaining: null });
  });
});
