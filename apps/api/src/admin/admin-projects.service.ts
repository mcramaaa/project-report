import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AddMemberInput, AdminProjectDto, ProjectMemberDto, ProjectMembersResponse, ProjectRole } from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';

/** Minimum project metadata for system admins (D-026). */
const PROJECT_META_SELECT = { id: true, code: true, projectName: true } as const satisfies Prisma.ProjectSelect;
const ALREADY_MEMBER = 'User sudah menjadi anggota aktif proyek ini.';

@Injectable()
export class AdminProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  // shortcut: capped at 100 rows with search instead of pagination; paginate when project count grows (M3).
  listProjects(search?: string): Promise<AdminProjectDto[]> {
    return this.prisma.project.findMany({
      where: search ? { OR: [{ code: { contains: search } }, { projectName: { contains: search } }] } : {},
      select: PROJECT_META_SELECT,
      orderBy: { code: 'asc' },
      take: 100,
    });
  }

  async listMembers(projectId: string): Promise<ProjectMembersResponse> {
    const project = await this.findProject(this.prisma, projectId);
    const rows = await this.prisma.projectUser.findMany({
      where: { projectId, revokedAt: null },
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true, isActive: true } } },
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

  async addMember(actorId: string, projectId: string, input: AddMemberInput): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.findProject(tx, projectId);
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
            data: { role: input.role, revokedAt: null, revokedBy: null },
          });
          if (count === 0) throw new ConflictException(ALREADY_MEMBER);
        } else {
          await tx.projectUser.create({ data: { projectId, userId: input.userId, role: input.role, createdBy: actorId } });
        }
        await writeAudit(tx, {
          actorId,
          action: 'ADD_PROJECT_MEMBER',
          entityType: 'PROJECT_MEMBER',
          entityId: input.userId,
          projectId,
          newValue: { userId: input.userId, role: input.role, reactivated: Boolean(existing) },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(ALREADY_MEMBER);
      throw err;
    }
  }

  async changeRole(actorId: string, projectId: string, userId: string, role: ProjectRole): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.findActiveMembership(tx, projectId, userId);
      if (membership.role === role) return;
      await tx.projectUser.update({ where: { id: membership.id }, data: { role } });
      await writeAudit(tx, {
        actorId,
        action: 'CHANGE_PROJECT_MEMBER_ROLE',
        entityType: 'PROJECT_MEMBER',
        entityId: userId,
        projectId,
        oldValue: { role: membership.role },
        newValue: { role },
      });
    });
  }

  /** Soft revoke: the user and history stay; access is lost on the next request. */
  async revokeMember(actorId: string, projectId: string, userId: string, reason?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.findActiveMembership(tx, projectId, userId);
      const { count } = await tx.projectUser.updateMany({
        where: { id: membership.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: actorId },
      });
      if (count === 0) throw new NotFoundException('Anggota proyek tidak ditemukan.');
      await writeAudit(tx, {
        actorId,
        action: 'REVOKE_PROJECT_MEMBER',
        entityType: 'PROJECT_MEMBER',
        entityId: userId,
        projectId,
        oldValue: { userId, role: membership.role },
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
      select: { id: true, role: true, revokedAt: true },
    });
    if (!membership || membership.revokedAt) throw new NotFoundException('Anggota proyek tidak ditemukan.');
    return membership;
  }
}
