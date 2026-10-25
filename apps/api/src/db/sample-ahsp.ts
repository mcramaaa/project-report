import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { rabVersionLabel, type RabImportDetailDto, type RabVersionType } from '@laporan-proyek/shared';
import { checkPackageIsolation, isIsolated, type PackageIsolation } from '../ahsp/package';
import type { AuthUser } from '../auth/auth-context';
import { DocumentsService } from '../documents/documents.service';
import type { RabImportsService } from '../imports/rab-imports.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProjectsService } from '../projects/projects.service';
import type { RabService } from '../rab/rab.service';
import { parseSampleProject, parseSampleWorkbook } from './sample-rab';

/**
 * Development sample (D-053, D-056–D-058): project SDN2-SERANGAN-2026-PAKET built through the regular flows —
 * upload → draft → reviewer decisions (recorded explicitly as the seed admin) → import approval → RAB
 * approval — for Penawaran/Kontrak (workbook 00, full package) and MC-0 (workbook 04, values-only recap, so its
 * package is inherited from Kontrak by copy), then an Addendum through "Buat versi" (copy of MC-0 and its
 * package, left DRAFT: there is no office Addendum document). Verifies every package is isolated.
 * Resumable: every step checks what already exists. Stops before approving when reconciliation fails.
 */
export const AHSP_SAMPLE_CODE = 'SDN2-SERANGAN-2026-PAKET';

export interface AhspSampleServices {
  prisma: PrismaService;
  projects: ProjectsService;
  rab: RabService;
  documents: DocumentsService;
  imports: RabImportsService;
}

export interface AhspSampleReport {
  projectId: string;
  steps: string[];
  contract: VersionReport;
  mc0: VersionReport;
  addendum: PackageReport;
}

/** What a version's own package holds and where its copies came from. */
export interface PackageReport {
  rabVersionId: string;
  status: string;
  realCost: string;
  rounded: string;
  packageAnalyses: number;
  packageComponents: number;
  packagePrices: number;
  /** Copies by the version they were copied from, e.g. { Kontrak: 110 }. */
  copiedFrom: Record<string, number>;
  isolation: PackageIsolation;
}

interface VersionReport extends PackageReport {
  importId: string;
  workbookRealCost: string | null;
  workbookRounded: string | null;
  items: number;
  analysesDirect: number;
  subAnalyses: number;
  analysesImported: number;
  analysesInWorkbook: number;
  components: number;
  prices: number;
  decisions: Record<string, number>;
  reconciliationEntries: number;
}

const SEED_NOTE = 'Seed contoh (D-053): keputusan reviewer dicatat eksplisit oleh admin seed.';

export async function seedAhspSample(s: AhspSampleServices, actor: AuthUser, files: { penawaran: string; mingguan: string }): Promise<AhspSampleReport> {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed contoh tidak boleh dijalankan di production.');
  const steps: string[] = [];

  // 1. Project (identity from the weekly workbook's Data sheet).
  let project = await s.prisma.project.findUnique({ where: { code: AHSP_SAMPLE_CODE }, select: { id: true } });
  if (!project) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files.mingguan);
    const { workbookTotals } = parseSampleWorkbook(wb);
    project = await s.projects.create(actor, parseSampleProject(wb, workbookTotals.contract.rounded, AHSP_SAMPLE_CODE));
    steps.push('proyek dibuat');
  } else {
    steps.push('proyek sudah ada');
  }
  const projectId = project.id;

  // 2. Originals (reused by SHA-256 when already uploaded).
  const docPenawaran = await ensureDocument(s, actor, projectId, files.penawaran, steps);
  const docMingguan = await ensureDocument(s, actor, projectId, files.mingguan, steps);

  // 3. Kontrak.
  const contract = await ensureVersion(s, actor, projectId, 'CONTRACT', docPenawaran, steps, (detail) => contractDecisions(detail));
  // 4. MC-0.
  const mc0 = await ensureVersion(s, actor, projectId, 'MC0', docMingguan, steps, (detail) => mc0Decisions(detail));
  // 5. Addendum: "Buat versi" copies MC-0's items and package (D-057); kept DRAFT.
  let addendum = await s.prisma.rabVersion.findFirst({ where: { projectId, versionType: 'ADDENDUM', status: { not: 'DISCARDED' } }, select: { id: true } });
  if (!addendum) {
    addendum = (await s.rab.create(actor, projectId, { versionType: 'ADDENDUM', documentNumber: 'CONTOH-SEED (bukan dokumen kantor)' })).version;
    steps.push('Addendum 1 dibuat dari MC-0 (DRAFT, salinan paket)');
  }
  const report = { projectId, steps, contract, mc0, addendum: await packageReport(s, projectId, addendum.id) };
  // Isolation proof (D-056): every package keeps its relations inside, and copies point one version back.
  for (const [label, r] of [['Kontrak', report.contract], ['MC-0', report.mc0], ['Addendum', report.addendum]] as const) {
    if (!isIsolated(r.isolation)) throw new Error(`Paket ${label} tidak terisolasi: ${JSON.stringify(r.isolation)}`);
  }
  if (Object.keys(report.contract.copiedFrom).length) throw new Error('Paket Kontrak tidak boleh berisi salinan.');
  if (Object.keys(report.mc0.copiedFrom).join() !== 'Kontrak') throw new Error(`Salinan MC-0 harus dari Kontrak: ${JSON.stringify(report.mc0.copiedFrom)}`);
  if (Object.keys(report.addendum.copiedFrom).join() !== 'MC-0') throw new Error(`Salinan Addendum harus dari MC-0: ${JSON.stringify(report.addendum.copiedFrom)}`);
  return report;
}

