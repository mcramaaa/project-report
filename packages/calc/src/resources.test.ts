import { describe, expect, it } from 'vitest';
import { resourceNeeds, type AhspComponentNode } from './index.js';

const c = (category: AhspComponentNode['category'], key: string, coefficient: string, subAnalysisId: string | null = null): AhspComponentNode => ({
  category,
  key,
  name: key,
  unit: 'u',
  coefficient,
  subAnalysisId,
});

describe('resourceNeeds (D-079)', () => {
  it('multiplies volume by coefficients, through sub-analyses, and adds up the same resource', () => {
    const analyses = new Map([
      ['beton', [c('LABOR', 'pekerja', '1.65'), c('MATERIAL', 'semen', '7'), c('MATERIAL', 'mortar', '0.5', 'mortar'), c('EQUIPMENT', 'molen', '0.25')]],
      ['mortar', [c('MATERIAL', 'semen', '2'), c('MATERIAL', 'pasir', '0.8')]],
    ]);
    const needs = resourceNeeds(
      [
        { analysisId: 'beton', volume: '2' },
        { analysisId: null, volume: '9' },
        { analysisId: 'mortar', volume: '1' },
      ],
      analyses,
      ['MATERIAL', 'EQUIPMENT'],
    );
    // semen: 2×7 + 2×0.5×2 + 1×2 = 18; pasir: 2×0.5×0.8 + 1×0.8 = 1.6; labor left out.
    expect(needs.map((n) => [n.category, n.key, n.quantity])).toEqual([
      ['MATERIAL', 'semen', '18'],
      ['MATERIAL', 'pasir', '1.6'],
      ['EQUIPMENT', 'molen', '0.5'],
    ]);
  });

  it('stops a cycle of sub-analyses instead of looping', () => {
    const analyses = new Map([['a', [c('MATERIAL', 'x', '1', 'a')]]]);
    expect(() => resourceNeeds([{ analysisId: 'a', volume: '1' }], analyses, ['MATERIAL'])).toThrow(/siklus/);
  });
});
