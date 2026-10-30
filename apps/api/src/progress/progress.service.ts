import { addDays, allocateDaily, daysInclusive, Decimal, DEFAULT_DAILY_FACTORS, progressSummary, weeklyVolumeFromPercent } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  type DailyAllocationDto,
  type DailyAllocationMethod,
  type ProgressRowDto,
  type SaveDailyAllocationInput,
  type ProgressWeekSummaryDto,
  type SaveWeeklyProgressInput,
  type WeeklyProgressDto,
} from '@laporan-proyek/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate, toDbDate } from '../projects/project-calendar';

type Db = Prisma.TransactionClient | PrismaService;
type Week = { id: string; weekNumber: number; startDate: string; endDate: string };

/**
 * D-073 butir 6: "today" as a date in WIT (UTC+9), the earliest Indonesian zone, so a week opens no later than its
 * start date wherever the project is. shortcut: one zone for all projects; store a project time zone if a later
 * rule needs the exact local day.
 */
const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** D-073: weekly realised volume per work item; cumulative, percent and remaining are computed. */
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async weeks(projectId: string): Promise<ProgressWeekSummaryDto[]> {
    const project = await findProject(this.prisma, projectId);
    const [weeks, assignments, counts] = await Promise.all([
      loadWeeks(this.prisma, projectId),
      liveAssignments(this.prisma, projectId),
      this.prisma.weeklyProgress.groupBy({ by: ['weekId'], where: { projectId }, _count: { _all: true } }),
    ]);
    const filled = new Map(counts.map((c) => [c.weekId, c._count._all]));
    return weeks.map((w) => summary(w, baselineOf(assignments, w), project.status === 'ACTIVE', filled.get(w.id) ?? 0));
  }

  async get(projectId: string, weekNumber: number): Promise<WeeklyProgressDto> {
    const project = await findProject(this.prisma, projectId);
    const week = await findWeek(this.prisma, projectId, weekNumber);
    const baseline = baselineOf(await liveAssignments(this.prisma, projectId), week);
    const [items, progress] = await Promise.all([
      baseline ? baselineItems(this.prisma, baseline.rabVersionId) : Promise.resolve([]),
      this.prisma.weeklyProgress.findMany({
        where: { projectId, week: { weekNumber: { lte: weekNumber } } },
        select: {
          workItemId: true,
          actualVolume: true,
          inputMode: true,
          inputPercentage: true,
          note: true,
          updatedAt: true,
          week: { select: { weekNumber: true } },
          updatedByUser: { select: { id: true, name: true } },
          workItem: { select: { internalCode: true, canonicalDescription: true } },
        },
      }),
    ]);
    const previous = new Map<string, Decimal>();
    const current = new Map<string, (typeof progress)[number]>();
    for (const p of progress) {
      if (p.week.weekNumber === weekNumber) current.set(p.workItemId, p);
      else previous.set(p.workItemId, (previous.get(p.workItemId) ?? new Decimal(0)).plus(p.actualVolume.toString()));
    }

    const progressOf = (workItemId: string, baselineVolume: string | null) => {
      const prev = previous.get(workItemId)?.toFixed() ?? '0';
      const p = current.get(workItemId);
      return {
        previousCumulative: prev,
        thisWeek: p
          ? {
              volume: new Decimal(p.actualVolume.toString()).toFixed(),
              mode: p.inputMode,
              percentage: p.inputPercentage ? new Decimal(p.inputPercentage.toString()).toFixed() : null,
              note: p.note,
              updatedBy: p.updatedByUser,
              updatedAt: p.updatedAt.toISOString(),
            }
          : null,
        ...progressSummary(prev, p ? p.actualVolume.toString() : '0', baselineVolume),
      };
    };

    const rows: ProgressRowDto[] = items.map((i) => {
      const baselineVolume = i.rowType === 'ITEM' && i.volume ? new Decimal(i.volume.toString()).toFixed() : null;
      const base = { id: i.id, rowType: i.rowType, depth: i.depth, displayNumber: i.displayNumber, description: i.description, unit: i.unit };
      if (i.rowType !== 'ITEM' || !i.workItemId)
        return { ...base, workItemId: null, workItemCode: null, baselineVolume, trackable: false, previousCumulative: '0', thisWeek: null, cumulative: '0', percent: null, remaining: null };
      return {
        ...base,
        workItemId: i.workItemId,
        workItemCode: i.workItem?.internalCode ?? null,
        baselineVolume,
        trackable: isTrackable(i),
        ...progressOf(i.workItemId, baselineVolume),
      };
    });
    // D-073 butir 4: progress of items no longer in this baseline stays visible, read-only.
    const inBaseline = new Set(items.map((i) => i.workItemId));
    const untracked = new Map(progress.filter((p) => !inBaseline.has(p.workItemId)).map((p) => [p.workItemId, p.workItem]));
    for (const [workItemId, w] of untracked)
      rows.push({
        id: workItemId,
        rowType: 'ITEM',
        depth: 0,
        displayNumber: null,
        description: w.canonicalDescription,
        workItemId,
        workItemCode: w.internalCode,
        unit: null,
        baselineVolume: null,
        trackable: false,
        ...progressOf(workItemId, null),
      });

    return { week: summary(week, baseline, project.status === 'ACTIVE', current.size), rows };
  }

  async save(actor: AuthUser, projectId: string, weekNumber: number, input: SaveWeeklyProgressInput): Promise<WeeklyProgressDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const project = await findProject(tx, projectId);
      if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; progres tidak dapat diubah.');
      const week = await findWeek(tx, projectId, weekNumber);
      if (week.startDate > today()) throw new ConflictException(`Minggu ${weekNumber} belum dimulai (mulai ${week.startDate}).`);
      const assignments = await liveAssignments(tx, projectId);
      const baseline = baselineOf(assignments, week);
      if (!baseline) throw new ConflictException(`Minggu ${weekNumber} belum memiliki baseline; aktifkan baseline di halaman RAB.`);

      const ids = input.entries.map((e) => e.workItemId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Satu work item hanya boleh diisi sekali per simpan.');
      const items = new Map((await baselineItems(tx, baseline.rabVersionId)).filter((i) => i.workItemId).map((i) => [i.workItemId!, i]));
      const weeks = await loadWeeks(tx, projectId);
      const rows = await tx.weeklyProgress.findMany({
        where: { projectId, workItemId: { in: ids } },
        select: { id: true, workItemId: true, actualVolume: true, inputMode: true, inputPercentage: true, note: true, week: { select: { weekNumber: true } } },
      });
      // Baseline volumes of later weeks, per version, for the cumulative check of D-073 butir 5.
      const versionVolumes = new Map<string, Promise<Map<string, string>>>();
      const volumeIn = (rabVersionId: string, workItemId: string) => {
        if (!versionVolumes.has(rabVersionId))
          versionVolumes.set(
            rabVersionId,
            baselineItems(tx, rabVersionId).then((list) => new Map(list.filter(isTrackable).map((i) => [i.workItemId!, i.volume!.toString()]))),
          );
        return versionVolumes.get(rabVersionId)!.then((m) => m.get(workItemId) ?? null);
      };

      const errors: string[] = [];
      const changes: { workItemCode: string; old: string | null; new: string; mode: string; percentage?: string }[] = [];
      for (const e of input.entries) {
        const item = items.get(e.workItemId);
        if (!item || !isTrackable(item)) {
          errors.push(`Work item ${item?.workItem?.internalCode ?? e.workItemId} tidak trackable di baseline ${baseline.label}.`);
          continue;
        }
        const label = `${item.workItem!.internalCode} ${item.description}`;
        const baselineVolume = item.volume!.toString();
        const itemRows = rows.filter((r) => r.workItemId === e.workItemId);
        const prev = itemRows.filter((r) => r.week.weekNumber < weekNumber).reduce((t, r) => t.plus(r.actualVolume.toString()), new Decimal(0));
        const existing = itemRows.find((r) => r.week.weekNumber === weekNumber);
        const volume = e.mode === 'VOLUME_WEEK' ? new Decimal(e.volume).toFixed() : weeklyVolumeFromPercent(e.percentage, baselineVolume, prev.toFixed());
        if (volume === null) {
          errors.push(`${label}: ${e.mode === 'PERCENT_CUMULATIVE' ? e.percentage : ''}% lebih kecil dari kumulatif sampai minggu lalu (${prev.toFixed()}).`);
          continue;
        }
        const delta = new Decimal(volume).minus(existing?.actualVolume.toString() ?? 0);
        if (delta.gt(0)) {
          // This week and every later week with progress go up by delta; each must stay within its own baseline.
          const checked = [weekNumber, ...itemRows.filter((r) => r.week.weekNumber > weekNumber).map((r) => r.week.weekNumber)].sort((a, b) => a - b);
          for (const n of checked) {
            const through = itemRows.filter((r) => r.week.weekNumber <= n).reduce((t, r) => t.plus(r.actualVolume.toString()), new Decimal(0)).plus(delta);
            let limit: string | null = baselineVolume;
            if (n !== weekNumber) {
              const b = baselineOf(assignments, weeks.find((w) => w.weekNumber === n)!);
              limit = b ? await volumeIn(b.rabVersionId, e.workItemId) : null;
            }
            if (limit !== null && through.gt(limit)) {
              errors.push(`${label}: kumulatif minggu ${n} menjadi ${through.toFixed()}, melebihi volume baseline ${new Decimal(limit).toFixed()} ${item.unit ?? ''}.`.trim());
              break;
            }
          }
        }
        const percentage = e.mode === 'PERCENT_CUMULATIVE' ? e.percentage : null;
        const note = e.note || null;
        const unchanged =
          existing &&
          new Decimal(existing.actualVolume.toString()).eq(volume) &&
          existing.inputMode === e.mode &&
          (existing.inputPercentage === null ? percentage === null : percentage !== null && new Decimal(existing.inputPercentage.toString()).eq(percentage)) &&
          existing.note === note;
        if (unchanged) continue;
        changes.push({ workItemCode: item.workItem!.internalCode, old: existing ? new Decimal(existing.actualVolume.toString()).toFixed() : null, new: volume, mode: e.mode, ...(percentage ? { percentage } : {}) });
        const data = { inputMode: e.mode, inputPercentage: percentage, actualVolume: volume, note, updatedBy: actor.id };
        if (existing) await tx.weeklyProgress.update({ where: { id: existing.id }, data });
        else await tx.weeklyProgress.create({ data: { ...data, projectId, weekId: week.id, workItemId: e.workItemId, enteredBy: actor.id } });
      }
      if (errors.length) throw new BadRequestException({ message: `Progres minggu ${weekNumber} belum disimpan: ${errors.length} masalah.`, errors });
      if (changes.length)
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'UPDATE_WEEKLY_PROGRESS',
          entityType: 'PROJECT_WEEK',
          entityId: week.id,
          projectId,
          oldValue: { weekNumber, items: changes.map((c) => ({ workItemCode: c.workItemCode, volume: c.old })) },
          newValue: { weekNumber, baseline: baseline.label, items: changes.map((c) => ({ workItemCode: c.workItemCode, volume: c.new, mode: c.mode, percentage: c.percentage })) },
        });
    });
    return this.get(projectId, weekNumber);
  }

  /** D-075: each work item's weekly volume over the days of the week. */
  async daily(projectId: string, weekNumber: number): Promise<DailyAllocationDto> {
    const progress = await this.get(projectId, weekNumber);
    const days = weekDays(progress.week);
    const rows = new Map(
      (
        await this.prisma.weeklyProgress.findMany({
          where: { projectId, week: { weekNumber } },
          select: { workItemId: true, dailyMethod: true, dailyAllocations: { select: { workDate: true, volume: true } } },
        })
      ).map((r) => [r.workItemId, r]),
    );
    return {
      week: progress.week,
      days,
      rows: progress.rows
        .filter((r) => r.workItemId && r.thisWeek)
        .map((r) => {
          const p = rows.get(r.workItemId!)!;
          const volumes = volumesOf(p.dailyMethod, p.dailyAllocations, r.thisWeek!.volume, days);
          return {
            workItemId: r.workItemId!,
            workItemCode: r.workItemCode,
            description: r.description,
            unit: r.unit,
            weekVolume: r.thisWeek!.volume,
            method: p.dailyMethod,
            volumes,
            mismatch: !sumOf(volumes).eq(r.thisWeek!.volume),
          };
        }),
    };
  }

  async saveDaily(actor: AuthUser, projectId: string, weekNumber: number, workItemId: string, input: SaveDailyAllocationInput): Promise<DailyAllocationDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const project = await findProject(tx, projectId);
      if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; alokasi harian tidak dapat diubah.');
      const week = await findWeek(tx, projectId, weekNumber);
      if (week.startDate > today()) throw new ConflictException(`Minggu ${weekNumber} belum dimulai (mulai ${week.startDate}).`);
      const p = await tx.weeklyProgress.findUnique({
        where: { weekId_workItemId: { weekId: week.id, workItemId } },
        select: { id: true, actualVolume: true, dailyMethod: true, dailyAllocations: { select: { workDate: true, volume: true } }, workItem: { select: { internalCode: true } } },
      });
      if (!p) throw new NotFoundException(`Work item ini belum punya progres di minggu ${weekNumber}.`);
      const days = weekDays(week);
      const weekVolume = new Decimal(p.actualVolume.toString()).toFixed();
      const old = volumesOf(p.dailyMethod, p.dailyAllocations, weekVolume, days);

      let volumes: string[];
      if (input.method === 'MANUAL') {
        if (input.volumes.length !== days.length) throw new BadRequestException(`Isi ${days.length} hari untuk minggu ${weekNumber}.`);
        volumes = input.volumes.map((v) => new Decimal(v).toFixed());
        const total = sumOf(volumes);
        if (!total.eq(weekVolume)) throw new BadRequestException(`Jumlah harian ${total.toFixed()} tidak sama dengan volume minggu ${weekVolume}.`);
        for (const [i, d] of days.entries())
          await tx.dailyAllocation.upsert({
            where: { weeklyProgressId_workDate: { weeklyProgressId: p.id, workDate: toDbDate(d.date) } },
            create: { weeklyProgressId: p.id, workDate: toDbDate(d.date), volume: volumes[i]!, updatedBy: actor.id },
            update: { volume: volumes[i]!, updatedBy: actor.id },
          });
      } else volumes = volumesOf('DAILY_FACTOR', [], weekVolume, days);
      // Rows of a former MANUAL stay in daily_allocations (D-075 butir 6); the method decides which volumes count.
      await tx.weeklyProgress.update({ where: { id: p.id }, data: { dailyMethod: input.method } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'UPDATE_DAILY_ALLOCATION',
        entityType: 'PROJECT_WEEK',
        entityId: week.id,
        projectId,
        oldValue: { weekNumber, workItemCode: p.workItem.internalCode, method: p.dailyMethod, volumes: old },
        newValue: { weekNumber, workItemCode: p.workItem.internalCode, method: input.method, volumes },
      });
    });
    return this.daily(projectId, weekNumber);
  }
}

