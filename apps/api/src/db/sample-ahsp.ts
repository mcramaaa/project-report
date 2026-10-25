import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { RabImportDetailDto, RabVersionType } from '@laporan-proyek/shared';
import type { AuthUser } from '../auth/auth-context';
import { DocumentsService } from '../documents/documents.service';
import type { RabImportsService } from '../imports/rab-imports.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProjectsService } from '../projects/projects.service';
import type { RabService } from '../rab/rab.service';
import { parseSampleProject, parseSampleWorkbook } from './sample-rab';

/**
 * Development sample (D-053): project SDN2-SERANGAN-2026-AHSP built through the regular import flow —
 * upload → draft → reviewer decisions (recorded explicitly as the seed admin) → import approval → RAB
 * approval — for Kontrak (workbook 00, full formula chain) and MC-0 (workbook 04, values-only recap).
 * Resumable: every step checks what already exists. Stops before approving when reconciliation fails.
 */
export const AHSP_SAMPLE_CODE = 'SDN2-SERANGAN-2026-AHSP';

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
}

interface VersionReport {
  importId: string;
  rabVersionId: string;
  realCost: string;
  rounded: string;
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
  return { projectId, steps, contract, mc0 };
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
  const rabDetail = await s.rab.get(projectId, rabVersionId);
  const draft = detail.draft!;
  const decisions = await s.prisma.rabImportDecision.groupBy({ by: ['kind'], where: { importId: run.id }, _count: true });
  const subKeys = new Set(draft.analyses.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'ANALYSIS' ? [c.source.analysisKey] : []))));
  const imported = draft.analyses.filter((a) => !a.candidateOnly);
  return {
    importId: run.id,
    rabVersionId,
    realCost: rabDetail.totals.realCost,
    rounded: rabDetail.totals.rounded,
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
 * MC-0: chains stop at the values-only recap. Link rows to the single official analysis candidate (same code,
 * unit, price as the Kontrak analysis), accept SMKK direct prices, and match work items with a single
 * candidate (same group path and name) — each as an explicit decision; anything ambiguous stops the seed.
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

