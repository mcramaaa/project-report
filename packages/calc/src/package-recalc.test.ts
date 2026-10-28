import { describe, expect, it } from 'vitest';
import { recalculatePackage, type AnalysisPackage } from './index.js';

/**
 * SUB (rounded to 0) uses a labor price; MAIN uses SUB exact, SUB rounded, a rental price /8 and a manual
 * component, with 10% overhead. OTHER uses an unrelated price and must never be touched.
 */
function pkg(): AnalysisPackage {
  return {
    prices: [
      { id: 'p-labor', price: '100000' },
      { id: 'p-rent', price: '800000' },
      { id: 'p-other', price: '5000' },
    ],
    analyses: [
      { id: 'SUB', overheadPercent: null, roundingScale: 0, directCost: '1500.3', overheadAmount: '0', priceExact: '1500.3', price: '1500' },
      // D = 2·1500.3 + 1·1500 + 0.5·100000 + 1·7000 = 61500.6
      { id: 'MAIN', overheadPercent: '10', roundingScale: null, directCost: '61500.6', overheadAmount: '6150.06', priceExact: '67650.66', price: '67650.66' },
      { id: 'OTHER', overheadPercent: null, roundingScale: null, directCost: '50000', overheadAmount: '0', priceExact: '50000', price: '50000' },
    ],
    components: [
      { id: 'sub-labor', analysisVersionId: 'SUB', coefficient: '0.015003', unitPrice: '100000', amount: '1500.3', priceItemId: 'p-labor', factor: null, subAnalysisVersionId: null, subPriceBasis: null },
      { id: 'main-exact', analysisVersionId: 'MAIN', coefficient: '2', unitPrice: '1500.3', amount: '3000.6', priceItemId: null, factor: null, subAnalysisVersionId: 'SUB', subPriceBasis: 'EXACT' },
      { id: 'main-rounded', analysisVersionId: 'MAIN', coefficient: '1', unitPrice: '1500', amount: '1500', priceItemId: null, factor: null, subAnalysisVersionId: 'SUB', subPriceBasis: 'ROUNDED' },
      { id: 'main-rent', analysisVersionId: 'MAIN', coefficient: '0.5', unitPrice: '100000', amount: '50000', priceItemId: 'p-rent', factor: { op: '/', value: '8' }, subAnalysisVersionId: null, subPriceBasis: null },
      { id: 'main-manual', analysisVersionId: 'MAIN', coefficient: '1', unitPrice: '7000', amount: '7000', priceItemId: null, factor: null, subAnalysisVersionId: null, subPriceBasis: null },
      // Stored amount with source precision that does not equal coefficient × price exactly (D-063): must stay.
      { id: 'other-1', analysisVersionId: 'OTHER', coefficient: '10', unitPrice: '5000', amount: '50000.000000000001', priceItemId: 'p-other', factor: null, subAnalysisVersionId: null, subPriceBasis: null },
    ],
  };
}