type Day = DailyAllocationDto['days'][number];
const weekDays = (w: Pick<Week, 'startDate' | 'endDate'>): Day[] =>
  Array.from({ length: daysInclusive(w.startDate, w.endDate) }, (_, i) => ({ date: addDays(w.startDate, i), day: i + 1, factor: DEFAULT_DAILY_FACTORS[i]! }));
const sumOf = (volumes: string[]) => volumes.reduce((t, v) => t.plus(v), new Decimal(0));

function volumesOf(method: DailyAllocationMethod, manual: { workDate: Date; volume: { toString(): string } }[], weekVolume: string, days: Day[]): string[] {
  if (method === 'MANUAL') {
    const byDate = new Map(manual.map((a) => [fromDbDate(a.workDate), new Decimal(a.volume.toString()).toFixed()]));
    return days.map((d) => byDate.get(d.date) ?? '0');
  }
  // The default factors are all > 0, so allocateDaily always has an active day.
  return allocateDaily(weekVolume, days.map((d) => d.factor))!;
}

async function findProject(db: Db, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  return project;
}

async function loadWeeks(db: Db, projectId: string): Promise<Week[]> {
  const rows = await db.projectWeek.findMany({ where: { projectId }, select: { id: true, weekNumber: true, startDate: true, endDate: true }, orderBy: { weekNumber: 'asc' } });
  return rows.map((w) => ({ id: w.id, weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) }));
}

