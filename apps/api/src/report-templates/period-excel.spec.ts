import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { numberWithWords, officeItemLines, roman, type WeeklyReportContent } from '@laporan-proyek/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';

let t: TestApp;
let admin: Client;

async function ok(res: Promise<ApiResponse>, status = 200) {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  Object.assign(t.app.get(LoginRateLimiter), new LoginRateLimiter());
  await createUser(t.prisma, { email: 'admin@example.com', name: 'Super', isSystemAdmin: true });
  admin = new Client(t.baseUrl);
  expect((await admin.login('admin@example.com', TEST_PASSWORD)).status).toBe(200);
});

describe('office weekly pack (D-085)', () => {
  it('words, roman numerals and group totals follow the workbook', () => {
    expect(numberWithWords(21)).toBe('21 (DUA PULUH SATU)');
    expect(numberWithWords(110)).toBe('110 (SERATUS SEPULUH)');
    expect(roman(8)).toBe('VIII');
    const row = (id: string, rowType: 'SECTION' | 'ITEM', volume: string | null, cumulative = '0') =>
      ({ id, rowType, displayNumber: id, description: id, unit: 'm3', baselineVolume: volume, previousCumulative: '0', thisWeek: null, cumulative, percent: null }) as unknown as WeeklyReportContent['items'][number];
    const content = {
      recap: [{ id: 'A', weight: '60' }, { id: 'B', weight: '40' }],
      items: [row('A', 'SECTION', null), row('a1', 'ITEM', '10', '5'), row('B', 'SECTION', null), row('b1', 'ITEM', '4', '4')],
      itemWeights: { a1: '60', b1: '40' },
    } as unknown as WeeklyReportContent;
    const out = officeItemLines(content);
    expect(out.lines.filter((l) => l.kind === 'total')).toEqual([
      { kind: 'total', name: 'JUMLAH', weight: '60', share: '30' },
      { kind: 'total', name: 'JUMLAH', weight: '40', share: '40' },
    ]);
    expect([out.weight, out.share]).toEqual(['100', '70']);
  });

  it('exports cover, rekap, progress and time schedule sheets with item bobot', async () => {
    const project = await createProject(t.prisma, 'WK-001');
    await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 56));
    const rab = `/projects/${project.id}/rab-versions`;
    const id = (await ok(admin.post(rab, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
    await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Galian', volume: '100', unit: 'm3', unitPrice: '3000', taxPercent: '0' }), 201);
    const rows = (await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Urugan', volume: '10', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201)).rows as { description: string; workItemId: string }[];
    const galian = rows.find((r) => r.description === 'Galian')!.workItemId;
    await ok(admin.post(`${rab}/${id}/approve`, { acknowledgeWarnings: true }));
    await ok(admin.post(`/projects/${project.id}/baselines`, { rabVersionId: id, activationMode: 'EXACT_DATE' }), 201);
    await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '50' }] }));

    const res = await fetch(`${t.baseUrl}/projects/${project.id}/exports/weekly/1`, { headers: { cookie: admin.cookie! } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('Laporan%20Mingguan%20WK-001%20M.1.xlsx');
    const raw = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(raw as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['C.1', 'RM.1', 'M.1', 'Curva S M.1']);
    expect(wb.worksheets[0]!.pageSetup.orientation).toBe('portrait');
    const texts = (i: number) => {
      const out: unknown[] = [];
      wb.worksheets[i]!.eachRow((r) => r.eachCell((c) => out.push(c.value)));
      return out;
    };
    expect(texts(0)).toContain('MINGGU KE   :   1 (SATU)');
    // Galian = 300 000 of 310 000 → bobot 96,774 %, half done → 48,387 % of the project.
    const m = texts(2);
    expect(m).toEqual(expect.arrayContaining(['Galian', 96.774, 48.387, 'JUMLAH TOTAL', 100]));
    expect(texts(1)).toContain('REALISASI PROGRES :');
    // Time schedule: deviation row and a native line chart over the week columns (plan and actual cumulative).
    expect(texts(3)).toEqual(expect.arrayContaining(['RENCANA KUMULATIF', 'REALISASI KUMULATIF', 'DEVIASI']));
    const zip = await JSZip.loadAsync(raw);
    const chart = await zip.file('xl/charts/chart1.xml')!.async('string');
    expect(chart).toContain("'Curva S M.1'!$E$");
    expect(chart.match(/<c:ser>/g)).toHaveLength(2);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('/xl/charts/chart1.xml');
  });
});
