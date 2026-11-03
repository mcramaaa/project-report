import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ServiceUnavailableException } from '@nestjs/common';

const run = promisify(execFile);
const PROFILE = join(tmpdir(), 'laporan-proyek-libreoffice');
// LibreOffice keeps cached formula results of .xlsx files by default; "0" makes it recalculate every formula on load.
// Links to other files are never updated (Content/Update/Link = 1, "never"); the workbook is also stripped of them first.
const RECALC = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
</oor:items>`;

// shortcut: one conversion at a time (LibreOffice locks its profile); fine for a few users, add a worker pool if exports queue up.
let queue: Promise<unknown> = Promise.resolve();

let sandbox: Promise<boolean> | null = null;
const sandboxAvailable = () =>
  (sandbox ??= run('unshare', ['-rn', 'true'], { timeout: 10_000 }).then(
    () => true,
    () => false,
  ));

let available: Promise<boolean> | null = null;
/** Whether LibreOffice can be started; checked once per process (install it, then restart the API). */
export function pdfConverterAvailable(): Promise<boolean> {
  available ??= run(process.env.SOFFICE_PATH || 'soffice', ['--version'], { timeout: 30_000 }).then(
    () => true,
    () => false,
  );
  return available;
}

/** D-086: PDF of a filled office workbook as LibreOffice prints it (print areas, scaling, page setup of the file). */
export function xlsxToPdf(xlsx: Buffer): Promise<Buffer> {
  const job = queue.then(() => convert(xlsx));
  queue = job.catch(() => undefined);
  return job;
}

async function convert(xlsx: Buffer): Promise<Buffer> {
  await mkdir(join(PROFILE, 'user'), { recursive: true });
  await writeFile(join(PROFILE, 'user', 'registrymodifications.xcu'), RECALC);
  const dir = await mkdtemp(join(tmpdir(), 'laporan-pdf-'));
  try {
    await writeFile(join(dir, 'laporan.xlsx'), xlsx);
    const soffice = [process.env.SOFFICE_PATH || 'soffice', `-env:UserInstallation=file://${PROFILE}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, join(dir, 'laporan.xlsx')];
    // Fail closed: the converter only runs without network, and with an environment that carries no secrets.
    if (!(await sandboxAvailable()))
      throw new ServiceUnavailableException('Server tidak mendukung sandbox tanpa jaringan (unshare -rn), jadi PDF format Excel kantor tidak dibuat.');
    try {
      await run('unshare', ['-rn', ...soffice], { timeout: 180_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ServiceUnavailableException('LibreOffice belum terpasang di server, jadi PDF format Excel kantor belum bisa dibuat.');
      throw err;
    }
    return await readFile(join(dir, 'laporan.pdf'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
