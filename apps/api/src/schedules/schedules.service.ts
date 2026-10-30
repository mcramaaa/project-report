import { aggregateRabGroups, plannedCurve, scaleScheduleToWeights, scheduleGroupIds, validateSchedule, type RabRowValues } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  type CreateScheduleInput,
  type ImportScheduleInput,
  type SaveScheduleEntriesInput,
  type ScheduleDetailDto,
  type ScheduleSummaryDto,
} from '@laporan-proyek/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import { DocumentsService } from '../documents/documents.service';
import type { Prisma } from '../generated/prisma/client';
import { WorkbookModel } from '../imports/workbook/workbook-model';
import { isUniqueViolation } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate } from '../projects/project-calendar';
import { DEFAULT_SCHEDULE_SHEET, parseScheduleSheet } from './schedule-sheet';

type Db = Prisma.TransactionClient | PrismaService;
type Entry = SaveScheduleEntriesInput['entries'][number];

const SCHEDULE_SELECT = {
  id: true,
  status: true,
  approvedAt: true,
  rabVersion: { select: { id: true, versionType: true, revisionNumber: true, status: true, totalValue: true } },
  sourceDocument: { select: { id: true, originalFilename: true } },
  approvedByUser: { select: { id: true, name: true } },
} as const;
const NOT_RAB_APPROVED = 'Versi RAB jadwal ini sedang tidak berstatus approved; selesaikan koreksi RAB lebih dahulu.';