async function packageReport(s: AhspSampleServices, projectId: string, rabVersionId: string): Promise<PackageReport> {
  const rab = await s.rab.get(projectId, rabVersionId);
  const own = { analysisVersion: { analysis: { rabVersionId } } };
  const copies = await s.prisma.ahspAnalysisVersion.findMany({
    where: { analysis: { rabVersionId }, copiedFromId: { not: null } },
    select: { copiedFrom: { select: { analysis: { select: { rabVersion: { select: { versionType: true, revisionNumber: true } } } } } } },
  });
  const copiedFrom: Record<string, number> = {};
  for (const c of copies) {
    const label = rabVersionLabel(c.copiedFrom!.analysis.rabVersion);
    copiedFrom[label] = (copiedFrom[label] ?? 0) + 1;
  }
  return {
    rabVersionId,
    status: rab.version.status,
    realCost: rab.totals.realCost,
    rounded: rab.totals.rounded,
    packageAnalyses: await s.prisma.ahspAnalysis.count({ where: { rabVersionId } }),
    packageComponents: await s.prisma.ahspComponent.count({ where: own }),
    packagePrices: await s.prisma.priceItem.count({ where: { priceList: { rabVersionId } } }),
    copiedFrom,
    isolation: await checkPackageIsolation(s.prisma, rabVersionId),
  };
}

async function ensureDocument(s: AhspSampleServices, actor: AuthUser, projectId: string, path: string, steps: string[]): Promise<string> {
  const buffer = await readFile(path);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const existing = await s.prisma.projectDocument.findFirst({ where: { projectId, sha256 }, select: { id: true } });
  if (existing) return existing.id;
  const [doc] = await s.documents.upload(actor, projectId, [{ originalname: Buffer.from(basename(path), 'utf8').toString('latin1'), mimetype: 'application/octet-stream', size: buffer.length, buffer }]);
  steps.push(`dokumen diunggah: ${basename(path)}`);
  return doc!.id;
}

type Decision = Parameters<RabImportsService['decide']>[3]['decisions'][number];

