import {
  applyDecorators,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GlobalPermission, ProjectPermission } from '@laporan-proyek/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import type { AppRequest } from './auth-context';
import { hashSessionToken, readCookie, SESSION_COOKIE } from './session-token';

const IS_PUBLIC = 'auth:isPublic';
const PROJECT_PERMISSION = 'auth:projectPermission';
const GLOBAL_PERMISSIONS = 'auth:globalPermissions';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route needs no session (login, health). CSRF still applies to mutating methods. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** CSRF (D-031): mutating requests must come from the app's own origin. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.headers.origin !== this.config.appOrigin) throw new ForbiddenException('Origin request tidak diizinkan.');
    return true;
  }
}

/** Loads session + user from the database on every request (D-030); role changes apply immediately. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token
      ? await this.prisma.authSession.findUnique({
          where: { tokenHash: hashSessionToken(token) },
          select: {
            id: true,
            revokedAt: true,
            expiresAt: true,
            user: { select: { id: true, name: true, email: true, isActive: true, isSystemAdmin: true } },
          },
        })
      : null;
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Sesi tidak valid atau telah berakhir. Silakan login kembali.');
    }

    const { id, name, email, isSystemAdmin } = session.user;
    req.auth = { sessionId: session.id, user: { id, name, email, isSystemAdmin } };
    return true;
  }
}

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!context.switchToHttp().getRequest<AppRequest>().auth?.user.isSystemAdmin) {
      throw new ForbiddenException('Hanya super admin yang dapat melakukan aksi ini.');
    }
    return true;
  }
}

/** Super-admin-only actions (D-035 anti-escalation). */
export const SuperAdminOnly = () => UseGuards(SuperAdminGuard);

/** Requires any of the global permissions (super admin has all). Read from the database per request. */
@Injectable()
export class GlobalPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<GlobalPermission[]>(GLOBAL_PERMISSIONS, [context.getHandler(), context.getClass()]);
    const user = context.switchToHttp().getRequest<AppRequest>().auth?.user;
    if (!required?.length || !user) throw new ForbiddenException();
    const granted = await this.access.globalPermissions(user);
    if (!required.some((code) => granted.has(code))) throw new ForbiddenException('Anda tidak memiliki izin untuk aksi ini.');
    return true;
  }
}

export const RequirePermission = (...anyOf: GlobalPermission[]) =>
  applyDecorators(SetMetadata(GLOBAL_PERMISSIONS, anyOf), UseGuards(GlobalPermissionGuard));

/**
 * Requires an active membership in :projectId whose active role grants the permission (docs/PERMISSIONS.md).
 * Super admins pass (D-035). Non-members get 404 so project existence is not revealed (D-033).
 */
@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<ProjectPermission>(PROJECT_PERMISSION, context.getHandler());
    const req = context.switchToHttp().getRequest<AppRequest>();
    const projectId = req.params.projectId;
    const user = req.auth?.user;
    if (!permission || !user || typeof projectId !== 'string') throw new ForbiddenException();

    const allowed = UUID_PATTERN.test(projectId) ? await this.access.hasProjectPermission(user, projectId, permission) : null;
    if (allowed === null) throw new NotFoundException('Proyek tidak ditemukan.');
    if (!allowed) throw new ForbiddenException('Role Anda di proyek ini tidak memiliki izin untuk aksi ini.');
    return true;
  }
}

export const RequireProjectPermission = (permission: ProjectPermission) =>
  applyDecorators(SetMetadata(PROJECT_PERMISSION, permission), UseGuards(ProjectPermissionGuard));
