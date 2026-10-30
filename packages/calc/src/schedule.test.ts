import { describe, expect, it } from 'vitest';
import { plannedCurve, scheduleGroupIds, validateSchedule } from './index.js';

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
