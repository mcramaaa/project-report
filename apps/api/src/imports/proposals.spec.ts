import { describe, expect, it } from 'vitest';
import { buildDraft, looseText } from './build-draft';
import { proposePackage, type PackageBase } from './proposals';
import { rabSheet, recapLookup, workbookOf } from './test-workbook';

const draftOf = (lookupKey: string | number) =>
  buildDraft(
    [
      {
        model: workbookOf({
          'RAB + PPN': rabSheet([
            { no: 'A', desc: 'DINDING' },
            { no: 1, desc: 'Pasangan bata', vol: 10, unit: 'm2', code: String(lookupKey), price: recapLookup(14, 59400) },
          ]),
          'REKAP ANALISA': { B6: lookupKey, E6: 59400 },
        }),
        documentId: 'doc-1',
        filename: 'mc0.xlsx',
        sha256: 'x',
      },
    ],
    { targetVersionType: 'MC', officialAnalyses: [], previousItems: [] },
  );

const base: PackageBase = {
  version: { id: 'v-1', label: 'Kontrak' },
  items: [{ workItemId: 'w-1', code: 'WI-0001', description: 'Pasangan bata', groupPath: 'A', unit: 'm2', analysisCode: 'P.1' }],
  official: new Map([['a-1', { analysisVersionId: 'a-1', code: 'P.1', name: 'BATA', unit: 'm2', price: '59400' }]]),
};

describe('package proposals (D-065)', () => {
  it('proposes the work item and the inherited analysis on unambiguous evidence', () => {
    const review = proposePackage(draftOf('P.1'), [], base)!;
    expect(review.proposals).toEqual([expect.objectContaining({ workItem: expect.objectContaining({ workItemId: 'w-1' }), analysis: expect.objectContaining({ analysisVersionId: 'a-1' }) })]);
    expect(review.counts).toMatchObject({ inherit: 1, match: 1, problems: 0 });
  });

  it('an old draft without source block data gets no inheritance', () => {
    const draft = draftOf('P.1');
    delete draft.stats.analysisBlocksInSources;
    const review = proposePackage(draft, [], base)!;
    expect(review.sourceHasAnalyses).toBeNull();
    expect(review.proposals[0]!.analysis).toBeUndefined();
  });

  it('no inheritance when the base work item used another analysis, or for duplicate codes', () => {
    const changed = proposePackage(draftOf('P.1'), [], { ...base, items: [{ ...base.items[0]!, analysisCode: 'P.2' }] })!;
    expect(changed.proposals[0]!.analysis).toBeUndefined();
    const twice = new Map(base.official).set('a-2', { analysisVersionId: 'a-2', code: 'p.1', name: 'BATA LAIN', unit: 'm2', price: '59400' });
    expect(proposePackage(draftOf('P.1'), [], { ...base, official: twice })!.proposals[0]!.analysis).toBeUndefined();
  });

  it('Kontrak imports have no package review', () => {
    expect(proposePackage({ ...draftOf('P.1'), targetVersionType: 'CONTRACT' }, [], base)).toBeNull();
  });
});

describe('punctuation-only description differences (D-067)', () => {
  const KWH = 'Pas. Kwh Meter Token 1 Phase (Termasuk Sambungan Listrik Pln 7700 VA)';
  const kwhDraft = (descs: string[], ctxItems: PackageBase['items'] = []) =>
    buildDraft(
      [
        {
          model: workbookOf({
            'RAB + PPN': rabSheet([
              { no: 'A', desc: 'LISTRIK' },
              ...descs.map((desc, i) => ({ no: i + 1, desc, vol: 1, unit: 'unt', code: 'XXII.13', price: recapLookup(14 + i, 14947882) })),
            ]),
            'REKAP ANALISA': { B6: 'XXII.13', E6: 14947882 },
          }),
          documentId: 'doc-1',
          filename: 'mc0.xlsx',
          sha256: 'x',
        },
      ],
      { targetVersionType: 'MC', officialAnalyses: [], previousItems: ctxItems },
    );
  const item = (id: string, description: string, analysisCode: string | null = 'XXII.13') => ({ workItemId: id, code: id.toUpperCase(), description, groupPath: 'A', unit: 'unt', analysisCode });
  const kwhBase = (items: PackageBase['items']): PackageBase => ({ version: { id: 'v-1', label: 'Kontrak' }, items, official: new Map() });
  const items = (d: ReturnType<typeof kwhDraft>) => d.rows.filter((r) => r.rowType === 'ITEM');

  it('"Pas.." vs "Pas." with same group, unit and analysis code: candidate with reason and package proposal', () => {
    const contract = [item('wi-0364', KWH.replace('Pas.', 'Pas..'))];
    const draft = kwhDraft([KWH], contract);
    expect(items(draft)[0]!.workItemCandidates).toEqual([expect.objectContaining({ workItemId: 'wi-0364', unit: 'unt', analysisCode: 'XXII.13', reason: expect.stringContaining('tanda baca') })]);
    const review = proposePackage(draft, [], kwhBase(contract))!;
    expect(review.proposals).toEqual([expect.objectContaining({ workItem: expect.objectContaining({ workItemId: 'wi-0364', reason: expect.stringContaining('beda tanda baca') }) })]);
    // A manual decision is never replaced by the proposal.
    const manual = { rowKey: items(draft)[0]!.key, kind: 'WORK_ITEM_MATCH' as const, value: { workItemId: null }, reason: null, decidedBy: 'u', decidedAt: new Date() };
    expect(proposePackage(draft, [manual], kwhBase(contract))!.proposals).toEqual([]);
  });

  it('no pairing without analysis code evidence, or when numbers/sizes differ', () => {
    expect(items(kwhDraft([KWH], [item('w', KWH.replace('Pas.', 'Pas..'), null)]))[0]!.workItemCandidates).toEqual([]);
    expect(items(kwhDraft([KWH], [item('w', KWH.replace('Pas.', 'Pas..').replace('7700', '5500'))]))[0]!.workItemCandidates).toEqual([]);
    expect(looseText('Kabel 1..5 mm')).not.toBe(looseText('Kabel 1.5 mm'));
    expect(looseText('Pas.. Kwh,, 7.700 VA')).toBe(looseText('Pas. Kwh, 7.700 VA'));
  });

  it('double candidates in either direction stay explicit review', () => {
    const twoBase = [item('w-1', KWH), item('w-2', KWH.replace('Pas.', 'Pas..'))];
    const d1 = kwhDraft([KWH], twoBase);
    expect(items(d1)[0]!.workItemCandidates).toHaveLength(2);
    expect(proposePackage(d1, [], kwhBase(twoBase))!.proposals).toEqual([]);
    const oneBase = [item('w-1', KWH.replace('Pas.', 'Pas..'))];
    const d2 = kwhDraft([KWH, KWH.replace('Pas.', 'Pas...')], oneBase);
    expect(items(d2).map((r) => r.workItemCandidates.length)).toEqual([1, 1]);
    expect(proposePackage(d2, [], kwhBase(oneBase))!.proposals).toEqual([]);
  });
});
