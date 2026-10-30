import { describe, expect, it } from 'vitest';
import { actualCurve, plannedCurve, scaleScheduleToWeights, scheduleGroupIds, validateSchedule } from './index.js';

describe('scheduleGroupIds', () => {
  it('takes SUBSECTIONs and SECTIONs without SUBSECTION, as REKAP RAB does', () => {
    const ids = scheduleGroupIds([
      { id: 'A', parentId: null, rowType: 'SECTION' },
      { id: 'a1', parentId: 'A', rowType: 'ITEM' },
      { id: 'B', parentId: null, rowType: 'SECTION' },
      { id: 'B.I', parentId: 'B', rowType: 'SUBSECTION' },
      { id: 'b1', parentId: 'B.I', rowType: 'PARENT_ITEM' },
    ]);
    expect([...ids].sort()).toEqual(['A', 'B.I']);
  });
});

describe('validateSchedule (D-072)', () => {
  const groups = [
    { id: 'A', label: 'A Persiapan', weight: '40' },
    { id: 'B.I', label: 'B.I Pengukuran', weight: '60' },
  ];

  it('accepts sums within 0.0001 points of each group weight', () => {
    // 15-digit workbook decimals: three thirds of 60 leave a tiny remainder.
    const third = '19.9999999999999';
    expect(
      validateSchedule(groups, [
        { groupId: 'A', weekNumber: 1, weight: '40' },
        { groupId: 'B.I', weekNumber: 1, weight: third },
        { groupId: 'B.I', weekNumber: 2, weight: third },
        { groupId: 'B.I', weekNumber: 3, weight: third },
      ], 3),
    ).toEqual([]);
  });

  it('reports a group whose weeks do not add up, negatives, weeks outside the project and non-groups', () => {
    const issues = validateSchedule(groups, [
      { groupId: 'A', weekNumber: 1, weight: '39.9' },
      { groupId: 'B.I', weekNumber: 4, weight: '60' },
      { groupId: 'B.I', weekNumber: 1, weight: '-1' },
      { groupId: 'x', weekNumber: 1, weight: '1' },
    ], 3);
    expect(issues.map((i) => i.groupId)).toEqual(['B.I', 'B.I', 'x', 'A', 'B.I']);
    expect(issues[0]!.message).toContain('Minggu 4 di luar masa proyek');
    expect(issues.at(-2)!.message).toContain('39.900000% tidak sama dengan bobot 40.000000%');
  });

  it('rejects group weights that do not cover 100% of the RAB', () => {
    const issues = validateSchedule([{ id: 'A', label: 'A', weight: '90' }], [{ groupId: 'A', weekNumber: 1, weight: '90' }], 1);
    expect(issues).toEqual([{ groupId: null, message: expect.stringContaining('bukan 100%') }]);
  });
});

describe('plannedCurve', () => {
  it('sums each week exactly and accumulates', () => {
    expect(
      plannedCurve([
        { weekNumber: 1, weight: '0.1' },
        { weekNumber: 1, weight: '0.2' },
        { weekNumber: 3, weight: '99.7' },
      ], 3),
    ).toEqual([
      { weekNumber: 1, planned: '0.3', cumulative: '0.3' },
      { weekNumber: 2, planned: '0', cumulative: '0.3' },
      { weekNumber: 3, planned: '99.7', cumulative: '100' },
    ]);
  });
});

describe('scaleScheduleToWeights (D-074)', () => {
  it('keeps the weekly spread and scales only groups whose weight changed', () => {
    const { entries, adjusted } = scaleScheduleToWeights(
      [
        { id: 'A', weight: '40' },
        { id: 'B', weight: '45' },
        { id: 'C', weight: '15' },
      ],
      [
        { groupId: 'A', weekNumber: 1, weight: '40.00005' }, // within tolerance: untouched
        { groupId: 'B', weekNumber: 1, weight: '15' },
        { groupId: 'B', weekNumber: 2, weight: '45' },
      ],
    );
    expect(entries).toEqual([
      { groupId: 'A', weekNumber: 1, weight: '40.00005' },
      { groupId: 'B', weekNumber: 1, weight: '11.25' },
      { groupId: 'B', weekNumber: 2, weight: '33.75' },
    ]);
    expect(adjusted).toEqual([{ groupId: 'B', from: '60', to: '45' }]);
    // C has no entries: nothing to scale, validation still reports it.
    expect(validateSchedule([{ id: 'C', label: 'C', weight: '15' }], [], 1)).toHaveLength(2);
  });

  it('rounds each scaled week to 18 decimals and the group stays within tolerance', () => {
    const { entries } = scaleScheduleToWeights([{ id: 'G', weight: '1.197946' }], [1, 2, 3].map((n) => ({ groupId: 'G', weekNumber: n, weight: '0.4340376804693972' })));
    expect(entries[0]!.weight.split('.')[1]!.length).toBeLessThanOrEqual(18);
    expect(validateSchedule([{ id: 'G', label: 'G', weight: '1.197946' }], entries, 3).filter((i) => i.groupId === 'G')).toEqual([]);
  });
});

describe('actualCurve (D-076)', () => {
  it('weights each week by volume share of the item and accumulates; unknown items count nothing', () => {
    // Total 1000: item A subtotal 600 (60%) over 10 m3, item B 400 (40%) over 4 m3.
    const items = [
      { workItemId: 'A', volume: '10', subtotal: '600' },
      { workItemId: 'B', volume: '4', subtotal: '400' },
      { workItemId: 'Z', volume: '0', subtotal: '0' },
    ];
    expect(
      actualCurve(items, [
        { workItemId: 'A', weekNumber: 1, volume: '5' },
        { workItemId: 'B', weekNumber: 2, volume: '1' },
        { workItemId: 'X', weekNumber: 2, volume: '99' },
        { workItemId: 'Z', weekNumber: 2, volume: '1' },
      ], '1000', 3),
    ).toEqual([
      { weekNumber: 1, actual: '30', cumulative: '30' },
      { weekNumber: 2, actual: '10', cumulative: '40' },
      { weekNumber: 3, actual: '0', cumulative: '40' },
    ]);
  });
});
