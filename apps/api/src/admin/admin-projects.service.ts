import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddMemberInput,
  AdminProjectDto,
  ListAdminProjectsQuery,
  MemberCandidateDto,
  Paginated,
  ProjectMemberDto,
  ProjectMembersResponse,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';

/** Minimum project metadata for system admins (D-026). */
const PROJECT_META_SELECT = { id: true, code: true, projectName: true } as const satisfies Prisma.ProjectSelect;
const ALREADY_MEMBER = 'User sudah menjadi anggota aktif proyek ini.';
const ROLE_SUMMARY_SELECT = { id: true, code: true, name: true, isActive: true } as const satisfies Prisma.RoleSelect;

/** Delegates may not grant, change, or revoke their own project access (D-035). */
function assertNotSelf(actor: AuthUser, userId: string): void {
  if (actor.id === userId && !actor.isSystemAdmin) throw new ForbiddenException('Anda tidak dapat mengubah akses proyek Anda sendiri.');
}

async function findAssignableProjectRole(tx: Prisma.TransactionClient, roleId: string) {
  const role = await tx.role.findUnique({ where: { id: roleId }, select: { ...ROLE_SUMMARY_SELECT, scope: true } });
  if (!role || role.scope !== 'PROJECT') throw new BadRequestException('Role proyek tidak ditemukan.');
  if (!role.isActive) throw new BadRequestException('Role nonaktif tidak dapat ditugaskan.');
  return role;
}

@Injectable()
export class AdminProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async listProjects(query: ListAdminProjectsQuery): Promise<Paginated<AdminProjectDto>> {
    const where: Prisma.ProjectWhereInput = query.search ? { OR: [{ code: { contains: query.search } }, { projectName: { contains: query.search } }] } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({ where, select: PROJECT_META_SELECT, orderBy: { code: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listMembers(projectId: string): Promise<ProjectMembersResponse> {
    const project = await this.findProject(this.prisma, projectId);
    const rows = await this.prisma.projectUser.findMany({
      where: { projectId, revokedAt: null },
      select: { role: { select: ROLE_SUMMARY_SELECT }, createdAt: true, user: { select: { id: true, name: true, email: true, isActive: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    const members: ProjectMemberDto[] = rows.map((row) => ({
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      isActive: row.user.isActive,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    }));
    return { project, members };
  }

  /**
   * Member search for assignments.manage without users.read: active users that are not active
   * members, excluding the delegate itself (it may not add itself), capped at 20.
   */
  async listCandidates(actor: AuthUser, projectId: string, search: string): Promise<MemberCandidateDto[]> {
    await this.findProject(this.prisma, projectId);
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        memberships: { none: { projectId, revokedAt: null } },
        ...(actor.isSystemAdmin ? {} : { id: { not: actor.id } }),
        ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  async addMember(actor: AuthUser, projectId: string, input: AddMemberInput): Promise<void> {
    assertNotSelf(actor, input.userId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.findProject(tx, projectId);
        const role = await findAssignableProjectRole(tx, input.roleId);
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { isActive: true } });
        if (!user) throw new NotFoundException('User tidak ditemukan.');
        if (!user.isActive) throw new BadRequestException('User nonaktif tidak dapat ditambahkan ke proyek.');

        const existing = await tx.projectUser.findUnique({
          where: { projectId_userId: { projectId, userId: input.userId } },
          select: { id: true, revokedAt: true },
        });
        if (existing && !existing.revokedAt) throw new ConflictException(ALREADY_MEMBER);

        if (existing) {
          // Re-activate the same row (unique project_id + user_id); conditional so concurrent re-adds cannot both win.
          const { count } = await tx.projectUser.updateMany({
            where: { id: existing.id, revokedAt: { not: null } },
            data: { roleId: role.id, revokedAt: null, revokedBy: null },
          });
          if (count === 0) throw new ConflictException(ALREADY_MEMBER);
        } else {
          await tx.projectUser.create({ data: { projectId, userId: input.userId, roleId: role.id, createdBy: actor.id } });
        }
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'ADD_PROJECT_MEMBER',
          entityType: 'PROJECT_MEMBER',
          entityId: input.userId,
          projectId,
          newValue: { userId: input.userId, roleId: role.id, roleCode: role.code, reactivated: Boolean(existing) },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(ALREADY_MEMBER);
      throw err;
    }
  }

  async changeRole(actor: AuthUser, projectId: string, userId: string, roleId: string): Promise<void> {
    assertNotSelf(actor, userId);
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.findActiveMembership(tx, projectId, userId);
      if (membership.role.id === roleId) return;
      const role = await findAssignableProjectRole(tx, roleId);
      await tx.projectUser.update({ where: { id: membership.id }, data: { roleId: role.id } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'CHANGE_PROJECT_MEMBER_ROLE',
        entityType: 'PROJECT_MEMBER',
        entityId: userId,
        projectId,
        oldValue: { roleId: membership.role.id, roleCode: membership.role.code },
        newValue: { roleId: role.id, roleCode: role.code },
      });
    });
  }

  /** Soft revoke: the user and history stay; access is lost on the next request. */
  async revokeMember(actor: AuthUser, projectId: string, userId: string, reason?: string): Promise<void> {
    assertNotSelf(actor, userId);
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.findActiveMembership(tx, projectId, userId);
      const { count } = await tx.projectUser.updateMany({
        where: { id: membership.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: actor.id },
      });
      if (count === 0) throw new NotFoundException('Anggota proyek tidak ditemukan.');
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'REVOKE_PROJECT_MEMBER',
        entityType: 'PROJECT_MEMBER',
        entityId: userId,
        projectId,
        oldValue: { userId, roleId: membership.role.id, roleCode: membership.role.code },
        reason,
      });
    });
  }

  private async findProject(db: Prisma.TransactionClient, projectId: string): Promise<AdminProjectDto> {
    const project = await db.project.findUnique({ where: { id: projectId }, select: PROJECT_META_SELECT });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    return project;
  }

  private async findActiveMembership(tx: Prisma.TransactionClient, projectId: string, userId: string) {
    const membership = await tx.projectUser.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true, revokedAt: true, role: { select: ROLE_SUMMARY_SELECT } },
    });
    if (!membership || membership.revokedAt) throw new NotFoundException('Anggota proyek tidak ditemukan.');
    return membership;
  }
}
