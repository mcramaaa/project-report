import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PERMISSIONS,
  SYSTEM_PROJECT_ROLES,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  type CreateRoleInput,
  type PermissionScope,
  type RoleDto,
  type UpdateRoleInput,
  type UserAccessDto,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  scope: true,
  isSystem: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
} as const satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

function toRoleDto(role: RoleRow): RoleDto {
  const { permissions, createdAt, updatedAt, ...rest } = role;
  return { ...rest, permissionCodes: permissions.map((p) => p.permissionCode), createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

/** GLOBAL roles and their permissions are super-admin-only (D-035 anti-escalation). */
function assertCanManageScope(actor: AuthUser, scope: PermissionScope): void {
  if (scope === 'GLOBAL' && !actor.isSystemAdmin) throw new ForbiddenException('Role administrasi hanya dapat diatur super admin.');
}

const CODE_TAKEN = 'Kode role sudah dipakai.';

/** Creates missing system project roles with their default permissions; never overwrites edits. */
export async function ensureSystemRoles(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const role of SYSTEM_PROJECT_ROLES) {
    if (await prisma.role.findUnique({ where: { code: role.code }, select: { id: true } })) continue;
    await prisma.role.create({
      data: {
        ...role,
        scope: 'PROJECT',
        isSystem: true,
        permissions: { create: SYSTEM_ROLE_DEFAULT_PERMISSIONS.map((permissionCode) => ({ permissionCode })) },
      },
    });
    created += 1;
  }
  return created;
}

@Injectable()
export class AdminAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(scope?: PermissionScope): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      where: scope ? { scope } : {},
      select: ROLE_SELECT,
      orderBy: [{ scope: 'asc' }, { isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map(toRoleDto);
  }

  async getRole(roleId: string): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
    if (!role) throw new NotFoundException('Role tidak ditemukan.');
    return toRoleDto(role);
  }

  async createRole(actor: AuthUser, input: CreateRoleInput): Promise<RoleDto> {
    assertCanManageScope(actor, input.scope);
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({ data: { ...input, description: input.description || null }, select: ROLE_SELECT });
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'CREATE_ROLE',
          entityType: 'ROLE',
          entityId: created.id,
          newValue: { code: created.code, name: created.name, scope: created.scope },
        });
        return created;
      });
      return toRoleDto(role);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(CODE_TAKEN);
      throw err;
    }
  }

  async updateRole(actor: AuthUser, roleId: string, input: UpdateRoleInput): Promise<RoleDto> {
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const current = await tx.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
        if (!current) throw new NotFoundException('Role tidak ditemukan.');
        assertCanManageScope(actor, current.scope);
        if (current.isSystem && ((input.code !== undefined && input.code !== current.code) || (input.isActive !== undefined && input.isActive !== current.isActive))) {
          throw new BadRequestException('Kode dan status role sistem tidak dapat diubah.');
        }

        const oldValue: Record<string, string | boolean | null> = {};
        const newValue: Record<string, string | boolean | null> = {};
        const next = { code: input.code, name: input.name, description: input.description === undefined ? undefined : input.description || null, isActive: input.isActive };
        for (const key of ['code', 'name', 'description', 'isActive'] as const) {
          if (next[key] !== undefined && next[key] !== current[key]) {
            oldValue[key] = current[key];
            newValue[key] = next[key];
          }
        }
        if (Object.keys(newValue).length === 0) return current;
        const updated = await tx.role.update({ where: { id: roleId }, data: newValue, select: ROLE_SELECT });
        await writeAudit(tx, { actorId: actor.id, action: 'UPDATE_ROLE', entityType: 'ROLE', entityId: roleId, oldValue, newValue });
        return updated;
      });
      return toRoleDto(role);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(CODE_TAKEN);
      throw err;
    }
  }

  /** Replaces the role's permission set. Codes must exist in the catalog and match the role scope. */
  async setRolePermissions(actor: AuthUser, roleId: string, codes: string[]): Promise<RoleDto> {
    const wanted = [...new Set(codes)].sort();
    const role = await this.prisma.$transaction(async (tx) => {
      const current = await tx.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
      if (!current) throw new NotFoundException('Role tidak ditemukan.');
      assertCanManageScope(actor, current.scope);
      const invalid = wanted.filter((code) => !PERMISSIONS.some((p) => p.code === code && p.scope === current.scope));
      if (invalid.length) throw new BadRequestException(`Permission tidak valid untuk role ${current.scope}: ${invalid.join(', ')}`);

      const before = current.permissions.map((p) => p.permissionCode);
      if (before.join() === wanted.join()) return current;
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: wanted.map((permissionCode) => ({ roleId, permissionCode })) });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'UPDATE_ROLE_PERMISSIONS',
        entityType: 'ROLE',
        entityId: roleId,
        oldValue: { permissionCodes: before },
        newValue: { permissionCodes: wanted },
      });
      return tx.role.findUniqueOrThrow({ where: { id: roleId }, select: ROLE_SELECT });
    });
    return toRoleDto(role);
  }

  async userAccess(userId: string): Promise<UserAccessDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        isSystemAdmin: true,
        globalRoles: {
          where: { revokedAt: null },
          select: { createdAt: true, role: { select: { id: true, code: true, name: true, isActive: true } } },
          orderBy: { createdAt: 'asc' },
        },
        memberships: {
          where: { revokedAt: null },
          select: {
            createdAt: true,
            project: { select: { id: true, code: true, projectName: true } },
            role: { select: { id: true, code: true, name: true, isActive: true } },
          },
          orderBy: { project: { code: 'asc' } },
        },
      },
    });
    if (!user) throw new NotFoundException('User tidak ditemukan.');
    const { globalRoles, memberships, ...info } = user;
    return {
      user: info,
      globalRoles: globalRoles.map((g) => ({ ...g.role, assignedAt: g.createdAt.toISOString() })),
      projects: memberships.map((m) => ({ project: m.project, role: m.role, assignedAt: m.createdAt.toISOString() })),
    };
  }

  /** Super admin only (enforced by the controller). Re-assigning a revoked role reuses its row. */
  async grantGlobalRole(actor: AuthUser, userId: string, roleId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const [user, role] = await Promise.all([
          tx.user.findUnique({ where: { id: userId }, select: { isActive: true } }),
          tx.role.findUnique({ where: { id: roleId }, select: { code: true, scope: true, isActive: true } }),
        ]);
        if (!user) throw new NotFoundException('User tidak ditemukan.');
        if (!user.isActive) throw new BadRequestException('User nonaktif tidak dapat diberi role.');
        if (!role || role.scope !== 'GLOBAL') throw new BadRequestException('Role administrasi tidak ditemukan.');
        if (!role.isActive) throw new BadRequestException('Role nonaktif tidak dapat ditugaskan.');

        const existing = await tx.userGlobalRole.findUnique({ where: { userId_roleId: { userId, roleId } }, select: { id: true, revokedAt: true } });
        if (existing && !existing.revokedAt) throw new ConflictException('User sudah memiliki role ini.');
        if (existing) {
          const { count } = await tx.userGlobalRole.updateMany({
            where: { id: existing.id, revokedAt: { not: null } },
            data: { revokedAt: null, revokedBy: null, createdBy: actor.id },
          });
          if (count === 0) throw new ConflictException('User sudah memiliki role ini.');
        } else {
          await tx.userGlobalRole.create({ data: { userId, roleId, createdBy: actor.id } });
        }
        await writeAudit(tx, { actorId: actor.id, action: 'GRANT_GLOBAL_ROLE', entityType: 'USER', entityId: userId, newValue: { roleId, roleCode: role.code } });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('User sudah memiliki role ini.');
      throw err;
    }
  }

  async revokeGlobalRole(actor: AuthUser, userId: string, roleId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.userGlobalRole.findUnique({
        where: { userId_roleId: { userId, roleId } },
        select: { id: true, revokedAt: true, role: { select: { code: true } } },
      });
      if (!assignment || assignment.revokedAt) throw new NotFoundException('Penugasan role tidak ditemukan.');
      const { count } = await tx.userGlobalRole.updateMany({
        where: { id: assignment.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: actor.id },
      });
      if (count === 0) throw new NotFoundException('Penugasan role tidak ditemukan.');
      await writeAudit(tx, { actorId: actor.id, action: 'REVOKE_GLOBAL_ROLE', entityType: 'USER', entityId: userId, oldValue: { roleId, roleCode: assignment.role.code } });
    });
  }
}
