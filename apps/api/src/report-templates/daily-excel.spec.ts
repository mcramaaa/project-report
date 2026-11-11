import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { syncProjectCalendar } from '../projects/project-calendar';
import { createProject, createUser, resetDatabase, TEST_PASSWORD } from '../test/db';
import { imageSize } from './daily-excel';
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

describe('daily report Excel export (D-084)', () => {
  it('lays the day out like the office Har sheet: groups, totals, weather, signatures, landscape A4', async () => {
    const project = await createProject(t.prisma, 'XLS-001');
    await t.prisma.$transaction((tx) => syncProjectCalendar(tx, project.id, '2026-01-05', 120));
    const rab = `/projects/${project.id}/rab-versions`;
    const id = (await ok(admin.post(rab, { versionType: 'CONTRACT', documentDate: '2026-01-02' }), 201)).version.id as string;
    const rows = (await ok(admin.post(`${rab}/${id}/items`, { rowType: 'ITEM', description: 'Galian', volume: '100', unit: 'm3', unitPrice: '1000', taxPercent: '0' }), 201)).rows as { description: string; workItemId: string }[];
    const galian = rows.find((r) => r.description === 'Galian')!.workItemId;
    await ok(admin.post(`${rab}/${id}/approve`, { acknowledgeWarnings: true }));
    await ok(admin.post(`/projects/${project.id}/baselines`, { rabVersionId: id, activationMode: 'EXACT_DATE' }), 201);
    await ok(admin.request('PUT', `/projects/${project.id}/progress/weeks/1`, { entries: [{ workItemId: galian, mode: 'VOLUME_WEEK', volume: '70' }] }));
    await ok(
      admin.request('PUT', `/projects/${project.id}/daily-reports/2026-01-06`, {
        baseUpdatedAt: null,
        note: 'Hari ini : Dapat Bekerja',
        resources: [
          { category: 'LABOR', name: 'Project Manager', unit: 'Org', actual: '1' },
          { category: 'LABOR', name: 'Pekerja', unit: 'Org', actual: '10' },
          { category: 'EQUIPMENT', name: 'Cangkul', unit: 'bh', actual: '5' },
          { category: 'MATERIAL', name: 'Semen', unit: 'kg', actual: '1243.3651' },
        ],
        weather: [{ condition: 'CLEAR', fromTime: '08:00', toTime: '17:00' }],
      }),
    );

    const res = await fetch(`${t.baseUrl}/projects/${project.id}/exports/daily/2026-01-06`, { headers: { cookie: admin.cookie! } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('Laporan%20Harian%20XLS-001%202026-01-06.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0]!;
    const texts: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.value))));
    for (const expected of ['LAPORAN HARIAN', 'TENAGA KERJA', 'Staff Kantor', 'Project Manager', 'Tenaga Kerja', 'Pekerja', 'JUMLAH', 'Cangkul', 'Semen', 'Galian', 'KEADAAN CUACA', 'CERAH', '08.00-17.00', 'Hari ini : Dapat Bekerja', 'Diperiksa Oleh :', 'Pelaksana Lapangan'])
      expect(texts, expected).toContain(expected);
    // Labor total 1 + 10 people; material keeps 2 decimals in its number format.
    const find = (v: string) => {
      let at: ExcelJS.Cell | undefined;
      ws.eachRow((row) => row.eachCell((c) => (c.value === v ? (at = c) : undefined)));
      return at!;
    };
    const total = find('JUMLAH');
    expect(ws.getRow(Number(total.row)).values).toContain(11);
    const semen = find('Semen');
    const qty = ws.getRow(Number(semen.row)).getCell(Number(semen.col) + 1);
    expect([qty.value, qty.numFmt]).toEqual([1243.37, '#,##0.00']);
    expect(ws.pageSetup).toMatchObject({ orientation: 'landscape', paperSize: 9, fitToPage: true });
  });

  it('reads PNG and JPEG sizes so logos keep their proportions', () => {
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(1661, 16);
    png.writeUInt32BE(238, 20);
    expect(imageSize(png)).toEqual({ width: 1661, height: 238 });
    // SOI, an APP0 segment, then SOF0 with height 120 and width 300.
    const jpeg = Buffer.from('ffd8ffe000044a46ffc0000b0800780' + '12c' + '03', 'hex');
    expect(imageSize(jpeg)).toEqual({ width: 300, height: 120 });
    expect(imageSize(Buffer.from('nope'))).toBeNull();
  });
});
