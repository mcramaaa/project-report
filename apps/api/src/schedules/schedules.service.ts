import { actualCurve, aggregateRabGroups, Decimal, plannedCurve, scaleScheduleToWeights, scheduleGroupIds, validateSchedule, type RabRowValues } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  type CreateScheduleInput,
  type ImportScheduleInput,
  type SaveScheduleEntriesInput,
  type SCurveDto,
  type SCurveGroupDetailDto,
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
import { today } from '../progress/progress.service';
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

  /** D-076: plan and realisation on the weights of the baseline in force at the end of the current week. */
  async sCurve(projectId: string): Promise<SCurveDto> {
    const weekRows = await this.prisma.projectWeek.findMany({ where: { projectId }, select: { weekNumber: true, startDate: true, endDate: true }, orderBy: { weekNumber: 'asc' } });
    if (!weekRows.length) throw new NotFoundException('Proyek tidak ditemukan.');
    const weeks = weekRows.map((w) => ({ weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) }));
    const now = today();
    const current = (weeks.find((w) => w.startDate <= now && now <= w.endDate) ?? (now < weeks[0]!.startDate ? weeks[0]! : weeks.at(-1)!));
    const assignment = await this.prisma.baselineAssignment.findFirst({
      where: { projectId, revokedAt: null, effectiveFrom: { lte: weekRows[current.weekNumber - 1]!.endDate } },
      orderBy: { effectiveFrom: 'desc' },
      select: { rabVersion: { select: { id: true, versionType: true, revisionNumber: true, totalValue: true, schedule: { select: { id: true, status: true } } } } },
    });
    const version = assignment?.rabVersion;
    const [items, progress, plan] = await Promise.all([
      version
        ? this.prisma.rabVersionItem.findMany({
            where: { rabVersionId: version.id },
            select: { id: true, parentItemId: true, rowType: true, workItemId: true, volume: true, subtotal: true },
          })
        : Promise.resolve([]),
      this.prisma.weeklyProgress.findMany({ where: { projectId }, select: { workItemId: true, actualVolume: true, week: { select: { weekNumber: true } } } }),
      version?.schedule?.status === 'APPROVED' ? loadSchedule(this.prisma, projectId, version.schedule.id) : Promise.resolve(null),
    ]);
    // D-077: each item's schedule group is its nearest ancestor that is a group.
    const groupIds = scheduleGroupIds(items.map((i) => ({ id: i.id, parentId: i.parentItemId, rowType: i.rowType })));
    const parentOf = new Map(items.map((i) => [i.id, i.parentItemId]));
    const groupOf = (id: string) => {
      for (let p: string | null | undefined = id; p; p = parentOf.get(p)) if (groupIds.has(p)) return p;
      return null;
    };
    const { weeks: actual, groups: actualByGroup } = actualCurve(
      items
        .filter((i) => i.rowType === 'ITEM' && i.workItemId)
        .map((i) => ({ workItemId: i.workItemId!, volume: i.volume?.toString() ?? '0', subtotal: i.subtotal?.toString() ?? '0', groupId: groupOf(i.id) })),
      progress.map((p) => ({ workItemId: p.workItemId, weekNumber: p.week.weekNumber, volume: p.actualVolume.toString() })),
      version?.totalValue?.toString() ?? '0',
      weeks.length,
    );
    const planned = plan ? plannedCurve(plan.entries, weeks.length) : null;
    const cells = new Map<string, string>();
    for (const e of plan?.entries ?? []) cells.set(`${e.groupId}:${e.weekNumber}`, e.weight);
    return {
      baseline: version ? { rabVersionId: version.id, label: rabVersionLabel(version) } : null,
      rows: (plan?.outline ?? []).map((r) => ({
        ...r,
        planned: weeks.map((w) => cells.get(`${r.id}:${w.weekNumber}`) ?? null),
        actual: r.weight === null ? weeks.map(() => null) : weeks.map((w, i) => (w.startDate <= now ? (actualByGroup.get(r.id)?.[i] ?? '0') : null)),
      })),
      schedule: version?.schedule ?? null,
      currentWeek: current.weekNumber,
      weeks: weeks.map((w, i) => {
        const started = w.startDate <= now;
        const p = planned?.[i];
        const a = started ? actual[i]! : null;
        return {
          ...w,
          planned: p?.planned ?? null,
          plannedCumulative: p?.cumulative ?? null,
          actual: a?.actual ?? null,
          actualCumulative: a?.cumulative ?? null,
          deviation: a && p ? new Decimal(a.cumulative).minus(p.cumulative).toFixed() : null,
        };
      }),
    };
  }

  /** D-077 butir 5: the items under a schedule group with their realisation through `weekNumber`. */
  async sCurveGroup(projectId: string, groupId: string, weekNumber: number): Promise<SCurveGroupDetailDto> {
    const group = await this.prisma.rabVersionItem.findFirst({
      where: { id: groupId, rabVersion: { projectId } },
      select: { id: true, rabVersionId: true, displayNumber: true, description: true, rabVersion: { select: { totalValue: true } } },
    });
    if (!group) throw new NotFoundException('Kelompok pekerjaan tidak ditemukan.');
    const [rows, progress] = await Promise.all([
      this.prisma.rabVersionItem.findMany({
        where: { rabVersionId: group.rabVersionId },
        select: { id: true, parentItemId: true, sortOrder: true, rowType: true, displayNumber: true, description: true, unit: true, volume: true, subtotal: true, workItemId: true, workItem: { select: { internalCode: true } } },
      }),
      this.prisma.weeklyProgress.findMany({
        where: { projectId, week: { weekNumber: { lte: weekNumber } } },
        select: { workItemId: true, actualVolume: true, week: { select: { weekNumber: true } } },
      }),
    ]);
    const cumulative = new Map<string, Decimal>();
    const thisWeek = new Map<string, Decimal>();
    for (const p of progress) {
      cumulative.set(p.workItemId, (cumulative.get(p.workItemId) ?? new Decimal(0)).plus(p.actualVolume.toString()));
      if (p.week.weekNumber === weekNumber) thisWeek.set(p.workItemId, new Decimal(p.actualVolume.toString()));
    }
    const total = new Decimal(group.rabVersion.totalValue?.toString() ?? 0);
    const children = new Map<string | null, typeof rows>();
    for (const r of rows) children.set(r.parentItemId, [...(children.get(r.parentItemId) ?? []), r]);
    const out: SCurveGroupDetailDto['rows'] = [];
    let groupWeight = new Decimal(0);
    const walk = (parent: string, depth: number) => {
      for (const r of (children.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
        const base = { id: r.id, rowType: r.rowType as 'SUBSECTION' | 'PARENT_ITEM' | 'ITEM', depth, displayNumber: r.displayNumber, description: r.description, unit: r.unit };
        if (r.rowType !== 'ITEM') {
          out.push({ ...base, workItemCode: null, volume: null, weight: null, cumulative: null, thisWeek: null, percent: null, actualWeight: null });
          walk(r.id, depth + 1);
          continue;
        }
        const volume = new Decimal(r.volume?.toString() ?? 0);
        const weight = total.gt(0) ? new Decimal(r.subtotal?.toString() ?? 0).div(total).times(100) : new Decimal(0);
        groupWeight = groupWeight.plus(weight);
        const cum = r.workItemId ? (cumulative.get(r.workItemId) ?? new Decimal(0)) : new Decimal(0);
        const share = volume.gt(0) ? cum.div(volume) : null;
        out.push({
          ...base,
          workItemCode: r.workItem?.internalCode ?? null,
          volume: volume.toFixed(),
          weight: weight.toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed(),
          cumulative: cum.toFixed(),
          thisWeek: r.workItemId ? (thisWeek.get(r.workItemId)?.toFixed() ?? '0') : null,
          percent: share ? share.times(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed() : null,
          actualWeight: share ? share.times(weight).toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed() : null,
        });
      }
    };
    walk(group.id, 0);
    return {
      group: { id: group.id, displayNumber: group.displayNumber, description: group.description, weight: groupWeight.toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed() },
      weekNumber,
      rows: out,
    };
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

export async function lockActiveProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; jadwal tidak dapat diubah.');
}

type ScheduleContext = Awaited<ReturnType<typeof loadSchedule>>;

export async function lockEditable(tx: Prisma.TransactionClient, projectId: string, scheduleId: string): Promise<ScheduleContext> {
  await lockActiveProject(tx, projectId);
  const ctx = await loadSchedule(tx, projectId, scheduleId);
  if (ctx.schedule.status === 'APPROVED') throw new ConflictException('Jadwal sudah approved; buka kembali untuk merevisi.');
  if (ctx.schedule.rabVersion.status !== 'APPROVED') throw new ConflictException(NOT_RAB_APPROVED);
  return ctx;
}

/** Schedule row, its groups (RAB order, weights from the approved subtotals), project weeks and entries. */
export async function loadSchedule(db: Db, projectId: string, scheduleId: string) {
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
  const ordered = treeOrder(items);
  const groups = ordered
    .filter((i) => groupIds.has(i.id))
    .map((i) => ({ id: i.id, displayNumber: i.displayNumber, description: i.description, weight: values.get(i.id)?.weight ?? '0' }));
  /** Groups with the SECTION headings above their SUBSECTIONs, as the Curva S sheet lists them. */
  const outline = ordered
    .filter((i) => groupIds.has(i.id) || i.rowType === 'SECTION')
    .map((i) => ({ id: i.id, displayNumber: i.displayNumber, description: i.description, weight: groupIds.has(i.id) ? (values.get(i.id)?.weight ?? '0') : null }));
  const weeks = weekRows.map((w) => ({ id: w.id, weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) }));
  const entries = entryRows
    .map((e) => ({ groupId: e.groupItemId, weekNumber: e.week.weekNumber, weight: e.plannedWeight.toFixed() }))
    .sort((a, b) => a.weekNumber - b.weekNumber);
  return { schedule, groups, outline, weeks, entries };
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
export async function replaceEntries(tx: Prisma.TransactionClient, ctx: ScheduleContext, entries: Entry[]): Promise<number> {
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
