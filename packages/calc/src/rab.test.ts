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

describe('unitPriceWithTax (D-043: exact, as G + G*H/100)', () => {
  it('does not round', () => {
    expect(unitPriceWithTax('124696', '11')).toBe('138412.56');
    expect(unitPriceWithTax('672337', '11')).toBe('746294.07'); // workbook float shows 746294.0700000001
    expect(unitPriceWithTax('0.05', '10')).toBe('0.055');
    expect(unitPriceWithTax('12345.67', '0')).toBe('12345.67');
  });
});

describe('calculateRab (D-043)', () => {
  it('keeps item amounts exact and rounds only the total (REAL COST, DIBULATKAN)', () => {
    const { rows, totals } = calculateRab([item('a', '39.39', '124696'), item('b', '17.97', '672337')]);
    // Same values as the office workbook cells (SDN 2 Serangan, RAB + PPN J22 and J30).
    expect(rows.get('a')).toMatchObject({ unitPriceWithTax: '138412.56', subtotal: '5452070.7384', subtotalBeforeTax: '4911775.44' });
    expect(rows.get('b')!.subtotal).toBe('13410904.4379');
    expect(totals).toEqual({ beforeTax: '16993671.33', tax: '1869303.8463', value: '18862975.1763', realCost: '18862975.18', rounded: '18862975' });
  });

  it('REAL COST rounds half up; DIBULATKAN truncates to whole rupiah', () => {
    expect(calculateRab([item('a', '1', '999.995', '0')]).totals).toMatchObject({ realCost: '1000.00', rounded: '1000' });
    expect(calculateRab([item('a', '1', '0.005', '0')]).totals).toMatchObject({ realCost: '0.01', rounded: '0' });
    expect(calculateRab([item('a', '1', '5121250896.48', '0')]).totals.rounded).toBe('5121250896');
  });

  it('keeps full precision for 12-decimal volumes and large prices', () => {
    const { rows } = calculateRab([item('a', '999999999999999999.999999999999', '99999999999999999.99')]);
    expect(rows.get('a')!.subtotal).toBe('110999999999999999988899999999889000.0000000000000111');
    // MC-0 balancing volume from the workbook keeps its 12 decimals.
    expect(calculateRab([item('p', '561.972461257442', '100000', '0')]).rows.get('p')!.subtotal).toBe('56197246.1257442');
  });

  it('weights are subtotal / total × 100 without remainder adjustment', () => {
    const { rows } = calculateRab([item('a', '39.39', '124696'), item('b', '17.97', '672337')]);
    expect([rows.get('a')!.weight, rows.get('b')!.weight]).toEqual(['28.9035567690', '71.0964432310']);
    const thirds = calculateRab([item('x', '1', '1', '0'), item('y', '1', '1', '0'), item('z', '1', '1', '0')]).rows;
    expect([thirds.get('x')!.weight, thirds.get('y')!.weight, thirds.get('z')!.weight]).toEqual(['33.3333333333', '33.3333333333', '33.3333333333']);
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
    expect(rows.get('P')).toMatchObject({ subtotal: '11000', unitPriceWithTax: null });
    expect(rows.get('I')).toMatchObject({ subtotalBeforeTax: '20000', subtotal: '22000' });
    expect(rows.get('II')).toMatchObject({ subtotal: '9900', weight: '31.0344827586' });
    expect(totals.value).toBe('31900');
  });

  it('leaves incomplete items out of totals and handles a zero total', () => {
    const { rows, totals } = calculateRab([item('a', null, '1000'), item('b', '3', '1000', null), item('c', '0', '1000')]);
    expect(rows.get('a')).toMatchObject({ unitPriceWithTax: '1110', subtotal: null, weight: null });
    expect(rows.get('b')).toMatchObject({ unitPriceWithTax: null, subtotal: null });
    expect(rows.get('c')).toMatchObject({ subtotal: '0', weight: '0.0000000000' });
    expect(totals).toEqual({ beforeTax: '0', tax: '0', value: '0', realCost: '0.00', rounded: '0' });
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
    expect(calculateRab(rows).rows.get('g0')!.subtotal).toBe('10');
  });
});
