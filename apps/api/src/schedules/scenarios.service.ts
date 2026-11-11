import { addDays, Decimal, plannedCurve, validateSchedule } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  SCENARIO_EXTRA_WEEKS,
  type CreateScenarioInput,
  type SaveScenarioInput,
  type ScenarioDetailDto,
  type ScenarioSummaryDto,
} from '@laporan-proyek/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadSchedule, lockActiveProject, lockEditable, replaceEntries } from './schedules.service';

type Db = Prisma.TransactionClient | PrismaService;

const SCENARIO_SELECT = {
  id: true,
  name: true,
  weekCount: true,
  updatedAt: true,
  scheduleVersionId: true,
  updatedByUser: { select: { id: true, name: true } },
  scheduleVersion: { select: { id: true, status: true, rabVersion: { select: { versionType: true, revisionNumber: true } } } },
} as const;

/** D-078: what-if copies of a schedule; the official schedule changes only through promote. */
@Injectable()
export class ScenariosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string): Promise<ScenarioSummaryDto[]> {
    const rows = await this.prisma.scheduleScenario.findMany({ where: { projectId }, select: SCENARIO_SELECT, orderBy: { updatedAt: 'desc' } });
    return rows.map(summary);
  }

  async create(actor: AuthUser, projectId: string, input: CreateScenarioInput): Promise<ScenarioDetailDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await lockActiveProject(tx, projectId);
      const ctx = await loadSchedule(tx, projectId, input.scheduleId);
      const created = await tx.scheduleScenario.create({
        data: {
          projectId,
          scheduleVersionId: ctx.schedule.id,
          name: input.name,
          weekCount: ctx.weeks.length,
          createdBy: actor.id,
          updatedBy: actor.id,
          entries: { createMany: { data: ctx.entries.map((e) => ({ groupItemId: e.groupId, weekNumber: e.weekNumber, plannedWeight: e.weight })) } },
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'CREATE_SCHEDULE_SCENARIO',
        entityType: 'SCHEDULE_SCENARIO',
        entityId: created.id,
        projectId,
        newValue: { name: input.name, schedule: rabVersionLabel(ctx.schedule.rabVersion), entryCount: ctx.entries.length },
      });
      return created.id;
    });
    return this.get(projectId, id);
  }

  async get(projectId: string, scenarioId: string): Promise<ScenarioDetailDto> {
    const { scenario, ctx, entries } = await loadScenario(this.prisma, projectId, scenarioId);
    const weeks = Array.from({ length: scenario.weekCount }, (_, i) => {
      const w = ctx.weeks[i];
      if (w) return { weekNumber: w.weekNumber, startDate: w.startDate, endDate: w.endDate };
      // Past the project end: 7-day weeks continuing from the last project week (scenario only).
      const start = addDays(ctx.weeks.at(-1)!.endDate, 1 + (i - ctx.weeks.length) * 7);
      return { weekNumber: i + 1, startDate: start, endDate: addDays(start, 6) };
    });
    const issues = validateSchedule(
      ctx.groups.map((g) => ({ id: g.id, label: `${g.displayNumber ?? ''} ${g.description}`.trim(), weight: g.weight })),
      entries,
      scenario.weekCount,
    );
    const blockers: string[] = [];
    if (ctx.schedule.status === 'APPROVED') blockers.push('Jadwal resmi masih approved; buka kembali untuk revisi dulu.');
    if (ctx.schedule.rabVersion.status !== 'APPROVED') blockers.push('Versi RAB jadwal ini sedang tidak approved.');
    if (entries.some((e) => e.weekNumber > ctx.weeks.length))
      blockers.push(`Ada isian setelah minggu ${ctx.weeks.length} (akhir proyek); ubah masa pelaksanaan proyek dulu.`);
    if (issues.length) blockers.push(`${issues.length} masalah validasi (jumlah per kelompok harus sama dengan bobotnya).`);
    return {
      ...summary(scenario),
      projectWeekCount: ctx.weeks.length,
      weeks,
      groups: ctx.groups.map((g) => ({ ...g, planned: entries.filter((e) => e.groupId === g.id).reduce((t, e) => t.plus(e.weight), new Decimal(0)).toFixed() })),
      entries,
      curve: plannedCurve(entries, scenario.weekCount),
      issues,
      promoteBlockers: blockers,
    };
  }

  async save(actor: AuthUser, projectId: string, scenarioId: string, input: SaveScenarioInput): Promise<ScenarioDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveProject(tx, projectId);
      const { scenario, ctx } = await loadScenario(tx, projectId, scenarioId);
      if (input.weekCount < ctx.weeks.length || input.weekCount > ctx.weeks.length + SCENARIO_EXTRA_WEEKS)
        throw new BadRequestException(`Jumlah minggu skenario ${ctx.weeks.length}–${ctx.weeks.length + SCENARIO_EXTRA_WEEKS}.`);
      const groups = new Set(ctx.groups.map((g) => g.id));
      const seen = new Set<string>();
      for (const e of input.entries) {
        if (!groups.has(e.groupId)) throw new BadRequestException('Isian merujuk baris yang bukan kelompok jadwal versi RAB ini.');
        if (e.weekNumber > input.weekCount) throw new BadRequestException(`Minggu ${e.weekNumber} di luar skenario (1–${input.weekCount}).`);
        const key = `${e.groupId}/${e.weekNumber}`;
        if (seen.has(key)) throw new BadRequestException(`Isian ganda untuk kelompok yang sama pada minggu ${e.weekNumber}.`);
        seen.add(key);
      }
      await tx.scheduleScenarioEntry.deleteMany({ where: { scenarioId } });
      await tx.scheduleScenarioEntry.createMany({
        data: input.entries.filter((e) => Number(e.weight) !== 0).map((e) => ({ scenarioId, groupItemId: e.groupId, weekNumber: e.weekNumber, plannedWeight: e.weight })),
      });
      await tx.scheduleScenario.update({ where: { id: scenarioId }, data: { name: input.name, weekCount: input.weekCount, updatedBy: actor.id } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'UPDATE_SCHEDULE_SCENARIO',
        entityType: 'SCHEDULE_SCENARIO',
        entityId: scenarioId,
        projectId,
        oldValue: { name: scenario.name, weekCount: scenario.weekCount },
        newValue: { name: input.name, weekCount: input.weekCount, entryCount: input.entries.length },
      });
    });
    return this.get(projectId, scenarioId);
  }

  async remove(actor: AuthUser, projectId: string, scenarioId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveProject(tx, projectId);
      const { scenario } = await loadScenario(tx, projectId, scenarioId);
      await tx.scheduleScenario.delete({ where: { id: scenarioId } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'DELETE_SCHEDULE_SCENARIO',
        entityType: 'SCHEDULE_SCENARIO',
        entityId: scenarioId,
        projectId,
        oldValue: { name: scenario.name, weekCount: scenario.weekCount },
      });
    });
  }

  /** D-078 butir 6: the scenario's entries replace the official schedule's (DRAFT/REOPENED only); approval stays separate. */
  async promote(actor: AuthUser, projectId: string, scenarioId: string): Promise<ScenarioDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveProject(tx, projectId);
      const { scenario, entries } = await loadScenario(tx, projectId, scenarioId);
      const ctx = await lockEditable(tx, projectId, scenario.scheduleVersionId);
      const issues = validateSchedule(
        ctx.groups.map((g) => ({ id: g.id, label: `${g.displayNumber ?? ''} ${g.description}`.trim(), weight: g.weight })),
        entries,
        ctx.weeks.length,
      );
      if (issues.length) throw new ConflictException({ message: 'Skenario belum dapat dijadikan jadwal resmi.', errors: issues.map((i) => i.message) });
      const count = await replaceEntries(tx, ctx, entries);
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'PROMOTE_SCHEDULE_SCENARIO',
        entityType: 'SCHEDULE_VERSION',
        entityId: ctx.schedule.id,
        projectId,
        oldValue: { entryCount: ctx.entries.length },
        newValue: { scenarioId, scenario: scenario.name, entryCount: count },
      });
    });
    return this.get(projectId, scenarioId);
  }
}