/** D-072: time schedule per approved RAB version, % of project weight per RAB group per week. */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async list(projectId: string): Promise<ScheduleSummaryDto[]> {
    const versions = await this.prisma.rabVersion.findMany({
      where: { projectId, status: { in: ['APPROVED', 'REOPENED'] } },
      select: { id: true, versionType: true, revisionNumber: true, schedule: { select: { id: true, status: true } } },
      orderBy: [{ versionType: 'asc' }, { revisionNumber: 'asc' }],
    });
    return versions.map((v) => ({ rabVersion: { id: v.id, label: rabVersionLabel(v) }, schedule: v.schedule }));
  }

  async create(actor: AuthUser, projectId: string, input: CreateScheduleInput): Promise<ScheduleDetailDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await lockActiveProject(tx, projectId);
      const version = await tx.rabVersion.findFirst({ where: { id: input.rabVersionId, projectId }, select: { id: true, status: true, versionType: true, revisionNumber: true } });
      if (!version) throw new NotFoundException('Versi RAB tidak ditemukan di proyek ini.');
      if (version.status !== 'APPROVED') throw new ConflictException('Jadwal hanya dibuat untuk versi RAB approved.');
      try {
        const created = await tx.scheduleVersion.create({ data: { projectId, rabVersionId: version.id, createdBy: actor.id }, select: { id: true } });
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'CREATE_SCHEDULE',
          entityType: 'SCHEDULE_VERSION',
          entityId: created.id,
          projectId,
          newValue: { rabVersionId: version.id, rabVersion: rabVersionLabel(version), status: 'DRAFT' },
        });
        return created.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException(`Jadwal ${rabVersionLabel(version)} sudah ada.`);
        throw err;
      }
    });
    return this.get(projectId, id);
  }

  async get(projectId: string, scheduleId: string): Promise<ScheduleDetailDto> {
    const { schedule, groups, weeks, entries } = await loadSchedule(this.prisma, projectId, scheduleId);
    const groupSum = (id: string) => plannedCurve(entries.filter((e) => e.groupId === id), weeks.length).at(-1)?.cumulative ?? '0';
    return {
      id: schedule.id,
      status: schedule.status,
      rabVersion: { id: schedule.rabVersion.id, label: rabVersionLabel(schedule.rabVersion) },
      sourceDocument: schedule.sourceDocument && { id: schedule.sourceDocument.id, filename: schedule.sourceDocument.originalFilename },
      approvedBy: schedule.approvedByUser,
      approvedAt: schedule.approvedAt?.toISOString() ?? null,
      weeks: weeks.map(({ weekNumber, startDate, endDate }) => ({ weekNumber, startDate, endDate })),
      groups: groups.map((g) => ({ id: g.id, displayNumber: g.displayNumber, description: g.description, weight: g.weight, planned: groupSum(g.id) })),
      entries,
      curve: plannedCurve(entries, weeks.length),
      issues: validateSchedule(groups.map((g) => ({ id: g.id, label: `${g.displayNumber ?? ''} ${g.description}`.trim(), weight: g.weight })), entries, weeks.length),
    };
  }

  async saveEntries(actor: AuthUser, projectId: string, scheduleId: string, input: SaveScheduleEntriesInput): Promise<ScheduleDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const ctx = await lockEditable(tx, projectId, scheduleId);
      const count = await replaceEntries(tx, ctx, input.entries);
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'UPDATE_SCHEDULE',
        entityType: 'SCHEDULE_VERSION',
        entityId: scheduleId,
        projectId,
        oldValue: { entryCount: ctx.entries.length },
        newValue: { entryCount: count },
      });
    });
    return this.get(projectId, scheduleId);
  }

  async import(actor: AuthUser, projectId: string, scheduleId: string, input: ImportScheduleInput): Promise<ScheduleDetailDto> {
    // Read and parse outside the transaction (file I/O); the parse is checked against the locked state below.
    const file = await this.documents.read(projectId, input.documentId);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.data as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Dokumen Excel tidak dapat dibaca.');
    }
    const model = new WorkbookModel(input.documentId, file.filename, workbook);
    const sheet = input.sheet ?? DEFAULT_SCHEDULE_SHEET;

    const importAdjustments = await this.prisma.$transaction(async (tx) => {
      const ctx = await lockEditable(tx, projectId, scheduleId);
      const parsed = parseScheduleSheet(model, sheet, ctx.groups, ctx.weeks.length);
      if (parsed.errors.length)
        throw new BadRequestException({ message: `Impor jadwal dari ${file.filename} gagal: ${parsed.errors.length} masalah.`, errors: parsed.errors });
      const scaled = scaleScheduleToWeights(ctx.groups, parsed.entries);
      const label = new Map(ctx.groups.map((g) => [g.id, `${g.displayNumber ?? ''} ${g.description}`.trim()]));
      const adjustments = scaled.adjusted.map((a) => ({ group: label.get(a.groupId)!, from: a.from, to: a.to }));
      const count = await replaceEntries(tx, ctx, scaled.entries);
      await tx.scheduleVersion.update({ where: { id: scheduleId }, data: { sourceDocumentId: input.documentId } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'IMPORT_SCHEDULE',
        entityType: 'SCHEDULE_VERSION',
        entityId: scheduleId,
        projectId,
        oldValue: { entryCount: ctx.entries.length },
        newValue: { documentId: input.documentId, filename: file.filename, sheet: model.sheetName(sheet), entryCount: count, scaledGroups: adjustments },
      });
      return adjustments;
    });
    return { ...(await this.get(projectId, scheduleId)), importAdjustments };
  }

  async approve(actor: AuthUser, projectId: string, scheduleId: string): Promise<ScheduleDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const ctx = await lockEditable(tx, projectId, scheduleId);
      const issues = validateSchedule(
        ctx.groups.map((g) => ({ id: g.id, label: `${g.displayNumber ?? ''} ${g.description}`.trim(), weight: g.weight })),
        ctx.entries,
        ctx.weeks.length,
      );
      if (issues.length) throw new ConflictException({ message: 'Jadwal belum dapat di-approve.', errors: issues.map((i) => i.message) });
      await tx.scheduleVersion.update({ where: { id: scheduleId }, data: { status: 'APPROVED', approvedBy: actor.id, approvedAt: new Date() } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'APPROVE_SCHEDULE',
        entityType: 'SCHEDULE_VERSION',
        entityId: scheduleId,
        projectId,
        oldValue: { status: ctx.schedule.status },
        newValue: { status: 'APPROVED', entryCount: ctx.entries.length },
      });
    });
    return this.get(projectId, scheduleId);
  }

  /** The approved entries go into the audit log before the revision starts (D-072 butir 3). */
  async reopen(actor: AuthUser, projectId: string, scheduleId: string, reason: string): Promise<ScheduleDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveProject(tx, projectId);
      const ctx = await loadSchedule(tx, projectId, scheduleId);
      if (ctx.schedule.status !== 'APPROVED') throw new ConflictException('Hanya jadwal approved yang dapat dibuka kembali.');
      await tx.scheduleVersion.update({ where: { id: scheduleId }, data: { status: 'REOPENED' } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'REOPEN_SCHEDULE',
        entityType: 'SCHEDULE_VERSION',
        entityId: scheduleId,
        projectId,
        oldValue: { status: 'APPROVED', approvedAt: ctx.schedule.approvedAt?.toISOString(), entries: ctx.entries },
        newValue: { status: 'REOPENED' },
        reason,
      });
    });
    return this.get(projectId, scheduleId);
  }
}

async function lockActiveProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; jadwal tidak dapat diubah.');
}

type ScheduleContext = Awaited<ReturnType<typeof loadSchedule>>;

