import { describe, expect, it } from 'vitest';
import { buildDraft, DraftInputError, type DraftContext } from './build-draft';
import { GUIDE_VERSION } from './guide/rab-import-guide';
import { analysisBlock, rabSheet, recap, recapLookup, workbookOf, type SheetSpec } from './test-workbook';
import { parseFormula } from './workbook/formula';

const contract: DraftContext = { targetVersionType: 'CONTRACT', officialAnalyses: [], previousItems: [] };

describe('formula parser', () => {
  it('parses references, quoted sheets, VLOOKUP, and marks unsupported syntax', () => {
    expect(parseFormula("IFERROR(VLOOKUP(F15,'REKAP ANALISA'!B$6:E$2787,4,FALSE),0)")).toMatchObject({ kind: 'call', name: 'IFERROR' });
    expect(parseFormula('+H24*(E25/100)')).toMatchObject({ kind: 'binary', op: '*' });
    expect(parseFormula("'[1]RAB'!G5")).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('eksternal') });
    expect(parseFormula('SUM(A:A)')).toMatchObject({ kind: 'unsupported' });
    expect(parseFormula('HARGA_BETON*2')).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('named range') });
  });
});

describe('buildDraft (RAB_IMPORT_GUIDE v1)', () => {
  const blockA = analysisBlock(5, {
    seq: 1,
    code: 'A.1',
    name: '1 M3 GALIAN TANAH BIASA MANUAL',
    unit: 'm3',
    components: [
      { category: 'TENAGA', name: 'Pekerja', unit: 'OH', coef: 0.75, price: ["VLOOKUP(C8,UPAH!B$2:C$20,2,FALSE)", 140000] },
      { category: 'TENAGA', name: 'Mandor', unit: 'OH', coef: 0.025, price: ["VLOOKUP(C9,UPAH!B$2:C$20,2,FALSE)", 220000] },
    ],
  });
  const upah: SheetSpec = { B2: 'Pekerja', C2: 140000, B3: 'Mandor', C3: 220000, B4: 'Tukang Batu', C4: 160000 };

  it('follows the recap formula to the analysis even when names differ; item keeps the recap name (D-047)', () => {
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN TANAH' },
        { no: 1, desc: 'Pek. Galian Pondasi Setempat', vol: 10, unit: 'm3', code: 'A.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, Math.round(blockA.price)] },
      ]),
      'REKAP ANALISA': recap([{ seq: 1, code: 'A.1', price: blockA.price }]),
      ANALISA: blockA.cells,
      UPAH: upah,
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(draft.guideVersion).toBe(GUIDE_VERSION);
    const item = draft.rows.find((r) => r.rowType === 'ITEM')!;
    expect(item.description).toBe('Pek. Galian Pondasi Setempat');
    expect(item.price).toMatchObject({ kind: 'ANALYSIS', roundingScale: 0 });
    expect(item.price.evidence.map((e) => e.cell)).toEqual(['RAB + PPN!G14', 'REKAP ANALISA!E6', 'ANALISA!H5', expect.stringMatching(/^ANALISA!H\d+$/)]);
    const a = draft.analyses[0]!;
    expect(a).toMatchObject({ code: 'A.1', name: '1 M3 GALIAN TANAH BIASA MANUAL', unit: 'm3', overheadPercent: '10' });
    // 0.75×140000 + 0.025×220000 = 110500; +10% = 121550
    expect(a.computed).toEqual({ directCost: '110500', overheadAmount: '11050', priceExact: '121550', price: '121550' });
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('imports only referenced analyses and prices; one analysis used by several items is not duplicated', () => {
    const blockB = analysisBlock(30, { seq: 2, code: 'B.1', name: 'UNUSED', unit: 'm2', components: [{ category: 'TENAGA', name: 'Tukang Batu', unit: 'OH', coef: 0.2, price: ["VLOOKUP(C33,UPAH!B$2:C$20,2,FALSE)", 160000] }] });
    const price: [string, number] = [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 121550];
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN TANAH' },
        { no: 1, desc: 'Galian pondasi', vol: 10, unit: 'm3', code: 'A.1', price },
        { no: 2, desc: 'Galian saluran', vol: 0, unit: 'm3', code: 'A.1', price: [`IFERROR(VLOOKUP(F15,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 121550] },
      ]),
      'REKAP ANALISA': recap([
        { seq: 1, code: 'A.1', price: blockA.price },
        { seq: 2, code: 'B.1', price: 35200 },
      ]),
      ANALISA: { ...blockA.cells, ...blockB.cells },
      UPAH: upah,
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(draft.stats).toMatchObject({ items: 2, analysesInWorkbook: 2, analysesImported: 1, components: 2, pricesImported: 2 });
    expect(draft.analyses[0]!.usedByRows).toHaveLength(2); // volume 0 still uses the analysis
    expect(draft.prices.map((p) => p.name).sort()).toEqual(['Mandor', 'Pekerja']); // Tukang Batu is not imported
  });

  it('keeps analyses from separate discipline sheets in one list and never merges same codes', () => {
    const struktur = analysisBlock(5, { seq: 1, code: 'I.1', name: 'BETON STRUKTUR', unit: 'm3', components: [{ category: 'BAHAN', name: 'Semen', unit: 'kg', coef: 300, price: 1500 }] });
    const arsitek = analysisBlock(5, { seq: 1, code: 'I.1', name: 'PLESTERAN ARSITEKTUR', unit: 'm2', components: [{ category: 'BAHAN', name: 'Semen', unit: 'kg', coef: 5, price: 1500 }] });
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'STRUKTUR' },
        { no: 1, desc: 'Beton kolom', vol: 2, unit: 'm3', code: 'I.1', price: [`IFERROR(VLOOKUP(F14,'REKAP STR'!B$6:E$100,4,FALSE),0)`, Math.round(struktur.price)] },
        { no: 'B', desc: 'ARSITEKTUR' },
        { no: 1, desc: 'Plesteran dinding', vol: 20, unit: 'm2', code: 'I.1', price: [`IFERROR(VLOOKUP(F16,'REKAP ARS'!B$6:E$100,4,FALSE),0)`, Math.round(arsitek.price)] },
      ]),
      'REKAP STR': recap([{ seq: 1, code: 'I.1', price: struktur.price, sheet: "'ANALISA STR'" }]),
      'REKAP ARS': recap([{ seq: 1, code: 'I.1', price: arsitek.price, sheet: "'ANALISA ARS'" }]),
      'ANALISA STR': struktur.cells,
      'ANALISA ARS': arsitek.cells,
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(draft.analyses.map((a) => [a.code, a.name])).toEqual([
      ['I.1', 'BETON STRUKTUR'],
      ['I.1', 'PLESTERAN ARSITEKTUR'],
    ]);
    expect(new Set(draft.rows.filter((r) => r.rowType === 'ITEM').map((r) => r.price.analysisKey)).size).toBe(2);
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('broken, ambiguous, external, or approximate chains go to review without guessing', () => {
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN' },
        { no: 1, desc: 'Kode tidak ada', vol: 1, unit: 'm3', code: 'Z.9', price: [`VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE)`, 1000] },
        { no: 2, desc: 'File eksternal', vol: 1, unit: 'm3', code: 'A.1', price: [`'[1]REKAP ANALISA'!E6`, 2000] },
        { no: 3, desc: 'Lookup approximate', vol: 1, unit: 'm3', code: 'A.1', price: [`VLOOKUP(F16,'REKAP ANALISA'!B$6:E$100,4)`, 3000] },
        { no: 4, desc: 'Harga langsung', vol: 1, unit: 'ls', price: 5000000 },
      ]),
      'REKAP ANALISA': { B6: 'A.1', E6: 121550 },
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], {
      ...contract,
      officialAnalyses: [{ analysisVersionId: 'v1', code: 'Z.9', name: 'BUKAN', unit: 'm3', price: '999' }],
    });
    const items = draft.rows.filter((r) => r.rowType === 'ITEM');
    expect(items.map((r) => r.price.kind)).toEqual(['UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED', 'DIRECT']);
    // Same code but different price is not a candidate.
    expect(items[0]!.analysisCandidates).toEqual([]);
    const messages = draft.issues.filter((i) => i.code === 'ANALYSIS_UNRESOLVED').map((i) => i.message);
    expect(messages[0]).toContain('tidak ditemukan');
    expect(messages[1]).toContain('eksternal');
    expect(messages[2]).toContain('bukan pencocokan tepat');
    expect(draft.issues.find((i) => i.code === 'DIRECT_PRICE')).toMatchObject({ severity: 'WARNING' });
  });

  it('flags a workbook amount that does not match price × coefficient', () => {
    const block = analysisBlock(5, { seq: 1, code: 'A.1', name: 'X', unit: 'm3', components: [{ category: 'TENAGA', name: 'Pekerja', unit: 'OH', coef: 0.5, price: 100000 }] });
    block.cells.H8 = ['G8*F8', 50001]; // cached amount disagrees with 0.5 × 100000
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'P' },
        { no: 1, desc: 'Item', vol: 1, unit: 'm3', code: 'A.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 55000] },
      ]),
      'REKAP ANALISA': recap([{ seq: 1, code: 'A.1', price: 55000 }]),
      ANALISA: block.cells,
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(draft.issues).toContainEqual(expect.objectContaining({ code: 'RECONCILIATION', severity: 'BLOCKING', message: expect.stringContaining('50001') }));
  });

  it('imports sub-analyses, evaluates constant factors exactly, and blocks price mismatches', () => {
    const sub = analysisBlock(40, { seq: 2, code: 'M.1', name: 'MORTAR 1:4', unit: 'm3', components: [{ category: 'BAHAN', name: 'Semen', unit: 'kg', coef: 400, price: 1500 }] });
    // Sub price exact = 400×1500×1.1 = 660000; main uses it via the recap (ROUND 0) and a rental per hour (/8).
    const main = analysisBlock(5, {
      seq: 1,
      code: 'P.1',
      name: 'PASANGAN BATA',
      unit: 'm2',
      components: [
        { category: 'BAHAN', name: 'Mortar', unit: 'm3', coef: 0.05, price: ["'REKAP ANALISA'!E7", 660000] },
        { category: 'PERALATAN', name: 'Sewa Molen', unit: 'jam', coef: 0.1, price: ['VLOOKUP(C11,UPAH!B$2:C$20,2,FALSE)/8', 50000] },
      ],
    });
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'P' },
        { no: 1, desc: 'Pasangan dinding', vol: 10, unit: 'm2', code: 'P.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 41800] },
      ]),
      'REKAP ANALISA': recap([
        { seq: 1, code: 'P.1', price: main.price },
        { seq: 2, code: 'M.1', price: sub.price },
      ]),
      ANALISA: { ...main.cells, ...sub.cells },
      UPAH: { B2: 'Sewa Molen', C2: 400000 },
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    const a = draft.analyses.find((x) => x.code === 'P.1')!;
    expect(a.components.map((c) => [c.description, c.unitPrice, c.source.kind])).toEqual([
      ['Mortar', '660000', 'ANALYSIS'],
      ['Sewa Molen', '50000', 'PRICE_ITEM'],
    ]);
    expect(draft.stats).toMatchObject({ analysesImported: 2, subAnalyses: 1 });
    // (0.05×660000 + 0.1×50000) × 1.1 = 41800 = RAB price → no mismatch.
    expect(a.computed.price).toBe('41800');
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);

    // Same workbook but the RAB carries another price: blocking until a reviewer chooses.
    const model2 = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'P' },
        { no: 1, desc: 'Pasangan dinding', vol: 10, unit: 'm2', code: 'P.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 42000] },
      ]),
      'REKAP ANALISA': { ...recap([{ seq: 1, code: 'P.1', price: main.price }, { seq: 2, code: 'M.1', price: sub.price }]), E6: ['ROUND(VLOOKUP(A6,ANALISA!A$5:H$500,8,FALSE),0)', 42000] },
      ANALISA: { ...main.cells, ...sub.cells },
      UPAH: { B2: 'Sewa Molen', C2: 400000 },
    });
    const mismatch = buildDraft([{ model: model2, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(mismatch.issues).toContainEqual(expect.objectContaining({ code: 'PRICE_MISMATCH', resolvedBy: ['PRICE_CHOICE'] }));
  });

  it('rejects analyses that refer to each other', () => {
    const a = analysisBlock(5, { seq: 1, code: 'C.1', name: 'A', unit: 'm3', components: [{ category: 'BAHAN', name: 'B', unit: 'm3', coef: 1, price: ["'REKAP ANALISA'!E7", 100] }] });
    const b = analysisBlock(30, { seq: 2, code: 'C.2', name: 'B', unit: 'm3', components: [{ category: 'BAHAN', name: 'A', unit: 'm3', coef: 1, price: ["'REKAP ANALISA'!E6", 100] }] });
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'P' },
        { no: 1, desc: 'Item', vol: 1, unit: 'm3', code: 'C.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 110] },
      ]),
      'REKAP ANALISA': recap([
        { seq: 1, code: 'C.1', price: 110 },
        { seq: 2, code: 'C.2', price: 110 },
      ]),
      ANALISA: { ...a.cells, ...b.cells },
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(draft.issues).toContainEqual(expect.objectContaining({ code: 'ANALYSIS_CYCLE', severity: 'BLOCKING' }));
  });

  it('asks for the RAB sheet when a workbook has several candidates', () => {
    const sheet = rabSheet([{ no: 'A', desc: 'P' }]);
    const model = workbookOf({ 'RAB + PPN': sheet, 'RAB GLOBAL': sheet });
    expect(() => buildDraft([{ model, documentId: 'd1', filename: 'paket.xlsx', sha256: 's' }], contract)).toThrow(DraftInputError);
    expect(() => buildDraft([{ model, documentId: 'd1', filename: 'paket.xlsx', sha256: 's' }], contract)).toThrow(/RAB \+ PPN, RAB GLOBAL/);
  });

  it('non-contract imports propose work item candidates but leave the decision to the reviewer', () => {
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN' },
        { no: 1, desc: 'Papan nama', vol: 1, unit: 'bh', price: 500000 },
      ]),
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], {
      targetVersionType: 'MC0',
      officialAnalyses: [],
      previousItems: [
        { workItemId: 'w1', code: 'WI-0001', description: 'Papan  Nama', groupPath: 'A' },
        { workItemId: 'w2', code: 'WI-0002', description: 'Papan nama', groupPath: 'B' },
      ],
    });
    const item = draft.rows.find((r) => r.rowType === 'ITEM')!;
    expect(item.workItemCandidates.map((c) => c.workItemId)).toEqual(['w1']);
    expect(draft.issues).toContainEqual(expect.objectContaining({ code: 'WORK_ITEM_UNDECIDED', rowKey: item.key, resolvedBy: ['WORK_ITEM_MATCH'] }));
  });

  it('accepts supporting documents without a RAB sheet; their analyses are only reviewed candidates (regression)', () => {
    const block = analysisBlock(5, { seq: 1, code: 'A.1', name: 'GALIAN DI FILE ANALISA', unit: 'm3', components: [{ category: 'TENAGA', name: 'Pekerja', unit: 'OH', coef: 0.5, price: 100000 }] });
    const other = analysisBlock(30, { seq: 2, code: 'B.7', name: 'TIDAK DIPAKAI', unit: 'm2', components: [{ category: 'TENAGA', name: 'Mandor', unit: 'OH', coef: 1, price: 1 }] });
    const rab = workbookOf(
      {
        'RAB + PPN': rabSheet([
          { no: 'A', desc: 'P' },
          // Price comes from another file: not provable inside this workbook.
          { no: 1, desc: 'Galian', vol: 3, unit: 'm3', code: 'A.1', price: [`'[1]REKAP ANALISA'!E6`, 55000] },
          { no: 2, desc: 'Galian beda harga', vol: 3, unit: 'm3', code: 'A.1', price: [`'[1]REKAP ANALISA'!E6`, 60000] },
        ]),
      },
      'rab',
    );
    const support = workbookOf({ ANALISA: { ...block.cells, ...other.cells } }, 'support');
    const draft = buildDraft(
      [
        { model: rab, documentId: 'rab', filename: 'rab.xlsx', sha256: 'a' },
        { model: support, documentId: 'support', filename: 'analisa.xlsx', sha256: 'b', role: 'SUPPORT' },
      ],
      contract,
    );
    expect(draft.sources.map((x) => [x.filename, x.role, x.sheet, x.analysisSheets])).toEqual([
      ['rab.xlsx', 'RAB', 'RAB + PPN', []],
      ['analisa.xlsx', 'SUPPORT', null, ['ANALISA']],
    ]);
    const [galian, beda] = draft.rows.filter((r) => r.rowType === 'ITEM');
    expect(galian!.price.kind).toBe('UNRESOLVED');
    expect(galian!.analysisCandidates).toEqual([expect.objectContaining({ analysisVersionId: null, analysisKey: '1:ANALISA:5', price: '55000', origin: 'RULE', reason: expect.stringContaining('lintas file') })]);
    expect(beda!.analysisCandidates).toEqual([]); // different price: no candidate
    expect(draft.issues.find((i) => i.rowKey === galian!.key)).toMatchObject({ code: 'ANALYSIS_UNRESOLVED', resolvedBy: ['ANALYSIS_LINK', 'DIRECT_PRICE'] });
    // Candidate kept for review but not imported unless linked; unrelated analyses are dropped.
    expect(draft.analyses.map((a) => [a.code, a.candidateOnly])).toEqual([['A.1', true]]);
    expect(draft.stats).toMatchObject({ analysesImported: 0, components: 0, pricesImported: 0 });
    expect(draft.analyses[0]!.locator.documentId).toBe('support');
  });

  it('reconciles cached Excel values within Rp 0.000001 and records the evidence; RAB prices stay exact (D-054 regression)', () => {
    const build = (cachedAmount: number, rabPrice: number) => {
      const block = analysisBlock(5, { seq: 1, code: 'A.1', name: 'X', unit: 'm3', overhead: null, components: [{ category: 'TENAGA', name: 'Pekerja', unit: 'OH', coef: 0.5, price: 100000 }] });
      block.cells.H8 = ['G8*F8', cachedAmount];
      return buildDraft(
        [
          {
            model: workbookOf({
              'RAB + PPN': rabSheet([
                { no: 'A', desc: 'P' },
                { no: 1, desc: 'Item', vol: 1, unit: 'm3', code: 'A.1', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, rabPrice] },
              ]),
              'REKAP ANALISA': { A6: 1, B6: ['VLOOKUP(A6,ANALISA!A$5:H$500,2,FALSE)', 'A.1'], E6: ['VLOOKUP(A6,ANALISA!A$5:H$500,8,FALSE)', rabPrice] },
              ANALISA: block.cells,
            }),
            documentId: 'd',
            filename: 'f',
            sha256: 's',
          },
        ],
        contract,
      );
    };
    const ok = build(50000.0000005, 50000);
    const entry = ok.analyses[0]!.reconciliation.find((e) => e.what.includes('Pekerja'))!;
    expect(entry).toMatchObject({ exact: '50000', tolerance: '0.000001', rule: 'ABS_0.000001', matches: true });
    expect(Number(entry.diff)).toBeCloseTo(0.0000005, 9); // the float nearest 50000.0000005 is 50000.000000499997
    expect(ok.issues.filter((i) => i.code === 'RECONCILIATION')).toEqual([]);

    const off = build(50000.000002, 50000);
    expect(off.issues).toContainEqual(expect.objectContaining({ code: 'RECONCILIATION', message: expect.stringMatching(/selisih 0\.000002.* toleransi 0\.000001/) }));

    // A RAB price differing by less than the tolerance is still a PRICE_MISMATCH: no tolerance there.
    const price = build(50000, 50000.0000001);
    expect(price.issues).toContainEqual(expect.objectContaining({ code: 'PRICE_MISMATCH' }));
  });
});

describe('acceptance gaps (ACCEPTANCE_TESTS K)', () => {
  it('volume 0 keeps the item and its analysis; coefficient 0 and blank coefficients stay as traced components', () => {
    const block = analysisBlock(5, {
      seq: 1,
      code: 'A.1',
      name: 'GALIAN',
      unit: 'm3',
      components: [
        { category: 'TENAGA', name: 'Pekerja', unit: 'OH', coef: 0.5, price: 100000 },
        { category: 'TENAGA', name: 'Kepala Tukang', unit: 'OH', coef: 0, price: 200000 },
        { category: 'TENAGA', name: 'Mandor', unit: 'OH', coef: null, price: 220000 },
      ],
    });
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN TANAH' },
        { no: 1, desc: 'Galian cadangan', vol: 0, unit: 'm3', code: 'A.1', price: recapLookup(14, block.price) },
      ]),
      'REKAP ANALISA': recap([{ seq: 1, code: 'A.1', price: block.price }]),
      ANALISA: block.cells,
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    const item = draft.rows.find((r) => r.rowType === 'ITEM')!;
    expect(item).toMatchObject({ volume: '0', price: { kind: 'ANALYSIS' } });
    const a = draft.analyses[0]!;
    expect(a.usedByRows).toEqual([item.key]);
    expect(a.components.map((c) => [c.description, c.coefficient, c.amount])).toEqual([
      ['Pekerja', '0.5', '50000'],
      ['Kepala Tukang', '0', '0'],
      ['Mandor', '0', '0'],
    ]);
    expect(a.computed.price).toBe('55000');
    expect(draft.issues.filter((i) => i.code === 'BLANK_COEFFICIENT')).toHaveLength(1); // only the blank one warns
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('one RAB sheet and one analysis sheet holding Struktur, Arsitektur and MEP map without splitting files', () => {
    const blocks = [
      analysisBlock(5, { seq: 1, code: 'S.1', name: 'BETON K-250', unit: 'm3', components: [{ category: 'BAHAN', name: 'Semen', unit: 'kg', coef: 300, price: 1500 }] }),
      analysisBlock(30, { seq: 2, code: 'A.1', name: 'PLESTERAN 1:4', unit: 'm2', components: [{ category: 'BAHAN', name: 'Semen', unit: 'kg', coef: 5, price: 1500 }] }),
      analysisBlock(55, { seq: 3, code: 'M.1', name: 'TITIK LAMPU', unit: 'titik', components: [{ category: 'TENAGA', name: 'Instalatir', unit: 'OH', coef: 0.2, price: 150000 }] }),
    ];
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN STRUKTUR' },
        { no: 1, desc: 'Beton kolom', vol: 2, unit: 'm3', code: 'S.1', price: recapLookup(14, blocks[0]!.price) },
        { no: 'B', desc: 'PEKERJAAN ARSITEKTUR' },
        { no: 1, desc: 'Plester dinding', vol: 40, unit: 'm2', code: 'A.1', price: recapLookup(16, blocks[1]!.price) },
        { no: 'C', desc: 'PEKERJAAN MEP' },
        { no: 1, desc: 'Titik lampu', vol: 12, unit: 'titik', code: 'M.1', price: recapLookup(18, blocks[2]!.price) },
      ]),
      'REKAP ANALISA': recap(blocks.map((b, i) => ({ seq: i + 1, code: ['S.1', 'A.1', 'M.1'][i]!, price: b.price }))),
      ANALISA: Object.assign({}, ...blocks.map((b) => b.cells)),
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    const items = draft.rows.filter((r) => r.rowType === 'ITEM');
    expect(items.map((r) => [r.groupPath, analysisCode(draft, r.price.analysisKey)])).toEqual([
      ['A', 'S.1'],
      ['B', 'A.1'],
      ['C', 'M.1'],
    ]);
    // Discipline hierarchy kept as sections of the one version.
    expect(draft.rows.filter((r) => r.rowType === 'SECTION').map((r) => r.description)).toEqual(['PEKERJAAN STRUKTUR', 'PEKERJAAN ARSITEKTUR', 'PEKERJAAN MEP']);
    expect(new Set(draft.analyses.map((a) => a.locator.sheet))).toEqual(new Set(['ANALISA']));
    expect(draft.issues.filter((i) => i.severity === 'BLOCKING')).toEqual([]);
  });

  it('a title row without code, volume or price is a group, not a direct-price item', () => {
    const model = workbookOf({
      'RAB + PPN': rabSheet([
        { no: 'A', desc: 'PEKERJAAN PERSIAPAN' },
        { no: 1, desc: 'Pekerjaan Pagar Sementara', price: [`IFERROR(VLOOKUP(F14,'REKAP ANALISA'!B$6:E$100,4,FALSE),0)`, 0] },
        { no: null, desc: 'Pagar seng', vol: 50, unit: 'm1', price: 85000 },
      ]),
    });
    const draft = buildDraft([{ model, documentId: 'd1', filename: 'f', sha256: 's' }], contract);
    expect(draft.rows.map((r) => [r.rowType, r.description])).toEqual([
      ['SECTION', 'PEKERJAAN PERSIAPAN'],
      ['PARENT_ITEM', 'Pekerjaan Pagar Sementara'],
      ['ITEM', 'Pagar seng'],
    ]);
    const direct = draft.issues.filter((i) => i.code === 'DIRECT_PRICE');
    expect(direct.map((i) => i.rowKey)).toEqual([draft.rows[2]!.key]);
  });
});

const analysisCode = (draft: ReturnType<typeof buildDraft>, key: string | null | undefined) => draft.analyses.find((a) => a.key === key)?.code;
