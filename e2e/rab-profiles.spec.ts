import ExcelJS from 'exceljs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ORIGIN = { Origin: process.env.E2E_BASE_URL ?? 'http://localhost:3100' };

async function call(req: APIRequestContext, method: 'POST', url: string, data: unknown) {
  const res = await req.fetch(`/api${url}`, { method, data, headers: ORIGIN });
  expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** BOQ whose quantity column is titled "Banyaknya": the built-in profile does not know that word. */
async function boqWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  const header = { B3: 'No. Mata Pembayaran', D3: 'Uraian', E3: 'Satuan', F3: 'Banyaknya', G3: 'Harga Satuan', H3: 'Jumlah Harga' };
  for (const [cell, value] of Object.entries(header)) ws.getCell(cell).value = value;
  const rows: [string, string, string, number, number][] = [
    ['1.2', 'Mobilisasi', 'LS', 1, 2500000],
    ['1.3', 'Pengukuran', 'LS', 2, 750000],
  ];
  rows.forEach(([code, name, unit, qty, price], i) => {
    const r = 4 + i;
    ws.getCell(`B${r}`).value = code;
    ws.getCell(`D${r}`).value = name;
    ws.getCell(`E${r}`).value = unit;
    ws.getCell(`F${r}`).value = qty;
    ws.getCell(`G${r}`).value = price;
    ws.getCell(`H${r}`).value = { formula: `F${r}*G${r}`, result: qty * price };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function setupProject(page: Page): Promise<string> {
  const req = page.request;
  await call(req, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  const iso = new Date().toISOString().slice(0, 10);
  const code = `E2E-${Date.now()}`;
  const project = await call(req, 'POST', '/projects', {
    code,
    activityName: 'Kegiatan E2E',
    subActivityName: 'Sub E2E',
    projectName: `Proyek ${code}`,
    location: 'Lokasi',
    fiscalYear: new Date().getUTCFullYear(),
    contractorName: 'Kontraktor',
    consultantName: 'Konsultan',
    contractNumber: 'K-1',
    contractDate: iso,
    contractValue: '1000000',
    spmkNumber: 'S-1',
    spmkDate: iso,
    startDate: iso,
    durationDays: 56,
  });
  const id = (project.project ?? project).id as string;
  const upload = await req.fetch(`/api/projects/${id}/documents`, {
    method: 'POST',
    headers: ORIGIN,
    multipart: {
      files: {
        name: 'boq.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await boqWorkbook(),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  return id;
}

test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD (a system admin on the dev server).');

let projectId: string | undefined;

// Close (never delete) the test project so dev project lists stay clean.
test.afterEach(async ({ page }) => {
  if (projectId)
    await call(page.request, 'POST', `/projects/${projectId}/close`, { reason: 'Proyek uji E2E selesai' });
});

test('profile playground: preview, adjust a header word, save, and import with the profile', async ({ page }) => {
  const id = (projectId = await setupProject(page));
  await page.goto(`/projects/${id}/imports`);
  await page.getByRole('link', { name: 'Profil pemetaan' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/imports/profiles$`));

  // Every sheet of the document is offered, not only the built-in candidates (BOQ is none of them).
  await page.getByRole('checkbox', { name: 'Pakai boq.xlsx' }).check();
  await page.getByRole('combobox', { name: 'Sheet RAB boq.xlsx' }).click();
  await page.getByRole('option', { name: 'BOQ', exact: true }).click();

  // With the built-in profile the reader stops on the unknown quantity title.
  await page.getByRole('button', { name: 'Pratinjau' }).click();
  const result = page.getByRole('region', { name: 'Hasil pratinjau' });
  await expect(result.getByRole('alert')).toContainText('BOQ');

  // Teach the header-word reader the quantity title, then preview again: both items are read as direct prices.
  const quantity = page.locator('#headerless-quantity-0-words');
  await quantity.fill('KUANTITAS, banyaknya');
  await quantity.blur();
  await expect(quantity).toHaveValue('KUANTITAS, BANYAKNYA');
  await page.locator('#pg-name').fill('BOQ dinas');
  await expect(page.getByRole('button', { name: 'Buat run impor dengan profil ini' })).toBeDisabled();
  await page.getByRole('button', { name: 'Pratinjau' }).click();
  await expect(result.getByText('Item pekerjaan', { exact: true }).locator('..')).toContainText('2');
  await expect(result.getByText('Harga langsung', { exact: true }).locator('..')).toContainText('2');
  await expect(result).toContainText('dibaca dari kata header');

  // A run can only use a saved profile.
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profil "BOQ dinas" disimpan' })).toBeVisible();
  await page.getByRole('button', { name: 'Buat run impor dengan profil ini' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/imports/[0-9a-f-]{36}$`));
  await expect(page.getByText('Perlu review').first()).toBeVisible({ timeout: 30_000 });
});