async function lockEditable(tx: Prisma.TransactionClient, projectId: string, scheduleId: string): Promise<ScheduleContext> {
  await lockActiveProject(tx, projectId);
  const ctx = await loadSchedule(tx, projectId, scheduleId);
  if (ctx.schedule.status === 'APPROVED') throw new ConflictException('Jadwal sudah approved; buka kembali untuk merevisi.');
  if (ctx.schedule.rabVersion.status !== 'APPROVED') throw new ConflictException(NOT_RAB_APPROVED);
  return ctx;
}

/** Schedule row, its groups (RAB order, weights from the approved subtotals), project weeks and entries. */
async function loadSchedule(db: Db, projectId: string, scheduleId: string) {
  const schedule = await db.scheduleVersion.findFirst({ where: { id: scheduleId, projectId }, select: SCHEDULE_SELECT });
  if (!schedule) throw new NotFoundException('Jadwal tidak ditemukan.');
  const [items, weekRows, entryRows] = await Promise.all([
    db.rabVersionItem.findMany({
      where: { rabVersionId: schedule.rabVersion.id },
      select: { id: true, parentItemId: true, rowType: true, sortOrder: true, displayNumber: true, description: true, subtotal: true },
    }),
    db.projectWeek.findMany({ where: { projectId }, select: { id: true, weekNumber: true, startDate: true, endDate: true }, orderBy: { weekNumber: 'asc' } }),
    db.scheduleEntry.findMany({ where: { scheduleVersionId: scheduleId }, select: { groupItemId: true, plannedWeight: true, week: { select: { weekNumber: true } } } }),
  ]);
  const inputs = items.map((i) => ({ id: i.id, parentId: i.parentItemId, rowType: i.rowType }));
  const values = new Map<string, RabRowValues>();
  for (const i of items)
    if (i.rowType === 'ITEM') values.set(i.id, { unitPriceWithTax: null, subtotalBeforeTax: null, subtotal: i.subtotal?.toString() ?? null, weight: null });
  aggregateRabGroups(inputs, values, schedule.rabVersion.totalValue?.toString() ?? '0');
  const groupIds = scheduleGroupIds(inputs);
  const groups = treeOrder(items)
    .filter((i) => groupIds.has(i.id))
    .map((i) => ({ id: i.id, displayNumber: i.displayNumber, description: i.description, weight: values.get(i.id)?.weight ?? '0' }));
  const weeks = weekRows.map((w) => ({ id: w.id, weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) }));
  const entries = entryRows
    .map((e) => ({ groupId: e.groupItemId, weekNumber: e.week.weekNumber, weight: e.plannedWeight.toFixed() }))
    .sort((a, b) => a.weekNumber - b.weekNumber);
  return { schedule, groups, weeks, entries };
}

/** Rows depth-first in their sort order, as the RAB shows them. */
function treeOrder<T extends { id: string; parentItemId: string | null; sortOrder: number }>(rows: T[]): T[] {
  const children = new Map<string | null, T[]>();
  for (const r of rows) children.set(r.parentItemId, [...(children.get(r.parentItemId) ?? []), r]);
  const out: T[] = [];
  const walk = (parent: string | null) => {
    for (const r of (children.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push(r);
      walk(r.id);
    }
  };
  walk(null);
  return out;
}

/** Replaces all entries; groups and weeks must belong to this schedule's RAB version and project. */
async function replaceEntries(tx: Prisma.TransactionClient, ctx: ScheduleContext, entries: Entry[]): Promise<number> {
  const groups = new Set(ctx.groups.map((g) => g.id));
  const weekIds = new Map(ctx.weeks.map((w) => [w.weekNumber, w.id]));
  const keep = new Map<string, Entry>();
  for (const e of entries) {
    if (!groups.has(e.groupId)) throw new BadRequestException('Isian merujuk baris yang bukan kelompok jadwal versi RAB ini.');
    if (!weekIds.has(e.weekNumber)) throw new BadRequestException(`Minggu ${e.weekNumber} di luar masa proyek (1–${ctx.weeks.length}).`);
    const key = `${e.groupId}/${e.weekNumber}`;
    if (keep.has(key)) throw new BadRequestException(`Isian ganda untuk kelompok yang sama pada minggu ${e.weekNumber}.`);
    if (Number(e.weight) !== 0) keep.set(key, e);
  }
  await tx.scheduleEntry.deleteMany({ where: { scheduleVersionId: ctx.schedule.id } });
  await tx.scheduleEntry.createMany({
    data: [...keep.values()].map((e) => ({ scheduleVersionId: ctx.schedule.id, groupItemId: e.groupId, weekId: weekIds.get(e.weekNumber)!, plannedWeight: e.weight })),
  });
  return keep.size;
}
