import { describe, expect, it } from 'vitest';
import { assertAcyclic, calculateRab, unitPriceWithTax, type RabCalcInput } from './index.js';

const item = (id: string, volume: string | null, unitPrice: string | null, taxPercent: string | null = '11', parentId: string | null = null): RabCalcInput => ({
  id,
  parentId,
  rowType: 'ITEM',
  volume,
  unitPrice,
  taxPercent,
});
const group = (id: string, rowType: RabCalcInput['rowType'], parentId: string | null = null): RabCalcInput => ({ id, parentId, rowType, volume: null, unitPrice: null, taxPercent: null });

describe('unitPriceWithTax', () => {
  it('rounds half up to 2 decimals', () => {
    expect(unitPriceWithTax('100000', '11')).toBe('111000.00');
    expect(unitPriceWithTax('0.05', '10')).toBe('0.06'); // 0.055 -> 0.06 (half up)
    expect(unitPriceWithTax('12345.67', '0')).toBe('12345.67');
    expect(unitPriceWithTax('1', '100')).toBe('2.00');
  });
});

describe('calculateRab (D-042)', () => {
  it('computes amounts per item and totals with tax as the difference', () => {
    const { rows, totals } = calculateRab([item('a', '39.39', '1250000.00'), item('b', '2.5', '333.33')]);
    // 1250000 × 1.11 = 1387500.00; × 39.39 = 54653625.00
    expect(rows.get('a')).toMatchObject({ unitPriceWithTax: '1387500.00', subtotalBeforeTax: '49237500.00', subtotal: '54653625.00' });
    // 333.33 × 1.11 = 369.9963 -> 370.00; × 2.5 = 925.00; before tax 833.325 -> 833.33
    expect(rows.get('b')).toMatchObject({ unitPriceWithTax: '370.00', subtotalBeforeTax: '833.33', subtotal: '925.00' });
    expect(totals).toEqual({ beforeTax: '49238333.33', value: '54654550.00', tax: '5416216.67' });
  });

  it('keeps full precision for large volume × price (beyond 20 significant digits)', () => {
    const { rows } = calculateRab([item('a', '12345678901234.5678', '987654321012345678.91', '0')]);
    expect(rows.get('a')!.subtotal).toBe('12193263112635268909878067376651.43');
  });

  it('weights total exactly 100; the remainder goes to the largest amount', () => {
    const { rows } = calculateRab([item('a', '1', '1', '0'), item('b', '1', '1', '0'), item('c', '1', '1', '0')]);
    expect([rows.get('a')!.weight, rows.get('b')!.weight, rows.get('c')!.weight]).toEqual(['33.333334', '33.333333', '33.333333']);

    const { rows: r2 } = calculateRab([item('small', '1', '1', '0'), item('big', '2', '1', '0')]);
    expect([r2.get('small')!.weight, r2.get('big')!.weight]).toEqual(['33.333333', '66.666667']);
  });

  it('aggregates subtotal and weight on group rows from their descendants', () => {
    const { rows, totals } = calculateRab([
      group('I', 'SECTION'),
      group('I.A', 'SUBSECTION', 'I'),
      item('1', '10', '1000', '10', 'I.A'),
      group('P', 'PARENT_ITEM', 'I.A'),
      item('2', '5', '2000', '10', 'P'),
      group('II', 'SECTION'),
      item('3', '1', '9000', '10', 'II'),
    ]);
    expect(rows.get('P')).toMatchObject({ subtotal: '11000.00', unitPriceWithTax: null });
    expect(rows.get('I')).toMatchObject({ subtotalBeforeTax: '20000.00', subtotal: '22000.00' });
    expect(rows.get('II')!.subtotal).toBe('9900.00');
    expect(totals.value).toBe('31900.00');
    const sum = ['I', 'II'].reduce((s, id) => s + Number(rows.get(id)!.weight), 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('leaves incomplete items out of totals and handles a zero total', () => {
    const { rows, totals } = calculateRab([item('a', null, '1000'), item('b', '3', '1000', null), item('c', '0', '1000')]);
    expect(rows.get('a')).toMatchObject({ unitPriceWithTax: '1110.00', subtotal: null, weight: null });
    expect(rows.get('b')).toMatchObject({ unitPriceWithTax: null, subtotal: null });
    expect(rows.get('c')).toMatchObject({ subtotal: '0.00', weight: '0.000000' });
    expect(totals).toEqual({ beforeTax: '0.00', tax: '0.00', value: '0.00' });
  });
});

describe('hierarchy cycles (regression: A → B → A overflowed the stack)', () => {
  it('rejects cycles and self-parents with a clear error', () => {
    const cyclic = [
      { ...group('A', 'SECTION'), parentId: 'B' },
      group('B', 'SUBSECTION', 'A'),
      item('x', '1', '1', '0', 'B'),
    ];
    expect(() => calculateRab(cyclic)).toThrow(/bersiklus/);
    expect(() => assertAcyclic([{ id: 'S', parentId: 'S' }])).toThrow(/bersiklus/);
  });

  it('accepts deep valid trees', () => {
    const rows: RabCalcInput[] = [group('g0', 'SECTION')];
    for (let i = 1; i < 500; i++) rows.push(group(`g${i}`, 'SUBSECTION', `g${i - 1}`));
    rows.push(item('leaf', '1', '10', '0', 'g499'));
    expect(calculateRab(rows).rows.get('g0')!.subtotal).toBe('10.00');
  });
});