async function findWeek(db: Db, projectId: string, weekNumber: number): Promise<Week> {
  const w = await db.projectWeek.findUnique({ where: { projectId_weekNumber: { projectId, weekNumber } }, select: { id: true, weekNumber: true, startDate: true, endDate: true } });
  if (!w) throw new NotFoundException(`Minggu ${weekNumber} tidak ada di proyek ini.`);
  return { id: w.id, weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) };
}

const liveAssignments = async (db: Db, projectId: string) =>
  (
    await db.baselineAssignment.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true, rabVersion: { select: { id: true, versionType: true, revisionNumber: true } } },
    })
  ).map((a) => ({ effectiveFrom: fromDbDate(a.effectiveFrom), rabVersionId: a.rabVersion.id, label: rabVersionLabel(a.rabVersion) }));

/** D-073 butir 3: the version in force on the last day of the week. */
function baselineOf(assignments: Awaited<ReturnType<typeof liveAssignments>>, week: Week) {
  return assignments.filter((a) => a.effectiveFrom <= week.endDate).at(-1) ?? null;
}

function summary(week: Week, baseline: ReturnType<typeof baselineOf>, active: boolean, filledCount: number): ProgressWeekSummaryDto {
  return {
    weekNumber: week.weekNumber,
    startDate: week.startDate,
    endDate: week.endDate,
    baseline: baseline && { rabVersionId: baseline.rabVersionId, label: baseline.label },
    open: active && week.startDate <= today(),
    filledCount,
  };
}

