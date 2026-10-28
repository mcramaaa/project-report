import { addDays, plannedFinishDate, projectWeeks, type CalendarWeek } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  rabVersionRank,
  type ActivateBaselineInput,
  type BaselineAssignmentDto,
  type BaselineCandidateDto,
  type ProjectBaselinesDto,
  type RabVersionType,
} from '@laporan-proyek/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate, toDbDate } from '../projects/project-calendar';

type Db = Prisma.TransactionClient | PrismaService;
type VersionRow = { id: string; versionType: RabVersionType; revisionNumber: number; documentNumber: string | null; documentDate: Date | null };

const VERSION_SELECT = { id: true, versionType: true, revisionNumber: true, documentNumber: true, documentDate: true } as const;
const versionRef = (v: VersionRow) => ({
  id: v.id,
  label: rabVersionLabel(v),
  documentNumber: v.documentNumber,
  documentDate: v.documentDate ? fromDbDate(v.documentDate) : null,
});

/** Live (not revoked) assignments of a project in date order. */
const liveAssignments = (db: Db, projectId: string) =>
  db.baselineAssignment.findMany({
    where: { projectId, revokedAt: null },
    orderBy: { effectiveFrom: 'asc' },
    include: { rabVersion: { select: VERSION_SELECT }, createdByUser: { select: { id: true, name: true } } },
  });

/** First project week starting after the document date (D-020 "minggu berikutnya", D-071). */
const weekAfter = (weeks: CalendarWeek[], date: string | null) => (date ? (weeks.find((w) => w.startDate > date) ?? null) : null);

/**
 * D-071: which approved RAB version is in force from which date. `baseline_assignments` is the only source
 * of truth; the end of an assignment and the split of a week are computed, never stored.
 */
