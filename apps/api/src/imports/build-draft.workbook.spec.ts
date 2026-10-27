import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDraft } from './build-draft';
import { evaluateImport } from './evaluate';
import { WorkbookModel } from './workbook/workbook-model';

// Office workbooks stay out of Git (storage/temp); these checks run where they are present.
const dir = resolve(__dirname, '../../../../storage/temp');
const penawaranPath = resolve(dir, '00. RAB PENAWARAN SDN 2 SERANGAN.xlsx');
const mingguanPath = resolve(dir, '04. LAPORAN MINGGUAN SDN 2 SERANGAN (MC 0).xlsx');
const available = existsSync(penawaranPath) && existsSync(mingguanPath);

async function model(path: string, id: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return new WorkbookModel(id, path, wb);
}

describe.skipIf(!available)('real workbooks SDN 2 Serangan (storage/temp)', () => {
  let contract: ReturnType<typeof buildDraft>;
  beforeAll(async () => {
    contract = buildDraft([{ model: await model(penawaranPath, 'doc-00'), documentId: 'doc-00', filename: '00', sha256: 'x', rabSheet: 'RAB + PPN' }], {
      targetVersionType: 'CONTRACT',
      officialAnalyses: [],
      previousItems: [],
    });
  }, 120_000);

  it('Kontrak: items trace to analyses, sub-analyses and prices come along, everything reconciles', () => {
    expect(contract.stats).toMatchObject({ items: 416, analysesInWorkbook: 168, analysesImported: 110, subAnalyses: 5, components: 704, pricesImported: 162 });
    expect(contract.workbookTotals).toEqual({ value: '5121250896.4818', rounded: null, valueRaw: '5121250896.4818010' });
    const blocking = contract.issues.filter((i) => i.severity === 'BLOCKING');
    // Only the SMKK items stop at a literal price without breakdown; they need a reviewer decision.
    expect(blocking.map((i) => i.code)).toEqual(Array(8).fill('ANALYSIS_UNRESOLVED'));
    // Recap name kept for the item, original analysis name kept for the analysis (D-047).
    const galian = contract.rows.find((r) => r.description === 'Pek. Galian Pondasi Setempat (pile cap)')!;
    const analysis = contract.analyses.find((a) => a.key === galian.price.analysisKey)!;
    expect(analysis).toMatchObject({ code: 'II.1', unit: 'm3', overheadPercent: '10', roundingScale: 0, computed: { price: '124696' } });
    expect(analysis.name).toMatch(/^PENGGALIAN 1 M3 TANAH BIASA/);
    expect(galian.price.evidence.map((e) => [e.cell, e.via])).toEqual([
      ['RAB + PPN!G22', 'START'],
      ['REKAP ANALISA!E10', 'VLOOKUP'],
      ['ANALISA!H56', 'VLOOKUP'],
      ['ANALISA!H71', 'REF'],
    ]);
  });

  it('Kontrak: every item and the total reconcile with the workbook (D-043, D-054)', () => {
    // The SMKK rows are accepted as direct prices, as the reviewer does; nothing else is decided.
    const decisions = contract.rows
      .filter((r) => r.price.kind === 'UNRESOLVED')
      .map((r) => ({ rowKey: r.key, kind: 'DIRECT_PRICE' as const, value: { accept: true }, reason: 'test', decidedBy: 'u', decidedAt: new Date() }));
    const e = evaluateImport(contract, decisions, new Map());
    expect(e.reconciliation).toMatchObject({ realCost: '5121250896.48', rounded: '5121250896', value: '5121250896.4818', rowsChecked: 416, rowsMismatched: 0, totalStatus: 'MATCH' });
    // Σ cached item amounts (exact) and the total cell (17 digits) both lie within Rp 0.000001.
    expect(e.reconciliation.entries.map((x) => [x.what, x.diff, x.matches])).toEqual([
      ['total nilai vs Σ jumlah item workbook', '0.000000086215', true],
      ['total nilai vs sel total workbook', '0.000001', true],
    ]);
    expect(e.issues.filter((i) => i.code === 'RAB_ROW_MISMATCH' || i.code === 'RAB_TOTAL_MISMATCH')).toEqual([]);
  });

  it('Kontrak: overhead listed but not used by the source price is a warning; the source price stays (D-063)', () => {
    const flagged = contract.analyses.filter((a) => a.unusedOverhead).sort((x, y) => x.locator.row! - y.locator.row!);
    expect(flagged.map((a) => [a.code, a.unusedOverhead, a.overheadPercent, a.computed.price])).toEqual([
      ['VI.6', { percent: '10', overheadCell: 'ANALISA!H660', percentCell: 'ANALISA!E660', directCell: 'ANALISA!H659' }, null, '187390'],
      ['VIII.4', { percent: '10', overheadCell: 'ANALISA!H1268', percentCell: 'ANALISA!E1268', directCell: 'ANALISA!H1267' }, null, '248398'],
      ['XXI.3', { percent: '10', overheadCell: 'ANALISA!H2717', percentCell: 'ANALISA!E2717', directCell: 'ANALISA!H2716' }, null, '2513589'],
    ]);
    const warnings = contract.issues.filter((i) => i.code === 'OVERHEAD_UNUSED');
    expect(warnings.map((i) => i.severity)).toEqual(['WARNING', 'WARNING', 'WARNING']);
    expect(warnings[0]!.message).toContain('overhead 10% tercantum di ANALISA!H660');
    expect(warnings[0]!.message).toContain('187390');
    // Normal analyses (F = D + E) carry their overhead and no warning.
    expect(contract.analyses.filter((a) => a.overheadPercent === '10' && a.unusedOverhead)).toEqual([]);
  });

  it('MC-0 from the weekly workbook: chains stop at the values-only recap; candidates come from official analyses', async () => {
    const official = contract.analyses.map((a, i) => ({ analysisVersionId: `v-${i}`, code: a.code, name: a.name, unit: a.unit, price: a.computed.price }));
    const mc0 = buildDraft([{ model: await model(mingguanPath, 'doc-04'), documentId: 'doc-04', filename: '04', sha256: 'y' }], {
      targetVersionType: 'MC',
      officialAnalyses: official,
      previousItems: [],
    });
    expect(mc0.sources[0]).toMatchObject({ sheet: 'RAB + PPN', block: 'MC - 0' });
    expect(mc0.stats.items).toBe(416);
    expect(mc0.workbookTotals).toEqual({ value: '5121250896.52531', rounded: '5121250896', valueRaw: '5121250896.5253057' });
    const unresolved = mc0.rows.filter((r) => r.price.kind === 'UNRESOLVED');
    expect(unresolved).toHaveLength(416);
    const withCandidate = unresolved.filter((r) => r.analysisCandidates.length === 1);
    expect(withCandidate).toHaveLength(408);
    // SMKK items were direct prices in the contract, so there is no official analysis to propose.
    expect(unresolved.filter((r) => r.analysisCandidates.length === 0).map((r) => r.analysisCode)).toEqual(['XXVI.1', 'XXVI.2', 'XXVI.3', 'XXVI.4', 'XXVI.5', 'XXVI.6', 'XXVI.7', 'XXVI.8']);
  }, 120_000);
});
