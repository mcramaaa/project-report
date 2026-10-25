import { daysInclusive, Decimal, plannedFinishDate } from '@laporan-proyek/calc';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PROJECT_CREATOR_REQUIRED_PERMISSIONS,
  PROJECT_CREATOR_ROLE,
  type ChangeScheduleInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type MyProjectDto,
  type Paginated,
  type ProjectDto,
  type ProjectStatus,
  type ProjectTeamMemberDto,
  type ProjectWeekDto,
  type ReportPeriodDto,
  type UpdateProjectInput,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate, syncProjectCalendar, toDbDate } from './project-calendar';

type ProjectRow = Prisma.ProjectGetPayload<object>;
type IdentityInput = Omit<UpdateProjectInput, 'reason'>;

const CODE_TAKEN = 'Kode proyek sudah dipakai.';
const DATE_FIELDS = new Set(['contractDate', 'spmkDate']);

function toDto(project: ProjectRow): Omit<ProjectDto, 'permissions'> {
  const startDate = fromDbDate(project.startDate);
  return {
    id: project.id,
    code: project.code,
    activityName: project.activityName,
    subActivityName: project.subActivityName,
    projectName: project.projectName,
    location: project.location,
    fiscalYear: project.fiscalYear,
    contractorName: project.contractorName,
    consultantName: project.consultantName,
    contractNumber: project.contractNumber,
    contractDate: fromDbDate(project.contractDate),
    contractValue: project.contractValue?.toFixed(2) ?? null,
    spmkNumber: project.spmkNumber,
    spmkDate: fromDbDate(project.spmkDate),
    startDate,
    durationDays: project.durationDays,
    plannedFinishDate: plannedFinishDate(startDate, project.durationDays),
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

/** API identity values -> Prisma data (dates as @db.Date, contract value as Decimal). */
function toIdentityData(input: IdentityInput): Prisma.ProjectUpdateInput {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    data[key] = DATE_FIELDS.has(key) ? toDbDate(value as string) : key === 'contractValue' ? new Decimal(value as string).toFixed(2) : value;
  }
  return data;
}

function scheduleSnapshot(startDate: string, durationDays: number, counts: { weeks: number; periods: number }) {
  return { startDate, durationDays, plannedFinishDate: plannedFinishDate(startDate, durationDays), ...counts };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /**
   * Projects the user may open: same rule as ProjectPermissionGuard for project.read
   * (active membership, active role holding project.read); a super admin sees every project (D-035).
   */
  async listMine(user: AuthUser, query: ListProjectsQuery): Promise<Paginated<MyProjectDto>> {
    const readable = { userId: user.id, revokedAt: null, role: { isActive: true, permissions: { some: { permissionCode: 'project.read' } } } };
    const where: Prisma.ProjectWhereInput = {
      ...(user.isSystemAdmin ? {} : { members: { some: readable } }),
      ...(query.search ? { OR: [{ code: { contains: query.search } }, { projectName: { contains: query.search } }] } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        select: {
          id: true,
          code: true,
          projectName: true,
          fiscalYear: true,
          status: true,
          startDate: true,
          durationDays: true,
          members: { where: { userId: user.id, revokedAt: null }, select: { role: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { code: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items = projects.map(({ members, startDate, durationDays, ...project }) => ({
      ...project,
      startDate: fromDbDate(startDate),
      plannedFinishDate: plannedFinishDate(fromDbDate(startDate), durationDays),
      role: members[0]?.role ?? null,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Caller must already be authorized for the project (ProjectPermissionGuard). */
  async get(user: AuthUser, projectId: string): Promise<ProjectDto> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    return { ...toDto(project), permissions: await this.access.projectPermissions(user, projectId) };
  }

  /** Project, creator's MANAGER membership, weeks/periods, and audit commit together (D-039). */
  async create(actor: AuthUser, input: CreateProjectInput): Promise<ProjectDto> {
    try {
      const projectId = await this.prisma.$transaction(async (tx) => {
        const manager = await tx.role.findUnique({
          where: { code: PROJECT_CREATOR_ROLE },
          select: { id: true, isActive: true, scope: true, permissions: { select: { permissionCode: true } } },
        });
        const held = new Set(manager?.permissions.map((p) => p.permissionCode));
        const missing = PROJECT_CREATOR_REQUIRED_PERMISSIONS.filter((code) => !held.has(code));
        if (!manager || !manager.isActive || manager.scope !== 'PROJECT' || missing.length > 0) {
          throw new ConflictException(
            `Konfigurasi role ${PROJECT_CREATOR_ROLE} tidak lengkap: pembuat proyek menjadi ${PROJECT_CREATOR_ROLE} dan role itu wajib memiliki ` +
              `${PROJECT_CREATOR_REQUIRED_PERMISSIONS.join(' dan ')}${missing.length ? ` (kurang: ${missing.join(', ')})` : ''}. ` +
              'Proyek tidak dibuat; minta super admin memperbaiki permission role tersebut.',
          );
        }

        const { startDate, durationDays, ...identity } = input;
        const project = await tx.project.create({
          data: { ...(toIdentityData(identity) as Prisma.ProjectCreateInput), startDate: toDbDate(startDate), durationDays },
        });
        await tx.projectUser.create({ data: { projectId: project.id, userId: actor.id, roleId: manager.id, createdBy: actor.id } });
        const counts = await syncProjectCalendar(tx, project.id, startDate, durationDays);
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'CREATE_PROJECT',
          entityType: 'PROJECT',
          entityId: project.id,
          projectId: project.id,
          newValue: { ...identity, ...scheduleSnapshot(startDate, durationDays, counts), status: project.status, managerUserId: actor.id },
        });
        return project.id;
      });
      return this.get(actor, projectId);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(CODE_TAKEN);
      throw err;
    }
  }

  async update(actor: AuthUser, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const { reason, ...changes } = input;
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = toDto(await this.lockActive(tx, projectId));
        const changed = (Object.entries(changes) as [string, string | number | undefined][]).filter(([key, value]) => value !== undefined && current[key as keyof typeof current] !== normalize(key, value));
        if (changed.length === 0) return;
        const newValue = Object.fromEntries(changed.map(([key, value]) => [key, normalize(key, value)]));
        await tx.project.update({ where: { id: projectId }, data: toIdentityData(newValue) });
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'UPDATE_PROJECT',
          entityType: 'PROJECT',
          entityId: projectId,
          projectId,
          oldValue: Object.fromEntries(changed.map(([key]) => [key, current[key as keyof typeof current]])),
          newValue,
          reason,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(CODE_TAKEN);
      throw err;
    }
    return this.get(actor, projectId);
  }

  /** D-038 (Milestone 3): allowed while ACTIVE; weeks/periods are rebuilt in the same transaction. */
  async changeSchedule(actor: AuthUser, projectId: string, input: ChangeScheduleInput): Promise<ProjectDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = toDto(await this.lockActive(tx, projectId));
      if (current.startDate === input.startDate && current.durationDays === input.durationDays) {
        throw new BadRequestException('Tanggal mulai dan masa pelaksanaan tidak berubah.');
      }
      const before = { weeks: await tx.projectWeek.count({ where: { projectId } }), periods: await tx.reportPeriod.count({ where: { projectId } }) };
      await tx.project.update({ where: { id: projectId }, data: { startDate: toDbDate(input.startDate), durationDays: input.durationDays } });
      const after = await syncProjectCalendar(tx, projectId, input.startDate, input.durationDays);
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'CHANGE_PROJECT_SCHEDULE',
        entityType: 'PROJECT',
        entityId: projectId,
        projectId,
        oldValue: scheduleSnapshot(current.startDate, current.durationDays, before),
        newValue: scheduleSnapshot(input.startDate, input.durationDays, after),
        reason: input.reason,
      });
    });
    return this.get(actor, projectId);
  }

  /** ACTIVE <-> CLOSED with a mandatory reason (D-036). Reports and snapshots are not touched. */
  async setStatus(actor: AuthUser, projectId: string, status: ProjectStatus, reason: string): Promise<ProjectDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, projectId);
      if (current.status === status) throw new ConflictException(status === 'CLOSED' ? 'Proyek sudah ditutup.' : 'Proyek sudah aktif.');
      await tx.project.update({ where: { id: projectId }, data: { status } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: status === 'CLOSED' ? 'CLOSE_PROJECT' : 'REOPEN_PROJECT',
        entityType: 'PROJECT',
        entityId: projectId,
        projectId,
        oldValue: { status: current.status },
        newValue: { status },
        reason,
      });
    });
    return this.get(actor, projectId);
  }

  async listWeeks(projectId: string): Promise<ProjectWeekDto[]> {
    const weeks = await this.prisma.projectWeek.findMany({
      where: { projectId },
      select: { id: true, weekNumber: true, startDate: true, endDate: true, reportPeriod: { select: { periodNumber: true } } },
      orderBy: { weekNumber: 'asc' },
    });
    return weeks.map((w) => {
      const [startDate, endDate] = [fromDbDate(w.startDate), fromDbDate(w.endDate)];
      return { id: w.id, weekNumber: w.weekNumber, periodNumber: w.reportPeriod.periodNumber, startDate, endDate, days: daysInclusive(startDate, endDate) };
    });
  }

  async listPeriods(projectId: string): Promise<ReportPeriodDto[]> {
    const periods = await this.prisma.reportPeriod.findMany({
      where: { projectId },
      select: { id: true, periodNumber: true, startDate: true, endDate: true, weeks: { select: { weekNumber: true }, orderBy: { weekNumber: 'asc' } } },
      orderBy: { periodNumber: 'asc' },
    });
    return periods.map((p) => {
      const [startDate, endDate] = [fromDbDate(p.startDate), fromDbDate(p.endDate)];
      return {
        id: p.id,
        periodNumber: p.periodNumber,
        startDate,
        endDate,
        firstWeekNumber: p.weeks[0]?.weekNumber ?? 0,
        lastWeekNumber: p.weeks.at(-1)?.weekNumber ?? 0,
        days: daysInclusive(startDate, endDate),
      };
    });
  }

  /** Active members who are active users; names and roles only, no email (D-039). */
  async listTeam(projectId: string): Promise<ProjectTeamMemberDto[]> {
    const rows = await this.prisma.projectUser.findMany({
      where: { projectId, revokedAt: null, user: { isActive: true } },
      select: { user: { select: { id: true, name: true } }, role: { select: { id: true, code: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((row) => ({ userId: row.user.id, name: row.user.name, role: row.role }));
  }

  /** Row lock so concurrent changes to one project serialize. */
  private async lock(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectRow> {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    return project;
  }

  private async lockActive(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectRow> {
    const project = await this.lock(tx, projectId);
    if (project.status === 'CLOSED') throw new ConflictException('Proyek sudah ditutup; buka kembali proyek untuk mengubah data.');
    return project;
  }
}

/** Compare and store contract values with exactly two decimals ("1000" == "1000.00"). */
function normalize(key: string, value: string | number | undefined): string | number | undefined {
  return key === 'contractValue' ? new Decimal(value as string).toFixed(2) : value;
}