type BaselineItem = Awaited<ReturnType<typeof baselineItems>>[number];
const isTrackable = (i: Pick<BaselineItem, 'rowType' | 'workItemId' | 'volume'>) => i.rowType === 'ITEM' && Boolean(i.workItemId) && Boolean(i.volume?.gt(0));

/** RAB rows of a version depth-first in sort order, as the RAB grid shows them. */
async function baselineItems(db: Db, rabVersionId: string) {
  const rows = await db.rabVersionItem.findMany({
    where: { rabVersionId },
    select: { id: true, parentItemId: true, sortOrder: true, rowType: true, displayNumber: true, description: true, unit: true, volume: true, workItemId: true, workItem: { select: { internalCode: true } } },
  });
  const children = new Map<string | null, typeof rows>();
  for (const r of rows) children.set(r.parentItemId, [...(children.get(r.parentItemId) ?? []), r]);
  const out: ((typeof rows)[number] & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of (children.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** D-071 butir 5 (active since M9): reported progress up to the week before `effectiveFrom` above the new volumes. */
export async function baselineVolumeWarnings(tx: Prisma.TransactionClient, projectId: string, rabVersionId: string, effectiveFrom: string) {
  const reported = await tx.weeklyProgress.groupBy({
    by: ['workItemId'],
    where: { projectId, week: { endDate: { lt: toDbDate(effectiveFrom) } } },
    _sum: { actualVolume: true },
  });
  if (!reported.length) return [];
  const items = new Map((await baselineItems(tx, rabVersionId)).filter((i) => i.workItemId).map((i) => [i.workItemId!, i]));
  const over = reported.filter((r) => new Decimal(r._sum.actualVolume?.toString() ?? 0).gt(items.get(r.workItemId)?.volume?.toString() ?? 0));
  if (!over.length) return [];
  const workItems = new Map(
    (await tx.workItem.findMany({ where: { id: { in: over.map((o) => o.workItemId) } }, select: { id: true, internalCode: true, canonicalDescription: true } })).map((w) => [w.id, w]),
  );
  return over.map((o) => ({
    workItemId: o.workItemId,
    workItemCode: workItems.get(o.workItemId)!.internalCode,
    description: workItems.get(o.workItemId)!.canonicalDescription,
    reported: new Decimal(o._sum.actualVolume!.toString()).toFixed(),
    newVolume: new Decimal(items.get(o.workItemId)?.volume?.toString() ?? 0).toFixed(),
  }));
}
