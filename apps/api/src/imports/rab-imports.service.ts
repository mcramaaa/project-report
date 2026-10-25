import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  rabImportDraftSchema,
  type AnalysisCandidate,
  type CreateRabImportInput,
  type RabImportDecisionsInput,
  type RabImportDetailDto,
  type RabImportDraft,
  type RabImportSummaryDto,
} from '@laporan-proyek/shared';
import { Decimal } from '@laporan-proyek/calc';
import ExcelJS from 'exceljs';
import { AiClient } from '../ai/ai.client';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import { documentPath } from '../documents/documents.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextWorkItemNumber, RabService, workItemCode } from '../rab/rab.service';
import { buildDraft, DraftInputError, PARSER_VERSION, type OfficialAnalysis, type PreviousItem } from './build-draft';
import { blockingIssues, evaluateImport, type DecisionRecord, type OfficialVersion } from './evaluate';
import { AI_CANDIDATE_RESPONSE_FORMAT, aiCandidateResponseSchema, GUIDE_VERSION, SYSTEM_INSTRUCTION } from './guide/rab-import-guide';
import { WorkbookModel } from './workbook/workbook-model';

export const AI_CLIENT = Symbol('AI_CLIENT');
type Db = Prisma.TransactionClient;

const USER_REF = { select: { id: true, name: true } } as const;
const IMPORT_INCLUDE = {
  creator: USER_REF,
  documents: { include: { document: { select: { id: true, originalFilename: true, sha256: true, storedFilename: true } } }, orderBy: { sortOrder: 'asc' } },
} as const satisfies Prisma.RabImportInclude;
type ImportRow = Prisma.RabImportGetPayload<{ include: typeof IMPORT_INCLUDE }>;

/** Long multi-step approval (hundreds of rows); MySQL keeps it atomic. */
const APPROVE_TX = { timeout: 180_000, maxWait: 20_000 };
const AI_BATCH = 25;

