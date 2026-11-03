import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, TEST_PASSWORD } from '../test/db';
import { Client, startApp, type ApiResponse, type TestApp } from '../test/http';
import { matchItems, progressItemRows } from './weekly-workbook';
import { cellsOf, rowsOf, setCells, UnsafeWorkbookError, Xlsx } from './workbook-xml';

let t: TestApp;
let admin: Client;

async function ok(res: Promise<ApiResponse>, status = 200) {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** A two-week office workbook: M.n rows compute K = R*G/100 (row 23 as a shared formula), C.n is the cover. */
async function officeWorkbook(names: [string, number][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const week of [1, 2]) {
    wb.addWorksheet(`C.${week}`).getCell('C14').value = 'LAPORAN MINGGUAN';
    const ws = wb.addWorksheet(`M.${week}`);
    ws.getCell('D3').value = 'PROGRES MINGGUAN';
    names.forEach(([name, volume], i) => {
      const r = 22 + i;
      ws.getCell(`D${r}`).value = name;
      ws.getCell(`G${r}`).value = volume;
      ws.getCell(`R${r}`).value = 99;
      ws.getCell(`R${r}`).numFmt = '0.00';
      ws.getCell(`K${r}`).value = { formula: `+R${r}*G${r}/100`, result: 0 };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const inputs = async (buf: Buffer, sheet: string) => {
  const x = await Xlsx.open(buf);
  return [...rowsOf(await x.read(sheet))].flatMap(([, xml]) => cellsOf(xml).filter((c) => c.col === 'R').map((c) => [c.ref, c.value]));
};

describe('office workbook cells (D-086)', () => {
  it('reads item rows from the K = R*G/100 formula and writes values keeping the cell style', async () => {
    const buf = await officeWorkbook([['Galian', 100], ['Urugan', 10]]);
    const x = await Xlsx.open(buf);
    const rows = await progressItemRows(x, 'M.1');
    expect(rows.map((r) => [r.row, r.description, r.volume, r.inputCol])).toEqual([
      [22, 'Galian', '100', 'R'],
      [23, 'Urugan', '10', 'R'],
    ]);
    const xml = await x.read('M.1');
    const style = /<c r="R22" s="(\d+)"/.exec(xml)![1];
    const next = setCells(xml, new Map<string, number | string>([['R22', 12.5], ['S30', 'baru']]));
    expect(next).toContain(`<c r="R22" s="${style}"><v>12.5</v></c>`);
    expect(next).toMatch(/<row r="30"><c r="S30" t="inlineStr"><is><t xml:space="preserve">baru<\/t><\/is><\/c><\/row>/);
  });

  it('refuses formulas that fetch outside data before printing on the server', async () => {
    const safe = await Xlsx.open(await officeWorkbook([['Galian', 100]]));
    await expect(safe.stripOutsideData()).resolves.toBeUndefined();
    for (const formula of ['WEBSERVICE("http://169.254.169.254/")', "INDIRECT(\"'file:///etc/passwd'#$A1\")", '[1]Sheet1!A1']) {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('M.1').getCell('A1').value = { formula, result: 0 };
      const x = await Xlsx.open(Buffer.from(await wb.xlsx.writeBuffer()));
      await expect(x.stripOutsideData(), formula).rejects.toBeInstanceOf(UnsafeWorkbookError);
    }
  });

  it('pairs by position when counts agree and by name otherwise', () => {
    const row = (n: number, description: string) => ({ row: n, description, volume: '1', inputCol: 'R' });
    // Cut-short names and unit-only cached text still pair by position.
    expect(matchItems([row(1, 'Pas. Terali Jendela'), row(2, 'm2')], [{ description: 'Pas. Terali Jendela (plat 3x30)' }, { description: 'Plester' }]).unmatched).toEqual([]);
    const byName = matchItems([row(1, 'B'), row(2, 'X')], [{ description: 'A' }, { description: 'B' }, { description: 'C' }]);
    expect(byName.pairs.map(([r, i]) => [r.row, i.description])).toEqual([[1, 'B']]);
    expect(byName.unmatched.map((r) => r.row)).toEqual([2]);
  });
});

describe('weekly export from the office workbook (D-086)', () => {
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

  it('fills cumulative % per item per week, opens on C.n, and refuses a workbook of another RAB', async () => {
    const project = await createProject(t.prisma, 'OFC-001');
    await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 28));
    const rab = `/projects/${project.id}/rab-versions`;
    const id = (await ok(admin.post(rab, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
    await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Galian', volume: '100', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201);
    const rows = (await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Urugan', volume: '10', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201)).rows as { description: string; workItemId: string }[];
    const galian = rows.find((r) => r.description === 'Galian')!.workItemId;
    const urugan = rows.find((r) => r.description === 'Urugan')!.workItemId;
    await ok(admin.post(`${rab}/${id}/approve`, { acknowledgeWarnings: true }));
    await ok(admin.post(`/projects/${project.id}/baselines`, { rabVersionId: id, activationMode: 'EXACT_DATE' }), 201);
    await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '25' }] }));
    await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/2`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '15' }, { workItemId: urugan, mode: 'VOLUME_WEEK', volume: '10' }] }));

    const upload = (buf: Buffer) => admin.upload(`/projects/${project.id}/report-templates/workbooks/WEEKLY`, [{ name: 'LAPORAN MINGGUAN.xlsx', data: buf }]);
    expect((await upload(Buffer.from('bukan excel'))).status).toBe(400);
    expect((await upload(await officeWorkbook([['Galian', 100], ['Urugan', 10]]))).status).toBe(201);
    const list = await ok(admin.get(`/projects/${project.id}/report-templates`));
    expect(list.workbooks).toMatchObject([{ reportType: 'WEEKLY', originalName: 'LAPORAN MINGGUAN.xlsx' }]);

    const res = await fetch(`${t.baseUrl}/projects/${project.id}/exports/weekly/2`, { headers: { cookie: admin.cookie! } });
    expect(res.status).toBe(200);
    const out = Buffer.from(await res.arrayBuffer());
    // Week 1: Galian 25 of 100; week 2: Galian 40 %, Urugan 100 %.
    expect(await inputs(out, 'M.1')).toEqual([['R22', '25'], ['R23', '0']]);
    expect(await inputs(out, 'M.2')).toEqual([['R22', '40'], ['R23', '100']]);
    const x = await Xlsx.open(out);
    const workbookXml = await x.zip.file('xl/workbook.xml')!.async('string');
    expect(workbookXml).toContain('fullCalcOnLoad="1"');
    expect(workbookXml).toMatch(/activeTab="2"/);

    // A workbook from another RAB is refused, not filled into the wrong rows.
    expect((await upload(await officeWorkbook([['Pondasi', 5], ['Atap', 7], ['Cat', 9]]))).status).toBe(201);
    const wrong = await fetch(`${t.baseUrl}/projects/${project.id}/exports/weekly/2`, { headers: { cookie: admin.cookie! } });
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as { message: string }).message).toContain('tidak cocok dengan versi RAB');
    const missing = await fetch(`${t.baseUrl}/projects/${project.id}/exports/weekly/3`, { headers: { cookie: admin.cookie! } });
    expect(((await missing.json()) as { message: string }).message).toContain('sampai M.2');
  });
});
