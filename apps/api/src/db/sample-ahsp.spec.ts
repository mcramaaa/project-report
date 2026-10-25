import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DocumentsService } from '../documents/documents.service';
import { RabImportsService } from '../imports/rab-imports.service';
import { ProjectsService } from '../projects/projects.service';
import { RabService } from '../rab/rab.service';
import { createUser, resetDatabase } from '../test/db';
import { startApp, type TestApp } from '../test/http';
import { AHSP_SAMPLE_CODE, seedAhspSample, type AhspSampleServices } from './sample-ahsp';

// Office workbooks stay out of Git (storage/temp); this runs where they are present.
const dir = resolve(__dirname, '../../../../storage/temp');
const files = { penawaran: resolve(dir, '00. RAB PENAWARAN SDN 2 SERANGAN.xlsx'), mingguan: resolve(dir, '04. LAPORAN MINGGUAN SDN 2 SERANGAN (MC 0).xlsx') };
const available = existsSync(files.penawaran) && existsSync(files.mingguan);

describe.skipIf(!available)('seed SDN2-SERANGAN-2026-AHSP through the import flow (D-053)', () => {
  let t: TestApp;
  let services: AhspSampleServices;
  let actor: { id: string; name: string; email: string; isSystemAdmin: boolean };

  beforeAll(async () => {
    t = await startApp();
    services = { prisma: t.prisma, projects: t.app.get(ProjectsService), rab: t.app.get(RabService), documents: t.app.get(DocumentsService), imports: t.app.get(RabImportsService) };
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    const u = await createUser(t.prisma, { email: 'admin@example.com', name: 'Seed Admin', isSystemAdmin: true });
    actor = { id: u.id, name: u.name, email: u.email, isSystemAdmin: true };
  });

  it('creates linked Kontrak and MC-0 that reconcile with the workbooks; a rerun changes nothing', async () => {
    const report = await seedAhspSample(services, actor, files);
    expect(report.contract).toMatchObject({ realCost: '5121250896.48', rounded: '5121250896', workbookRealCost: '5121250896.48', items: 416, analysesImported: 110, subAnalyses: 5, components: 704, prices: 162 });
    expect(report.mc0).toMatchObject({ realCost: '5121250896.53', rounded: '5121250896', workbookRealCost: '5121250896.53', workbookRounded: '5121250896', items: 416, analysesImported: 0 });
    expect(report.mc0.decisions).toEqual({ ANALYSIS_LINK: 408, WORK_ITEM_MATCH: 416, DIRECT_PRICE: 8 });
    const counts = async () => ({
      projects: await t.prisma.project.count(),
      imports: await t.prisma.rabImport.count(),
      versions: await t.prisma.rabVersion.count(),
      analyses: await t.prisma.ahspAnalysis.count(),
      decisions: await t.prisma.rabImportDecision.count(),
      documents: await t.prisma.projectDocument.count(),
    });
    // Run list with multi-MB drafts must not sort the draft JSON (MySQL "Out of sort memory").
    expect((await services.imports.list(report.projectId)).map((r) => r.status)).toEqual(['APPROVED', 'APPROVED']);
    const before = await counts();
    const again = await seedAhspSample(services, actor, files);
    expect(again.steps).toEqual(['proyek sudah ada']);
    expect(await counts()).toEqual(before);
    expect(await t.prisma.project.findUnique({ where: { code: AHSP_SAMPLE_CODE } })).not.toBeNull();
  }, 240_000);

  it('resumes after a failure in the middle without duplicating anything', async () => {
    let failOnce = true;
    const flaky: AhspSampleServices = {
      ...services,
      imports: new Proxy(services.imports, {
        get(target, prop, receiver) {
          if (prop === 'approve') {
            return async (...args: Parameters<RabImportsService['approve']>) => {
              const run = await t.prisma.rabImport.findUniqueOrThrow({ where: { id: args[2] } });
              if (run.targetVersionType === 'MC0' && failOnce) {
                failOnce = false;
                throw new Error('simulated crash before MC-0 approval');
              }
              return target.approve(...args);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    };
    await expect(seedAhspSample(flaky, actor, files)).rejects.toThrow('simulated crash');
    const mc0 = await t.prisma.rabImport.findFirstOrThrow({ where: { targetVersionType: 'MC0' } });
    expect(mc0.status).toBe('NEEDS_REVIEW'); // decisions recorded, nothing approved
    expect(await t.prisma.rabVersion.count({ where: { versionType: 'MC0' } })).toBe(0);

    const report = await seedAhspSample(services, actor, files);
    expect(report.steps).toEqual(['proyek sudah ada', 'impor MC-0 di-approve', 'RAB MC-0 di-approve (M4)']);
    expect(await t.prisma.rabImport.count({ where: { targetVersionType: 'MC0' } })).toBe(1);
    expect(await t.prisma.rabImportDecision.count({ where: { importId: mc0.id } })).toBe(832);
    expect(report.mc0.realCost).toBe('5121250896.53');
  }, 240_000);
});