@Injectable()
export class RabImportsService implements OnModuleInit {
  private readonly logger = new Logger(RabImportsService.name);
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rab: RabService,
    @Inject(AI_CLIENT) private readonly ai: AiClient | null,
  ) {}

  /** Runs that were in progress when the API stopped cannot resume; mark them FAILED (retry creates a new run). */
  async onModuleInit(): Promise<void> {
    await this.prisma.rabImport.updateMany({
      where: { status: { in: ['UPLOADED', 'PROCESSING'] } },
      data: { status: 'FAILED', errorMessage: 'Pemrosesan terputus karena server berhenti; gunakan retry.' },
    });
  }

  async list(projectId: string): Promise<RabImportSummaryDto[]> {
    const rows = await this.prisma.rabImport.findMany({ where: { projectId }, include: IMPORT_INCLUDE, orderBy: { createdAt: 'desc' } });
    const official = await this.officialVersions(projectId);
    return Promise.all(rows.map(async (r) => this.summary(r, r.status === 'NEEDS_REVIEW' ? blockingIssues(this.evaluate(r, await this.decisions(r.id), official).issues).length : 0)));
  }

  async get(projectId: string, importId: string): Promise<RabImportDetailDto> {
    const row = await this.find(this.prisma, projectId, importId);
    const decisions = await this.prisma.rabImportDecision.findMany({ where: { importId }, include: { decider: USER_REF }, orderBy: { decidedAt: 'asc' } });
    const aiRuns = await this.prisma.aiRun.findMany({ where: { importId }, orderBy: { startedAt: 'asc' } });
    const draft = row.draft ? (row.draft as unknown as RabImportDraft) : null;
    const evaluation = draft ? evaluateImport(draft, decisions.map(toRecord), await this.officialVersions(projectId)) : null;
    return {
      import: this.summary(row, evaluation && row.status === 'NEEDS_REVIEW' ? blockingIssues(evaluation.issues).length : 0),
      draft,
      issues: evaluation?.issues ?? [],
      decisions: decisions.map((d) => ({
        id: d.id,
        rowKey: d.rowKey,
        kind: d.kind,
        value: d.value,
        reason: d.reason,
        decidedBy: d.decider,
        decidedAt: d.decidedAt.toISOString(),
      })),
      aiRuns: aiRuns.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        instructionVersion: r.instructionVersion,
        model: r.model,
        attempt: r.attempt,
        status: r.status,
        error: r.error,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt.toISOString(),
      })),
      reconciliation: evaluation?.reconciliation ?? null,
    };
  }

  async create(actor: AuthUser, projectId: string, input: CreateRabImportInput, previousImportId: string | null = null): Promise<RabImportSummaryDto> {
    const importId = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
      if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
      if (project.status === 'CLOSED') throw new ConflictException('Proyek sudah ditutup; impor tidak dapat dibuat.');
      const ids = input.sources.map((s) => s.documentId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Dokumen yang sama dipilih lebih dari sekali.');
      const docs = await tx.projectDocument.findMany({ where: { id: { in: ids }, projectId }, select: { id: true } });
      if (docs.length !== ids.length) throw new BadRequestException('Dokumen tidak ditemukan di proyek ini.');
      const attempt = previousImportId ? ((await tx.rabImport.findUnique({ where: { id: previousImportId }, select: { attemptNumber: true } }))?.attemptNumber ?? 0) + 1 : 1;
      const created = await tx.rabImport.create({
        data: {
          projectId,
          targetVersionType: input.targetVersionType,
          attemptNumber: attempt,
          previousImportId,
          guideVersion: GUIDE_VERSION,
          parserVersion: PARSER_VERSION,
          createdBy: actor.id,
          documents: { create: input.sources.map((s, i) => ({ documentId: s.documentId, role: s.role, rabSheet: s.rabSheet ?? null, sortOrder: i })) },
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: previousImportId ? 'RETRY_RAB_IMPORT' : 'CREATE_RAB_IMPORT',
        entityType: 'RAB_IMPORT',
        entityId: created.id,
        projectId,
        newValue: { targetVersionType: input.targetVersionType, sources: input.sources, previousImportId, attempt, guideVersion: GUIDE_VERSION },
      });
      return created.id;
    });
    this.schedule(importId);
    return this.summary(await this.find(this.prisma, projectId, importId), 0);
  }

  /** A retry is a new run linked to the previous one; the old run, its draft and decisions stay as they are. */
  async retry(actor: AuthUser, projectId: string, importId: string): Promise<RabImportSummaryDto> {
    const old = await this.find(this.prisma, projectId, importId);
    if (old.status !== 'FAILED' && old.status !== 'REJECTED') throw new ConflictException('Hanya run yang gagal atau ditolak yang dapat diulang.');
    return this.create(
      actor,
      projectId,
      { targetVersionType: old.targetVersionType, sources: old.documents.map((d) => ({ documentId: d.documentId, role: d.role, rabSheet: d.rabSheet ?? undefined })) },
      old.id,
    );
  }

  /** Waits for background processing (tests, seed). */
  async waitFor(importId: string): Promise<void> {
    await this.inflight.get(importId);
  }

  private schedule(importId: string): void {
    const run = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.process(importId))
      .catch((err: unknown) => this.logger.error(`Impor ${importId} gagal diproses: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => this.inflight.delete(importId));
    this.inflight.set(importId, run);
  }

  /** UPLOADED → PROCESSING → NEEDS_REVIEW, or FAILED for technical/input problems (D-048). */
  async process(importId: string): Promise<void> {
    const { count } = await this.prisma.rabImport.updateMany({ where: { id: importId, status: 'UPLOADED' }, data: { status: 'PROCESSING' } });
    if (count === 0) return;
    const row = await this.prisma.rabImport.findUniqueOrThrow({ where: { id: importId }, include: IMPORT_INCLUDE });
    try {
      const sources = [];
      for (const d of row.documents) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(documentPath(row.projectId, d.document.storedFilename));
        sources.push({
          model: new WorkbookModel(d.documentId, d.document.originalFilename, workbook),
          documentId: d.documentId,
          filename: d.document.originalFilename,
          sha256: d.document.sha256,
          role: d.role,
          rabSheet: d.rabSheet ?? undefined,
        });
      }
      const official = await this.officialVersions(row.projectId);
      const draft = buildDraft(sources, {
        targetVersionType: row.targetVersionType,
        officialAnalyses: [...official.values()] satisfies OfficialAnalysis[],
        previousItems: row.targetVersionType === 'CONTRACT' ? [] : await this.previousItems(row.projectId),
      });
      await this.suggestWithAi(importId, draft, [...official.values()]);
      // Schema validation of the structured draft before it is stored (flow: draft → schema validation).
      const valid = rabImportDraftSchema.parse(draft);
      await this.prisma.rabImport.update({
        where: { id: importId },
        data: { status: 'NEEDS_REVIEW', draft: valid as unknown as Prisma.InputJsonValue, processedAt: new Date(), errorMessage: null },
      });
    } catch (err) {
      const message = err instanceof DraftInputError ? err.message : `Kegagalan teknis: ${err instanceof Error ? err.message : String(err)}`;
      await this.prisma.rabImport.update({ where: { id: importId }, data: { status: 'FAILED', errorMessage: message.slice(0, 2000), processedAt: new Date() } });
      if (!(err instanceof DraftInputError)) this.logger.error(message);
    }
  }

  /**
   * Asks the model for candidates only on rows still without any (D-052). Suggestions must pick from the
   * offered official analyses; anything else is dropped. Every attempt is recorded in ai_runs.
   */
  private async suggestWithAi(importId: string, draft: RabImportDraft, official: OfficialVersion[]): Promise<void> {
    if (!this.ai) return;
    const open = draft.rows.filter((r) => r.rowType === 'ITEM' && r.price.kind === 'UNRESOLVED' && r.analysisCandidates.length === 0);
    const offerFor = (unit: string | null) => official.filter((a) => (a.unit ?? '').toLowerCase() === (unit ?? '').toLowerCase()).slice(0, 40);
    const rows = open.filter((r) => offerFor(r.unit).length > 0);
    for (let i = 0; i < rows.length; i += AI_BATCH) {
      const batch = rows.slice(i, i + AI_BATCH);
      const offered = new Map(batch.map((r) => [r.key, offerFor(r.unit)]));
      const input = batch.map((r) => ({
        rowKey: r.key,
        description: r.description,
        unit: r.unit,
        sourcePrice: r.sourceUnitPrice,
        analysisCode: r.analysisCode,
        stoppedAt: r.price.stoppedAt,
        evidence: r.price.evidence.map((e) => `${e.cell}${e.formula ? ` = ${e.formula}` : ''} → ${String(e.value)}`),
        candidates: offered.get(r.key)!.map((a) => ({ id: a.analysisVersionId, code: a.code, name: a.name, unit: a.unit, price: a.price })),
      }));
      const { result, attempts } = await this.ai.completeJson(aiCandidateResponseSchema, [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: `Usulkan kandidat analisa untuk baris berikut. Format jawaban: ${AI_CANDIDATE_RESPONSE_FORMAT}\n${JSON.stringify({ rows: input })}` },
      ]);
      await this.prisma.aiRun.createMany({
        data: attempts.map((a) => ({
          importId,
          purpose: 'ANALYSIS_CANDIDATES',
          instructionVersion: GUIDE_VERSION,
          model: a.model,
          attempt: a.attempt,
          status: a.status,
          error: a.error,
          response: (a.response ?? undefined) as Prisma.InputJsonValue | undefined,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt,
        })),
      });
      for (const s of result?.suggestions ?? []) {
        const row = batch.find((r) => r.key === s.rowKey);
        const allowed = offered.get(s.rowKey) ?? [];
        if (!row) continue;
        for (const id of s.candidateIds) {
          const a = allowed.find((x) => x.analysisVersionId === id);
          if (!a || row.analysisCandidates.some((c) => c.analysisVersionId === id)) continue;
          row.analysisCandidates.push({
            analysisVersionId: a.analysisVersionId,
            analysisKey: null,
            code: a.code,
            name: a.name,
            unit: a.unit,
            price: a.price,
            reason: `Usulan AI (${GUIDE_VERSION}): ${s.reason}`.slice(0, 1000),
            origin: 'AI',
          } satisfies AnalysisCandidate);
        }
      }
    }
  }

  async decide(actor: AuthUser, projectId: string, importId: string, input: RabImportDecisionsInput): Promise<RabImportDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockReviewable(tx, projectId, importId);
      const draft = row.draft as unknown as RabImportDraft;
      const rows = new Map(draft.rows.map((r) => [r.key, r]));
      const analyses = new Map(draft.analyses.map((a) => [a.key, a]));
      const official = await this.officialVersions(projectId, tx);
      for (const d of input.decisions) {
        const r = rows.get(d.rowKey);
        if (!r || r.rowType !== 'ITEM') throw new BadRequestException(`Baris ${d.rowKey} bukan item pekerjaan di draft ini.`);
        if (d.kind === 'ANALYSIS_LINK') {
          const v = d.value as { analysisKey?: string; analysisVersionId?: string };
          const target = v.analysisKey ? analyses.get(v.analysisKey) : official.get(v.analysisVersionId!);
          if (!target) throw new BadRequestException(`${r.description}: analisa yang dipilih tidak ditemukan.`);
          const unit = target.unit;
          if ((unit ?? '').toLowerCase() !== (r.unit ?? '').toLowerCase()) throw new BadRequestException(`${r.description}: satuan analisa (${unit ?? '–'}) berbeda dengan item (${r.unit ?? '–'}).`);
        }
        if (d.kind === 'PRICE_CHOICE' && (d.value as { source: string }).source === 'SOURCE_OVERRIDE' && (d.reason ?? '').trim().length < 3) {
          throw new BadRequestException(`${r.description}: override harga sumber wajib alasan.`);
        }
        if (d.kind === 'DIRECT_PRICE' && r.sourceUnitPrice === null) throw new BadRequestException(`${r.description}: tidak ada harga sumber untuk dijadikan harga langsung.`);
        if (d.kind === 'WORK_ITEM_MATCH') {
          if (draft.targetVersionType === 'CONTRACT') throw new BadRequestException('Impor Kontrak selalu membuat pekerjaan baru.');
          const id = (d.value as { workItemId: string | null }).workItemId;
          if (id && !(await tx.workItem.findFirst({ where: { id, projectId }, select: { id: true } }))) throw new BadRequestException(`${r.description}: pekerjaan permanen tidak ditemukan.`);
        }
      }
      await tx.rabImportDecision.createMany({
        data: input.decisions.map((d) => ({
          importId,
          rowKey: d.rowKey,
          kind: d.kind,
          value: d.value as Prisma.InputJsonValue,
          reason: d.reason?.trim() || null,
          decidedBy: actor.id,
        })),
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'DECIDE_RAB_IMPORT_ROW',
        entityType: 'RAB_IMPORT',
        entityId: importId,
        projectId,
        newValue: { count: input.decisions.length, decisions: input.decisions.slice(0, 50).map((d) => ({ rowKey: d.rowKey, kind: d.kind, value: d.value, reason: d.reason ?? null })) },
      });
    });
    return this.get(projectId, importId);
  }

  async reject(actor: AuthUser, projectId: string, importId: string, reason: string): Promise<RabImportDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockReviewable(tx, projectId, importId);
      await tx.rabImport.update({ where: { id: importId }, data: { status: 'REJECTED', rejectedBy: actor.id, rejectedAt: new Date(), rejectReason: reason } });
      await writeAudit(tx, { actorId: actor.id, action: 'REJECT_RAB_IMPORT', entityType: 'RAB_IMPORT', entityId: importId, projectId, oldValue: { status: 'NEEDS_REVIEW' }, newValue: { status: 'REJECTED' }, reason });
    });
    return this.get(projectId, importId);
  }

  /**
   * Approval domain (D-049): one transaction creates the RAB DRAFT through the M4 version rules, the price
   * list version, the used analyses (with sub-analyses) and components, the linked RAB items, and audit.
   * Nothing is written while blocking issues remain.
   */
  async approve(actor: AuthUser, projectId: string, importId: string): Promise<RabImportDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockReviewable(tx, projectId, importId);
      const draft = row.draft as unknown as RabImportDraft;
      const decisions = (await tx.rabImportDecision.findMany({ where: { importId } })).map(toRecord);
      const official = await this.officialVersions(projectId, tx);
      const evaluation = evaluateImport(draft, decisions, official);
      const blocking = blockingIssues(evaluation.issues);
      if (blocking.length) throw new ConflictException({ message: `Impor belum dapat di-approve: ${blocking.length} masalah harus diselesaikan.`, issues: blocking.slice(0, 50) });

      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractNumber: true, contractDate: true } });
      const version = await this.rab.createVersionInTx(
        tx,
        actor,
        projectId,
        draft.targetVersionType === 'CONTRACT'
          ? { versionType: 'CONTRACT', documentNumber: project.contractNumber, documentDate: project.contractDate.toISOString().slice(0, 10) }
          : { versionType: draft.targetVersionType },
        { copyPrevious: false },
      );

      // Price list + analyses only for what the effective rows use (D-046).
      const analyses = draft.analyses.filter((a) => evaluation.usedAnalysisKeys.has(a.key));
      const versionIds = new Map(analyses.map((a) => [a.key, randomUUID()]));
      let priceListId: string | null = null;
      if (analyses.length) {
        const last = await tx.priceList.aggregate({ where: { projectId }, _max: { versionNumber: true } });
        priceListId = randomUUID();
        await tx.priceList.create({
          data: { id: priceListId, projectId, versionNumber: (last._max.versionNumber ?? 0) + 1, location: draft.priceMetadata.location, period: draft.priceMetadata.period, createdBy: actor.id },
        });
        const usedPrices = new Set(analyses.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'PRICE_ITEM' ? [c.source.priceKey] : []))));
        const priceIds = new Map([...usedPrices].map((k) => [k, randomUUID()]));
        await tx.priceItem.createMany({
          data: draft.prices
            .filter((p) => usedPrices.has(p.key))
            .map((p) => ({ id: priceIds.get(p.key)!, priceListId: priceListId!, name: p.name, unit: p.unit, price: p.price, sourceLocator: { ...p.locator, evidence: p.evidence } as Prisma.InputJsonValue })),
        });
        const analysisIds = new Map(analyses.map((a) => [a.key, randomUUID()]));
        await tx.ahspAnalysis.createMany({ data: analyses.map((a) => ({ id: analysisIds.get(a.key)!, projectId, code: a.code, name: a.name, unit: a.unit })) });
        await tx.ahspAnalysisVersion.createMany({
          data: analyses.map((a) => ({
            id: versionIds.get(a.key)!,
            analysisId: analysisIds.get(a.key)!,
            versionNumber: 1,
            priceListId: priceListId!,
            sourceImportId: importId,
            code: a.code,
            name: a.name,
            unit: a.unit,
            discipline: a.discipline,
            overheadPercent: a.overheadPercent,
            roundingScale: a.roundingScale,
            directCost: a.computed.directCost,
            overheadAmount: a.computed.overheadAmount,
            priceExact: a.computed.priceExact,
            price: a.computed.price,
            sourceLocator: { ...a.locator, reconciliation: a.reconciliation } as Prisma.InputJsonValue,
          })),
        });
        await tx.ahspComponent.createMany({
          data: analyses.flatMap((a) =>
            a.components.map((c, i) => ({
              analysisVersionId: versionIds.get(a.key)!,
              sortOrder: i + 1,
              category: c.category,
              description: c.description,
              unit: c.unit,
              coefficient: c.coefficient,
              priceItemId: c.source.kind === 'PRICE_ITEM' ? priceIds.get(c.source.priceKey)! : null,
              subAnalysisVersionId: c.source.kind === 'ANALYSIS' ? versionIds.get(c.source.analysisKey)! : null,
              subPriceBasis: c.source.kind === 'ANALYSIS' ? c.source.basis : null,
              unitPrice: c.unitPrice,
              amount: c.amount,
              sourceLocator: { ...c.locator, evidence: c.evidence, ...(c.source.kind === 'PRICE_ITEM' && c.source.factor ? { factor: c.source.factor } : {}) } as Prisma.InputJsonValue,
            })),
          ),
        });
      }

      // RAB rows in tree order; parents exist before children for the self-referencing FK.
      const itemIds = new Map(evaluation.rows.map((r) => [r.row.key, randomUUID()]));
      // Non-contract versions link to the previous version like a copy would (D-053): items through the
      // reviewer's work item decision, group rows through the same structural path (number + name).
      const previousRows = version.previousVersionId ? await this.previousRows(tx, version.previousVersionId) : null;
      const draftByKey = new Map(draft.rows.map((r) => [r.key, r]));
      const draftPath = (key: string | null): string => {
        const parts: string[] = [];
        for (let k = key; k; k = draftByKey.get(k)?.parentKey ?? null) parts.unshift(structural(draftByKey.get(k)!));
        return parts.join(' › ');
      };
      const order = new Map<string | null, number>();
      let nextNumber = await nextWorkItemNumber(tx, projectId);
      const newWorkItems: { id: string; projectId: string; internalCode: string; canonicalDescription: string }[] = [];
      const items = evaluation.rows.map((r) => {
        const sortOrder = (order.get(r.row.parentKey) ?? 0) + 1;
        order.set(r.row.parentKey, sortOrder);
        let workItemId: string | null = null;
        if (r.row.rowType === 'ITEM') {
          workItemId = r.workItemId ?? null;
          if (!workItemId) {
            workItemId = randomUUID();
            newWorkItems.push({ id: workItemId, projectId, internalCode: workItemCode(nextNumber++), canonicalDescription: r.row.description });
          }
        }
        const decision = r.priceDecision ?? decisions.filter((d) => d.rowKey === r.row.key && d.kind === 'DIRECT_PRICE').at(-1) ?? null;
        const analysisVersionId = !r.analysis ? null : r.analysis.kind === 'DRAFT' ? versionIds.get(r.analysis.key)! : r.analysis.versionId;
        return {
          id: itemIds.get(r.row.key)!,
          rabVersionId: version.id,
          parentItemId: r.row.parentKey ? itemIds.get(r.row.parentKey)! : null,
          sortOrder,
          rowType: r.row.rowType,
          workItemId,
          displayNumber: r.row.displayNumber,
          description: r.row.description,
          volume: r.row.rowType === 'ITEM' ? r.row.volume : null,
          unit: r.row.rowType === 'ITEM' ? r.row.unit : null,
          analysisCode: r.row.rowType === 'ITEM' ? r.row.analysisCode : null,
          unitPrice: r.row.rowType === 'ITEM' ? r.unitPrice : null,
          taxPercent: r.row.rowType === 'ITEM' ? r.row.taxPercent : null,
          analysisVersionId,
          priceSource: r.row.rowType === 'ITEM' ? r.priceSource : 'MANUAL',
          sourceUnitPrice: r.row.rowType === 'ITEM' ? r.row.sourceUnitPrice : null,
          analysisUnitPrice: r.analysisUnitPrice,
          priceNote: decision?.reason ?? null,
          priceDecidedBy: decision?.decidedBy ?? null,
          priceDecidedAt: decision?.decidedAt ?? null,
          sourceLocator: r.row.locator as Prisma.InputJsonValue,
          previousVersionItemId: !previousRows
            ? null
            : r.row.rowType === 'ITEM'
              ? (workItemId ? (previousRows.byWorkItem.get(workItemId) ?? null) : null)
              : (previousRows.groupByPath.get(draftPath(r.row.key)) ?? null),
        };
      });
      if (newWorkItems.length) await tx.workItem.createMany({ data: newWorkItems });
      await tx.rabVersionItem.createMany({ data: items });

      await tx.rabImport.update({ where: { id: importId }, data: { status: 'APPROVED', approvedBy: actor.id, approvedAt: new Date(), rabVersionId: version.id, priceListId } });
      const subKeys = new Set(analyses.flatMap((a) => a.components.flatMap((c) => (c.source.kind === 'ANALYSIS' ? [c.source.analysisKey] : []))));
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'APPROVE_RAB_IMPORT',
        entityType: 'RAB_IMPORT',
        entityId: importId,
        projectId,
        oldValue: { status: 'NEEDS_REVIEW' },
        newValue: {
          status: 'APPROVED',
          rabVersionId: version.id,
          priceListId,
          items: evaluation.rows.filter((r) => r.row.rowType === 'ITEM').length,
          analyses: analyses.length,
          subAnalyses: analyses.filter((a) => subKeys.has(a.key)).length,
          components: analyses.reduce((n, a) => n + a.components.length, 0),
          overrides: evaluation.rows.filter((r) => r.priceSource === 'SOURCE_OVERRIDE').length,
          directPrices: evaluation.rows.filter((r) => r.row.rowType === 'ITEM' && r.priceSource === 'DIRECT').length,
          realCost: evaluation.totals.realCost,
          rounded: evaluation.totals.rounded,
        },
      });
    }, APPROVE_TX);
    return this.get(projectId, importId);
  }

  private evaluate(row: ImportRow, decisions: DecisionRecord[], official: Map<string, OfficialVersion>) {
    return evaluateImport(row.draft as unknown as RabImportDraft, decisions, official);
  }

  private async decisions(importId: string): Promise<DecisionRecord[]> {
    return (await this.prisma.rabImportDecision.findMany({ where: { importId } })).map(toRecord);
  }

  /** Latest official version of every analysis in the project. */
  private async officialVersions(projectId: string, db: Db = this.prisma): Promise<Map<string, OfficialVersion>> {
    const versions = await db.ahspAnalysisVersion.findMany({
      where: { analysis: { projectId } },
      select: { id: true, analysisId: true, versionNumber: true, code: true, name: true, unit: true, price: true },
      orderBy: [{ analysisId: 'asc' }, { versionNumber: 'desc' }],
    });
    const latest = new Map<string, OfficialVersion>();
    const seen = new Set<string>();
    for (const v of versions) {
      if (seen.has(v.analysisId)) continue;
      seen.add(v.analysisId);
      latest.set(v.id, { analysisVersionId: v.id, code: v.code, name: v.name, unit: v.unit, price: new Decimal(v.price.toString()).toFixed() });
    }
    return latest;
  }

  /** ITEM rows of the latest approved RAB version with their group path, for work item candidates. */
  private async previousItems(projectId: string): Promise<PreviousItem[]> {
    const version = await this.prisma.rabVersion.findFirst({ where: { projectId, status: 'APPROVED' }, orderBy: { approvedAt: 'desc' }, select: { id: true } });
    if (!version) return [];
    const rows = await this.prisma.rabVersionItem.findMany({
      where: { rabVersionId: version.id },
      select: { id: true, parentItemId: true, rowType: true, displayNumber: true, description: true, workItemId: true, workItem: { select: { internalCode: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pathOf = (parentId: string | null) => {
      const parts: string[] = [];
      for (let p = parentId; p; p = byId.get(p)?.parentItemId ?? null) parts.unshift(byId.get(p)?.displayNumber ?? '·');
      return parts.join(' › ');
    };
    return rows
      .filter((r) => r.rowType === 'ITEM' && r.workItemId)
      .map((r) => ({ workItemId: r.workItemId!, code: r.workItem!.internalCode, description: r.description, groupPath: pathOf(r.parentItemId) }));
  }

  private async previousRows(tx: Db, versionId: string) {
    const rows = await tx.rabVersionItem.findMany({ where: { rabVersionId: versionId }, select: { id: true, parentItemId: true, rowType: true, displayNumber: true, description: true, workItemId: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pathOf = (id: string | null) => {
      const parts: string[] = [];
      for (let p = id; p; p = byId.get(p)?.parentItemId ?? null) parts.unshift(structural(byId.get(p)!));
      return parts.join(' › ');
    };
    return {
      byWorkItem: new Map(rows.filter((r) => r.workItemId).map((r) => [r.workItemId!, r.id])),
      groupByPath: new Map(rows.filter((r) => r.rowType !== 'ITEM').map((r) => [pathOf(r.id), r.id])),
    };
  }

  private async find(db: Db, projectId: string, importId: string): Promise<ImportRow> {
    const row = await db.rabImport.findFirst({ where: { id: importId, projectId }, include: IMPORT_INCLUDE });
    if (!row) throw new NotFoundException('Impor tidak ditemukan.');
    return row;
  }

  /** Row lock on the import, then status check; decisions/approval/rejection only while NEEDS_REVIEW. */
  private async lockReviewable(tx: Db, projectId: string, importId: string): Promise<ImportRow> {
    await tx.$queryRaw`SELECT id FROM rab_imports WHERE id = ${importId} FOR UPDATE`;
    const row = await this.find(tx, projectId, importId);
    if (row.status !== 'NEEDS_REVIEW') throw new ConflictException(`Impor berstatus ${row.status}; hanya impor NEEDS_REVIEW yang dapat direview.`);
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } });
    if (project.status === 'CLOSED') throw new ConflictException('Proyek sudah ditutup.');
    return row;
  }

  private summary(r: ImportRow, blockingCount: number): RabImportSummaryDto {
    return {
      id: r.id,
      targetVersionType: r.targetVersionType,
      status: r.status,
      attemptNumber: r.attemptNumber,
      previousImportId: r.previousImportId,
      guideVersion: r.guideVersion,
      documents: r.documents.map((d) => ({ id: d.documentId, originalFilename: d.document.originalFilename })),
      createdBy: r.creator,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
      errorMessage: r.errorMessage,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      rejectReason: r.rejectReason,
      rabVersionId: r.rabVersionId,
      blockingIssues: blockingCount,
    };
  }
}

/** Structural identity of a group row: its number and normalised name. */
const structural = (r: { displayNumber: string | null; description: string }) => `${r.displayNumber ?? ''}|${r.description.replace(/\s+/g, ' ').trim().toLowerCase()}`;

const toRecord = (d: { rowKey: string; kind: DecisionRecord['kind']; value: unknown; reason: string | null; decidedBy: string; decidedAt: Date }): DecisionRecord => ({
  rowKey: d.rowKey,
  kind: d.kind,
  value: d.value,
  reason: d.reason,
  decidedBy: d.decidedBy,
  decidedAt: d.decidedAt,
});