async function ensureVersion(
  s: AhspSampleServices,
  actor: AuthUser,
  projectId: string,
  versionType: RabVersionType,
  documentId: string,
  steps: string[],
  decisionsFor: (detail: RabImportDetailDto) => Decision[],
): Promise<VersionReport> {
  const label = versionType === 'CONTRACT' ? 'Kontrak' : 'MC-0';
  // Latest usable run for this version: approved, or one still in review.
  let run = await s.prisma.rabImport.findFirst({
    where: { projectId, targetVersionType: versionType, status: { in: ['APPROVED', 'NEEDS_REVIEW', 'UPLOADED', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  if (!run) {
    const created = await s.imports.create(actor, projectId, { targetVersionType: versionType, sources: [{ documentId, role: 'RAB', rabSheet: 'RAB + PPN' }] });
    await s.imports.waitFor(created.id);
    run = { id: created.id, status: 'UPLOADED' };
    steps.push(`impor ${label} dibuat`);
  } else if (run.status === 'UPLOADED' || run.status === 'PROCESSING') {
    await s.imports.process(run.id);
  }
  let detail = await s.imports.get(projectId, run.id);
  if (detail.import.status === 'FAILED') throw new Error(`Impor ${label} gagal: ${detail.import.errorMessage}`);

  if (detail.import.status === 'NEEDS_REVIEW') {
    const todo = decisionsFor(detail);
    if (todo.length) {
      detail = await s.imports.decide(actor, projectId, run.id, { decisions: todo });
      steps.push(`impor ${label}: ${todo.length} keputusan reviewer dicatat`);
    }
    const blocking = detail.issues.filter((i) => i.severity === 'BLOCKING');
    if (blocking.length) throw new Error(`Impor ${label} masih punya ${blocking.length} masalah, mis.: ${blocking[0]!.message}`);
    // Reconciliation gate: totals and every cached-Excel comparison must match before approving.
    const failed = detail.draft!.analyses.flatMap((a) => a.reconciliation.filter((r) => !r.matches).map((r) => `${a.code} ${r.what}`));
    if (failed.length) throw new Error(`Rekonsiliasi analisa ${label} gagal: ${failed.slice(0, 5).join('; ')}`);
    if (detail.reconciliation?.matches === false) {
      throw new Error(`Total ${label} ${detail.reconciliation.realCost} ≠ workbook ${detail.reconciliation.workbookRealCost} (dibulatkan ${detail.reconciliation.rounded} vs ${detail.reconciliation.workbookRounded}).`);
    }
    detail = await s.imports.approve(actor, projectId, run.id);
    steps.push(`impor ${label} di-approve`);
  }

  const rabVersionId = detail.import.rabVersionId!;
  const version = await s.prisma.rabVersion.findUniqueOrThrow({ where: { id: rabVersionId }, select: { status: true } });
  if (version.status === 'DRAFT') {
    await s.rab.approve(actor, projectId, rabVersionId, true);
    steps.push(`RAB ${label} di-approve (M4)`);
  }
  const draft = detail.draft!;
  const decisions = await s.prisma.rabImportDecision.groupBy({ by: ['kind'], where: { importId: run.id }, _count: true });
  const subKeys = new Set(draft.analyses.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'ANALYSIS' ? [c.source.analysisKey] : []))));
  const imported = draft.analyses.filter((a) => !a.candidateOnly);
  return {
    ...(await packageReport(s, projectId, rabVersionId)),
    importId: run.id,
    workbookRealCost: detail.reconciliation?.workbookRealCost ?? null,
    workbookRounded: detail.reconciliation?.workbookRounded ?? null,
    items: draft.stats.items,
    analysesDirect: imported.filter((a) => a.usedByRows.length > 0).length,
    subAnalyses: imported.filter((a) => subKeys.has(a.key)).length,
    analysesImported: imported.length,
    analysesInWorkbook: draft.stats.analysesInWorkbook,
    components: draft.stats.components,
    prices: draft.stats.pricesImported,
    decisions: Object.fromEntries(decisions.map((d) => [d.kind, d._count])),
    reconciliationEntries: imported.reduce((n, a) => n + a.reconciliation.length, 0),
  };
}

const openIssue = (detail: RabImportDetailDto, rowKey: string, code: string) => detail.issues.some((i) => i.rowKey === rowKey && i.code === code);

/** Kontrak: only the SMKK rows stop at a literal price without breakdown; accept them as direct prices. */
function contractDecisions(detail: RabImportDetailDto): Decision[] {
  return detail
    .draft!.rows.filter((r) => r.rowType === 'ITEM' && openIssue(detail, r.key, 'ANALYSIS_UNRESOLVED') && r.analysisCandidates.length === 0)
    .map((r) => ({ rowKey: r.key, kind: 'DIRECT_PRICE' as const, value: { accept: true as const }, reason: `${SEED_NOTE} Harga literal di sheet ANALISA tanpa rincian komponen (${r.price.stoppedAt?.cell}).` }));
}

/**
 * MC-0: workbook 04 has no analyses, chains stop at the values-only recap (D-058). Link rows to the single
 * candidate from the Kontrak package (same code, unit, price) — approval copies it into the MC-0 package —
 * accept SMKK direct prices, and match work items with a single candidate (same group path and name), each
 * as an explicit decision; anything ambiguous stops the seed.
 */
function mc0Decisions(detail: RabImportDetailDto): Decision[] {
  const out: Decision[] = [];
  for (const r of detail.draft!.rows.filter((x) => x.rowType === 'ITEM')) {
    if (openIssue(detail, r.key, 'ANALYSIS_UNRESOLVED')) {
      if (r.analysisCandidates.length === 1 && r.analysisCandidates[0]!.analysisVersionId) {
        out.push({ rowKey: r.key, kind: 'ANALYSIS_LINK', value: { analysisVersionId: r.analysisCandidates[0]!.analysisVersionId }, reason: `${SEED_NOTE} ${r.analysisCandidates[0]!.reason}` });
      } else if (r.analysisCandidates.length === 0) {
        out.push({ rowKey: r.key, kind: 'DIRECT_PRICE', value: { accept: true }, reason: `${SEED_NOTE} Sama dengan Kontrak: harga langsung (SMKK).` });
      } else {
        throw new Error(`MC-0 ${r.description}: ${r.analysisCandidates.length} kandidat analisa; perlu review manual.`);
      }
    }
    if (openIssue(detail, r.key, 'WORK_ITEM_UNDECIDED')) {
      if (r.workItemCandidates.length > 1) throw new Error(`MC-0 ${r.description}: ${r.workItemCandidates.length} kandidat pekerjaan; perlu review manual.`);
      out.push({
        rowKey: r.key,
        kind: 'WORK_ITEM_MATCH',
        value: { workItemId: r.workItemCandidates[0]?.workItemId ?? null },
        reason: `${SEED_NOTE} ${r.workItemCandidates.length ? 'Jalur kelompok dan uraian sama dengan Kontrak.' : 'Tidak ada pasangan di Kontrak: pekerjaan baru.'}`,
      });
    }
  }
  return out;
}

