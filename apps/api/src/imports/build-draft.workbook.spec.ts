import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDraft } from './build-draft';
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
    expect(contract.stats).toEqual({ items: 416, analysesInWorkbook: 168, analysesImported: 110, subAnalyses: 5, components: 704, pricesImported: 162 });
    expect(contract.workbookTotals).toEqual({ value: '5121250896.4818', rounded: null });
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

  it('MC-0 from the weekly workbook: chains stop at the values-only recap; candidates come from official analyses', async () => {
    const official = contract.analyses.map((a, i) => ({ analysisVersionId: `v-${i}`, code: a.code, name: a.name, unit: a.unit, price: a.computed.price }));
    const mc0 = buildDraft([{ model: await model(mingguanPath, 'doc-04'), documentId: 'doc-04', filename: '04', sha256: 'y' }], {
      targetVersionType: 'MC0',
      officialAnalyses: official,
      previousItems: [],
    });
    expect(mc0.sources[0]).toMatchObject({ sheet: 'RAB + PPN', block: 'MC - 0' });
    expect(mc0.stats.items).toBe(416);
    expect(mc0.workbookTotals).toEqual({ value: '5121250896.52531', rounded: '5121250896' });
    const unresolved = mc0.rows.filter((r) => r.price.kind === 'UNRESOLVED');
    expect(unresolved).toHaveLength(416);
    const withCandidate = unresolved.filter((r) => r.analysisCandidates.length === 1);
    expect(withCandidate).toHaveLength(408);
    // SMKK items were direct prices in the contract, so there is no official analysis to propose.
    expect(unresolved.filter((r) => r.analysisCandidates.length === 0).map((r) => r.analysisCode)).toEqual(['XXVI.1', 'XXVI.2', 'XXVI.3', 'XXVI.4', 'XXVI.5', 'XXVI.6', 'XXVI.7', 'XXVI.8']);
  }, 120_000);
});
