import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ORIGIN = { Origin: process.env.E2E_BASE_URL ?? 'http://localhost:3100' };

async function call(req: APIRequestContext, method: 'POST' | 'PUT', url: string, data: unknown) {
  const res = await req.fetch(`/api${url}`, { method, data, headers: ORIGIN });
  expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** A fresh 8-week project (started 4 weeks ago) with one approved RAB and a baseline, so week 1 can be filled. */
async function setupProject(page: Page): Promise<string> {
  const req = page.request;
  await call(req, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 28);
  const iso = start.toISOString().slice(0, 10);
  const code = `E2E-${Date.now()}`;
  const project = await call(req, 'POST', '/projects', {
    code,
    activityName: 'Kegiatan E2E',
    subActivityName: 'Sub E2E',
    projectName: `Proyek ${code}`,
    location: 'Lokasi',
    fiscalYear: start.getUTCFullYear(),
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
  const rab = `/projects/${id}/rab-versions`;
  const version = (await call(req, 'POST', rab, { versionType: 'CONTRACT', documentDate: iso }))
    .version.id as string;
  for (const description of ['Galian tanah', 'Urugan pasir'])
    await call(req, 'POST', `${rab}/${version}/items`, {
      rowType: 'ITEM',
      description,
      volume: '100',
      unit: 'm3',
      unitPrice: '5000',
      taxPercent: '0',
    });
  await call(req, 'POST', `${rab}/${version}/approve`, { acknowledgeWarnings: true });
  await call(req, 'POST', `/projects/${id}/baselines`, {
    rabVersionId: version,
    activationMode: 'EXACT_DATE',
  });
  return id;
}

test.skip(
  !EMAIL || !PASSWORD,
  'Set E2E_EMAIL and E2E_PASSWORD (a system admin on the dev server).',
);

test('progress: fill, save, jump weeks, and read the monthly report', async ({ page }) => {
  const id = await setupProject(page);
  const base = `/projects/${id}/progress`;

  // Fill week 1: the save bar counts the change, saving keeps the value after a reload.
  await page.goto(`${base}/1`);
  await expect(page.getByText('Bisa diisi')).toBeVisible();
  const galian = page.getByLabel('Galian tanah volume minggu ini');
  await galian.fill('25');
  const bar = page.getByRole('region', { name: 'Simpan progres' });
  await expect(bar).toContainText('1 item diubah, belum disimpan.');
  await bar.getByRole('button', { name: 'Simpan progres' }).click();
  await expect(page.getByText('Progres 1 item disimpan.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Galian tanah volume minggu ini')).toHaveAttribute(
    'placeholder',
    '25',
  );

  // Week paging stays on the same tab: last week, first week, and the jump list.
  await page.getByRole('link', { name: 'Laporan mingguan' }).click();
  await expect(page).toHaveURL(`${base}/1/report`);
  await page.getByRole('link', { name: 'Minggu terakhir' }).click();
  await expect(page).toHaveURL(`${base}/8/report`);
  await page.getByRole('link', { name: 'Minggu pertama' }).click();
  await expect(page).toHaveURL(`${base}/1/report`);
  await page.getByLabel('Pilih minggu').selectOption('3');
  await expect(page).toHaveURL(`${base}/3/report`);

  // Monthly report of week 3 is B.1 (weeks 1-4) and carries week 1's progress: 25 of 100 m3, half the RAB = 12.5 %.
  await page.getByRole('link', { name: 'Laporan bulanan' }).click();
  await expect(page).toHaveURL(`${base}/3/monthly`);
  await expect(page.getByText('Laporan bulanan B.1')).toBeVisible();
  for (const w of [1, 2, 3, 4])
    await expect(page.getByRole('link', { name: new RegExp(`^M\\.${w}\\b`) })).toBeVisible();
  await expect(page.getByText('bulan ini 12,500%')).toBeVisible();
});
