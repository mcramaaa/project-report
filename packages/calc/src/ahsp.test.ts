import { describe, expect, it } from 'vitest';
import { calculateAnalysisPrice, componentAmount, findAnalysisCycle, matchesWorkbookValue } from './index.js';

describe('calculateAnalysisPrice (D-051)', () => {
  // Workbook SDN 2 Serangan, ANALISA I.1 "PASANGAN 1 M' BOUWPLANK".
  const bouwplank = [
    { coefficient: '0.012', unitPrice: '140000' },
    { coefficient: '0.006', unitPrice: '152000' },
    { coefficient: '0.0006', unitPrice: '165000' },
    { coefficient: '0.0012', unitPrice: '220000' },
    { coefficient: '0.013', unitPrice: '6800000' },
    { coefficient: '0.02', unitPrice: '16000' },
    { coefficient: '0.007', unitPrice: '7400000' },
  ];

  it('sums exact component amounts, adds overhead from the source, and rounds like the source', () => {
    expect(calculateAnalysisPrice(bouwplank, { overheadPercent: '10', roundingScale: 0 })).toEqual({
      componentAmounts: ['1680', '912', '99', '264', '88400', '320', '51800'],
      directCost: '143475',
      overheadAmount: '14347.5',
      priceExact: '157822.5',
      price: '157823',
    });
  });

  it('does not round or add overhead unless the source does', () => {
    expect(calculateAnalysisPrice(bouwplank, { overheadPercent: null, roundingScale: null })).toMatchObject({ overheadAmount: '0', priceExact: '143475', price: '143475' });
    expect(calculateAnalysisPrice([{ coefficient: '0.333', unitPrice: '1000.5' }], { overheadPercent: '12.5', roundingScale: 2 })).toMatchObject({
      priceExact: '374.8123125',
      price: '374.81',
    });
  });

  it('keeps zero coefficients as components', () => {
    expect(calculateAnalysisPrice([{ coefficient: '0', unitPrice: '5000' }], { overheadPercent: '10', roundingScale: 0 }).componentAmounts).toEqual(['0']);
    expect(componentAmount('0.0006', '165000')).toBe('99');
  });
});

describe('matchesWorkbookValue', () => {
  it('tolerates Excel float error but not real differences', () => {
    expect(matchesWorkbookValue('222727.407407407669', 222727.40740740742)).toBe(true);
    expect(matchesWorkbookValue('5121250896.4818', 5121250896.481801)).toBe(true);
    expect(matchesWorkbookValue('5121250896.49', 5121250896.481801)).toBe(false);
    expect(matchesWorkbookValue('99', 98.99999999999999)).toBe(true);
    expect(matchesWorkbookValue('746294.07', 746294.0700000001)).toBe(true);
    expect(matchesWorkbookValue('157822.5', 157822.5)).toBe(true);
    expect(matchesWorkbookValue('157823', 157822.5)).toBe(false);
    expect(matchesWorkbookValue('0', 0)).toBe(true);
  });
});

describe('findAnalysisCycle', () => {
  it('finds sub-analysis cycles and accepts DAGs', () => {
    expect(findAnalysisCycle(new Map([['A', ['B']], ['B', ['C']], ['C', []]]))).toBeNull();
    expect(findAnalysisCycle(new Map([['A', ['B']], ['B', ['A']]]))).toEqual(['A', 'B', 'A']);
    expect(findAnalysisCycle(new Map([['S', ['S']]]))).toEqual(['S', 'S']);
  });
});