function summary(s: {
  id: string;
  name: string;
  weekCount: number;
  updatedAt: Date;
  updatedByUser: { id: string; name: string };
  scheduleVersion: { id: string; status: 'DRAFT' | 'APPROVED' | 'REOPENED'; rabVersion: Parameters<typeof rabVersionLabel>[0] };
}): ScenarioSummaryDto {
  return {
    id: s.id,
    name: s.name,
    weekCount: s.weekCount,
    updatedAt: s.updatedAt.toISOString(),
    updatedBy: s.updatedByUser,
    schedule: { id: s.scheduleVersion.id, status: s.scheduleVersion.status, rabVersionLabel: rabVersionLabel(s.scheduleVersion.rabVersion) },
  };
}

async function loadScenario(db: Db, projectId: string, scenarioId: string) {
  const scenario = await db.scheduleScenario.findFirst({ where: { id: scenarioId, projectId }, select: SCENARIO_SELECT });
  if (!scenario) throw new NotFoundException('Skenario tidak ditemukan.');
  const [ctx, rows] = await Promise.all([
    loadSchedule(db, projectId, scenario.scheduleVersionId),
    db.scheduleScenarioEntry.findMany({ where: { scenarioId }, select: { groupItemId: true, weekNumber: true, plannedWeight: true }, orderBy: { weekNumber: 'asc' } }),
  ]);
  const entries = rows.map((r) => ({ groupId: r.groupItemId, weekNumber: r.weekNumber, weight: r.plannedWeight.toFixed() }));
  return { scenario, ctx, entries };
}