@Injectable()
export class BaselinesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(projectId: string): Promise<ProjectBaselinesDto> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { startDate: true, durationDays: true } });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    const start = fromDbDate(project.startDate);
    const finish = plannedFinishDate(start, project.durationDays);
    const weeks = projectWeeks(start, project.durationDays);
    const live = await liveAssignments(this.prisma, projectId);
    const assignments: BaselineAssignmentDto[] = live.map((a, i) => ({
      id: a.id,
      rabVersion: versionRef(a.rabVersion),
      effectiveFrom: fromDbDate(a.effectiveFrom),
      effectiveTo: i + 1 < live.length ? addDays(fromDbDate(live[i + 1]!.effectiveFrom), -1) : finish,
      activationMode: a.activationMode,
      reason: a.reason,
      createdBy: a.createdByUser,
      createdAt: a.createdAt.toISOString(),
      revocable: i === live.length - 1,
    }));

    const lastRank = live.length ? rabVersionRank(live.at(-1)!.rabVersion) : -1;
    const approved = await this.prisma.rabVersion.findMany({ where: { projectId, status: 'APPROVED' }, select: VERSION_SELECT });
    const candidates: BaselineCandidateDto[] = approved
      .filter((v) => rabVersionRank(v) > lastRank && (live.length ? v.versionType === 'MC' : v.versionType === 'CONTRACT'))
      .sort((a, b) => rabVersionRank(a) - rabVersionRank(b))
      .map((v) => {
        const documentDate = v.documentDate ? fromDbDate(v.documentDate) : null;
        const next = weekAfter(weeks, documentDate);
        return {
          rabVersion: versionRef(v),
          nextWeek: v.versionType === 'CONTRACT' || !next ? null : { effectiveFrom: next.startDate, weekNumber: next.weekNumber },
          exactDefault: v.versionType === 'CONTRACT' ? start : documentDate && documentDate >= start && documentDate <= finish ? documentDate : null,
          fixedDate: v.versionType === 'CONTRACT' ? start : null,
        };
      });

    return {
      assignments,
      candidates,
      weeks: weeks.map((w) => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        endDate: w.endDate,
        segments: assignments
          .filter((a) => a.effectiveFrom <= w.endDate && a.effectiveTo >= w.startDate)
          .map((a) => ({
            rabVersionId: a.rabVersion.id,
            label: a.rabVersion.label,
            startDate: a.effectiveFrom > w.startDate ? a.effectiveFrom : w.startDate,
            endDate: a.effectiveTo < w.endDate ? a.effectiveTo : w.endDate,
          })),
      })),
    };
  }

  async activate(actor: AuthUser, projectId: string, input: ActivateBaselineInput): Promise<ProjectBaselinesDto> {
    await this.prisma.$transaction(async (tx) => {
      const project = await lockProject(tx, projectId);
      if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; baseline tidak dapat diubah.');
      const start = fromDbDate(project.startDate);
      const finish = plannedFinishDate(start, project.durationDays);
      const version = await tx.rabVersion.findFirst({ where: { id: input.rabVersionId, projectId }, select: { ...VERSION_SELECT, status: true } });
      if (!version) throw new NotFoundException('Versi RAB tidak ditemukan di proyek ini.');
      if (version.status !== 'APPROVED') throw new ConflictException('Hanya versi RAB approved yang dapat dijadikan baseline.');
      const live = await liveAssignments(tx, projectId);
      const last = live.at(-1);
      const label = rabVersionLabel(version);
      if (!last && version.versionType !== 'CONTRACT') throw new ConflictException('Baseline pertama harus RAB Kontrak.');
      if (last && (version.versionType === 'CONTRACT' || rabVersionRank(version) <= rabVersionRank(last.rabVersion)))
        throw new ConflictException(`${label} tidak dapat diaktifkan: baseline yang berlaku sudah ${rabVersionLabel(last.rabVersion)}; urutan versi hanya maju.`);

      const documentDate = version.documentDate ? fromDbDate(version.documentDate) : null;
      let effectiveFrom: string;
      let weekNumber: number | null = null;
      if (version.versionType === 'CONTRACT') effectiveFrom = start;
      else if (input.activationMode === 'NEXT_WEEK') {
        if (!documentDate) throw new BadRequestException(`Isi tanggal dokumen ${label} lebih dahulu, atau pilih tanggal pasti.`);
        const next = weekAfter(projectWeeks(start, project.durationDays), documentDate);
        if (!next) throw new ConflictException(`Tidak ada minggu proyek setelah tanggal dokumen ${label}; pilih tanggal pasti.`);
        effectiveFrom = next.startDate;
        weekNumber = next.weekNumber;
      } else {
        const date = input.effectiveFrom ?? documentDate;
        if (!date) throw new BadRequestException('Isi tanggal efektif.');
        effectiveFrom = date;
      }
      if (effectiveFrom < start || effectiveFrom > finish)
        throw new ConflictException(`Tanggal efektif ${effectiveFrom} di luar masa proyek (${start} s.d. ${finish}).`);
      if (last && effectiveFrom <= fromDbDate(last.effectiveFrom))
        throw new ConflictException(
          `Tanggal efektif ${label} harus sesudah tanggal efektif ${rabVersionLabel(last.rabVersion)} (${fromDbDate(last.effectiveFrom)}).`,
        );
      // D-071 butir 5 (OD-003): the check of new volumes against reported progress starts when M9 stores progress.

      const activationMode = version.versionType === 'CONTRACT' ? 'EXACT_DATE' : input.activationMode;
      const created = await tx.baselineAssignment.create({
        data: { projectId, rabVersionId: version.id, effectiveFrom: toDbDate(effectiveFrom), activationMode, reason: input.reason || null, createdBy: actor.id },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'ACTIVATE_BASELINE',
        entityType: 'BASELINE_ASSIGNMENT',
        entityId: created.id,
        projectId,
        oldValue: { rabVersion: last ? rabVersionLabel(last.rabVersion) : null },
        newValue: { rabVersionId: version.id, rabVersion: label, effectiveFrom, activationMode, weekNumber },
        reason: input.reason,
      });
    });
    return this.get(projectId);
  }

  /** Only the latest live assignment; the previous one is in force again until the project end. */
  async revoke(actor: AuthUser, projectId: string, assignmentId: string, reason: string): Promise<ProjectBaselinesDto> {
    await this.prisma.$transaction(async (tx) => {
      const project = await lockProject(tx, projectId);
      if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; baseline tidak dapat diubah.');
      const live = await liveAssignments(tx, projectId);
      const target = live.find((a) => a.id === assignmentId);
      if (!target) throw new NotFoundException('Aktivasi baseline tidak ditemukan atau sudah dicabut.');
      if (target !== live.at(-1)) throw new ConflictException('Hanya aktivasi baseline terakhir yang dapat dicabut.');
      await tx.baselineAssignment.update({ where: { id: target.id }, data: { revokedAt: new Date(), revokedBy: actor.id, revokeReason: reason } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'REVOKE_BASELINE',
        entityType: 'BASELINE_ASSIGNMENT',
        entityId: target.id,
        projectId,
        oldValue: { rabVersion: rabVersionLabel(target.rabVersion), effectiveFrom: fromDbDate(target.effectiveFrom) },
        newValue: { revoked: true, inForce: live.length > 1 ? rabVersionLabel(live.at(-2)!.rabVersion) : null },
        reason,
      });
    });
    return this.get(projectId);
  }
}

async function lockProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true, startDate: true, durationDays: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  return project;
}

/**
 * D-071 butir 8: on a schedule change (caller holds the project lock) the Kontrak assignment follows the new
 * start date; any other assignment must still fall after the start and on/before the planned finish.
 */
export async function alignBaselinesWithSchedule(tx: Prisma.TransactionClient, projectId: string, startDate: string, durationDays: number) {
  const live = await liveAssignments(tx, projectId);
  if (!live.length) return;
  const finish = plannedFinishDate(startDate, durationDays);
  const outside = live.slice(1).find((a) => fromDbDate(a.effectiveFrom) <= startDate || fromDbDate(a.effectiveFrom) > finish);
  if (outside)
    throw new ConflictException(
      `Baseline ${rabVersionLabel(outside.rabVersion)} berlaku mulai ${fromDbDate(outside.effectiveFrom)}, di luar jadwal baru; cabut aktivasinya lebih dahulu.`,
    );
  await tx.baselineAssignment.update({ where: { id: live[0]!.id }, data: { effectiveFrom: toDbDate(startDate) } });
}
