import { Injectable } from '@nestjs/common';
import { permissionsForScope } from '@laporan-proyek/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth-context';

/**
 * Resolves effective permissions from the database on every call (D-035):
 * super admin = everything; otherwise active, non-revoked assignments of active roles.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async globalPermissions(user: AuthUser): Promise<Set<string>> {
    if (user.isSystemAdmin) return new Set(permissionsForScope('GLOBAL'));
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { isActive: true, scope: 'GLOBAL', globalAssignments: { some: { userId: user.id, revokedAt: null } } } },
      select: { permissionCode: true },
    });
    return new Set(rows.map((row) => row.permissionCode));
  }

  /** Project permissions the user holds in the project (for UI hints; guards stay authoritative). */
  async projectPermissions(user: AuthUser, projectId: string): Promise<string[]> {
    if (user.isSystemAdmin) return permissionsForScope('PROJECT');
    const membership = await this.prisma.projectUser.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      select: { revokedAt: true, role: { select: { isActive: true, permissions: { select: { permissionCode: true } } } } },
    });
    if (!membership || membership.revokedAt || !membership.role.isActive) return [];
    return membership.role.permissions.map((p) => p.permissionCode).sort();
  }

  /** Returns null when the user has no active membership (super admins always pass). */
  async hasProjectPermission(user: AuthUser, projectId: string, permission: string): Promise<boolean | null> {
    if (user.isSystemAdmin) return true;
    const membership = await this.prisma.projectUser.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      select: { revokedAt: true, role: { select: { isActive: true, permissions: { where: { permissionCode: permission }, select: { permissionCode: true } } } } },
    });
    if (!membership || membership.revokedAt) return null;
    return membership.role.isActive && membership.role.permissions.length > 0;
  }
}
