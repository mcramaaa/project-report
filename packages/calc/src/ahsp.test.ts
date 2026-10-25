import { describe, expect, it } from 'vitest';
import {
  analysisCategoryTotals,
  calculateAnalysisPrice,
  compareWithWorkbook,
  Decimal,
  componentAmount,
  findAnalysisCycle,
  matchesWorkbookValue,
} from './index.js';

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
    expect(
      calculateAnalysisPrice(bouwplank, { overheadPercent: null, roundingScale: null }),
    ).toMatchObject({ overheadAmount: '0', priceExact: '143475', price: '143475' });
    expect(
      calculateAnalysisPrice([{ coefficient: '0.333', unitPrice: '1000.5' }], {
        overheadPercent: '12.5',
        roundingScale: 2,
      }),
    ).toMatchObject({
      priceExact: '374.8123125',
      price: '374.81',
    });
  });

  it('keeps zero coefficients as components', () => {
    expect(
      calculateAnalysisPrice([{ coefficient: '0', unitPrice: '5000' }], {
        overheadPercent: '10',
        roundingScale: 0,
      }).componentAmounts,
    ).toEqual(['0']);
    expect(componentAmount('0.0006', '165000')).toBe('99');
  });
});

describe('matchesWorkbookValue', () => {
  it('uses one absolute bound of Rp 0.000001 regardless of scale (D-054) and returns the evidence', () => {
    expect(matchesWorkbookValue('222727.407407407669', 222727.40740740742)).toBe(true);
    expect(matchesWorkbookValue('5121250896.4818', 5121250896.481801)).toBe(true);
    expect(matchesWorkbookValue('5121250896.49', 5121250896.481801)).toBe(false);
    // Regression: a relative bound grew with the value; the absolute bound does not.
    expect(matchesWorkbookValue('1000000000000.0001', 1000000000000)).toBe(false);
    expect(matchesWorkbookValue('100.0000009', 100)).toBe(true);
    expect(matchesWorkbookValue('100.0000011', 100)).toBe(false);
    expect(compareWithWorkbook('157822.5', 157822.49999999997)).toEqual({
      exact: '157822.5',
      cached: '157822.49999999997',
      diff: '0.00000000003',
      tolerance: '0.000001',
      rule: 'ABS_0.000001',
      matches: true,
    });
    expect(matchesWorkbookValue('99', 98.99999999999999)).toBe(true);
    expect(matchesWorkbookValue('746294.07', 746294.0700000001)).toBe(true);
    expect(matchesWorkbookValue('157822.5', 157822.5)).toBe(true);
    expect(matchesWorkbookValue('157823', 157822.5)).toBe(false);
    expect(matchesWorkbookValue('0', 0)).toBe(true);
    // A Decimal reference (Σ cached item amounts added exactly) is not re-read as a float.
    expect(compareWithWorkbook('5121250896.4818', new Decimal('5121250896.481800091423792765'))).toMatchObject({ diff: '0.000000091423792765', matches: true });
    expect(compareWithWorkbook('5121250896.52530005935926', 5121250896.525306).matches).toBe(false);
  });
});

describe('findAnalysisCycle', () => {
  it('finds sub-analysis cycles and accepts DAGs', () => {
    expect(
      findAnalysisCycle(
        new Map([
          ['A', ['B']],
          ['B', ['C']],
          ['C', []],
        ]),
      ),
    ).toBeNull();
    expect(
      findAnalysisCycle(
        new Map([
          ['A', ['B']],
          ['B', ['A']],
        ]),
      ),
    ).toEqual(['A', 'B', 'A']);
    expect(findAnalysisCycle(new Map([['S', ['S']]]))).toEqual(['S', 'S']);
  });
});

describe('AHSP worksheet subtotals', () => {
  it('reconciles the sample demolition worksheet including an empty material group', () => {
    expect(
      analysisCategoryTotals([
        { category: 'LABOR', amount: '21000' },
        { category: 'LABOR', amount: '3300' },
        { category: 'EQUIPMENT', amount: '12000' },
      ]),
    ).toEqual({ LABOR: '24300', MATERIAL: '0', EQUIPMENT: '12000' });
    expect(
      calculateAnalysisPrice(
        [
          { coefficient: '0.15', unitPrice: '140000' },
          { coefficient: '0.015', unitPrice: '220000' },
          { coefficient: '0.015', unitPrice: '800000' },
        ],
        { overheadPercent: '10', roundingScale: 0 },
      ),
    ).toMatchObject({ directCost: '36300', overheadAmount: '3630', price: '39930' });
  });
  it('keeps fine decimal precision and zero-valued groups', () => {
    expect(
      analysisCategoryTotals([
        { category: 'MATERIAL', amount: '0.000000000001' },
        { category: 'MATERIAL', amount: '0.000000000002' },
      ]),
    ).toEqual({ LABOR: '0', MATERIAL: '0.000000000003', EQUIPMENT: '0' });
    expect(analysisCategoryTotals([])).toEqual({ LABOR: '0', MATERIAL: '0', EQUIPMENT: '0' });
  });
});