describe('recalculatePackage (D-068)', () => {
  it('keeps the conversion factor of a price used per hour', () => {
    const r = recalculatePackage(pkg(), { kind: 'PRICE_ITEM', priceItemId: 'p-rent', price: '960000' });
    expect(r.components.get('main-rent')).toEqual({ coefficient: '0.5', unitPrice: '120000', amount: '60000' });
    // D = 61500.6 + 10000; E = 10%; no rounding.
    expect(r.analyses.get('MAIN')).toMatchObject({ directCost: '71500.6', overheadAmount: '7150.06', priceExact: '78650.66', price: '78650.66' });
    expect([...r.components.keys()]).toEqual(['main-rent']);
    expect([...r.analyses.keys()]).toEqual(['MAIN']);
  });

  it('a corrected conversion factor re-derives the component price from its base price', () => {
    // Rent 800000 per day ÷ 8 → 100000/hour; ÷ 10 → 80000: amount 0.5 × 80000 = 40000, D = 51500.6.
    const r = recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-rent', factor: { op: '/', value: '10' } });
    expect(r.components.get('main-rent')).toEqual({ coefficient: '0.5', unitPrice: '80000', amount: '40000' });
    expect(r.analyses.get('MAIN')).toMatchObject({ directCost: '51500.6', price: '56650.66' });
    // No factor: the base price as it is.
    const none = recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-rent', factor: null });
    expect(none.components.get('main-rent')).toMatchObject({ unitPrice: '800000', amount: '400000' });
    // A sub-analysis price can be converted too; a manual component has nothing to convert.
    const sub = recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-exact', factor: { op: '*', value: '2' } });
    expect(sub.components.get('main-exact')).toMatchObject({ unitPrice: '3000.6', amount: '6001.2' });
    expect(() => recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-manual', factor: { op: '/', value: '2' } })).toThrow(RangeError);
  });

  it('propagates a base price through EXACT and ROUNDED sub-analysis prices', () => {
    const r = recalculatePackage(pkg(), { kind: 'PRICE_ITEM', priceItemId: 'p-labor', price: '110000' });
    // SUB: 0.015003 × 110000 = 1650.33 → rounded 1650.
    expect(r.analyses.get('SUB')).toMatchObject({ priceExact: '1650.33', price: '1650' });
    expect(r.components.get('main-exact')).toMatchObject({ unitPrice: '1650.33', amount: '3300.66' });
    expect(r.components.get('main-rounded')).toMatchObject({ unitPrice: '1650', amount: '1650' });
    // MAIN D = 3300.66 + 1650 + 50000 + 7000 = 61950.66; F = 68145.726.
    expect(r.analyses.get('MAIN')).toMatchObject({ directCost: '61950.66', priceExact: '68145.726', price: '68145.726' });
    expect(r.analyses.has('OTHER')).toBe(false);
    expect(r.components.has('other-1')).toBe(false);
  });

  it('keeps a conversion factor when a changed sub-analysis feeds another analysis', () => {
    const input = pkg();
    input.components.find((c) => c.id === 'main-exact')!.factor = { op: '/', value: '4' };
    const r = recalculatePackage(input, { kind: 'PRICE_ITEM', priceItemId: 'p-labor', price: '110000' });
    expect(r.components.get('main-exact')).toMatchObject({ unitPrice: '412.5825', amount: '825.165' });
  });

  it('a rounded sub-analysis whose rounded price does not move leaves EXACT users only', () => {
    // 0.015003 × 100010 = 1500.45003 → still rounds to 1500.
    const r = recalculatePackage(pkg(), { kind: 'PRICE_ITEM', priceItemId: 'p-labor', price: '100010' });
    expect(r.components.has('main-rounded')).toBe(false);
    expect(r.components.get('main-exact')?.unitPrice).toBe('1500.45003');
  });

  it('coefficient, manual price, overhead and rounding are source inputs', () => {
    expect(recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-manual', unitPrice: '8000' }).analyses.get('MAIN')?.directCost).toBe('62500.6');
    expect(recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-rent', coefficient: '1' }).components.get('main-rent')).toEqual({ coefficient: '1', unitPrice: '100000', amount: '100000' });
    expect(recalculatePackage(pkg(), { kind: 'ANALYSIS', analysisVersionId: 'MAIN', overheadPercent: null }).analyses.get('MAIN')).toMatchObject({ overheadAmount: '0', price: '61500.6' });
    expect(recalculatePackage(pkg(), { kind: 'ANALYSIS', analysisVersionId: 'MAIN', roundingScale: 0 }).analyses.get('MAIN')).toMatchObject({ priceExact: '67650.66', price: '67651', roundingScale: 0 });
  });

  it('rejects editing a derived component price, cycles and relations outside the package', () => {
    expect(() => recalculatePackage(pkg(), { kind: 'COMPONENT', componentId: 'main-rent', unitPrice: '1' })).toThrow(/harga dasar\/subanalisa/);
    const cyclic = pkg();
    cyclic.components.push({ ...cyclic.components[1]!, id: 'loop', analysisVersionId: 'SUB', subAnalysisVersionId: 'MAIN' });
    expect(() => recalculatePackage(cyclic, { kind: 'PRICE_ITEM', priceItemId: 'p-other', price: '1' })).toThrow(/bersiklus/);
    const outside = pkg();
    outside.components[0]!.priceItemId = 'p-foreign';
    expect(() => recalculatePackage(outside, { kind: 'PRICE_ITEM', priceItemId: 'p-other', price: '1' })).toThrow(/di luar paket/);
  });

  it('an edit to the same value changes nothing', () => {
    const r = recalculatePackage(pkg(), { kind: 'PRICE_ITEM', priceItemId: 'p-rent', price: '800000.00' });
    expect(r.components.size + r.analyses.size).toBe(0);
  });
});
