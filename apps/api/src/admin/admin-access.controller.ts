import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  assignGlobalRoleSchema,
  createRoleSchema,
  PERMISSIONS,
  setRolePermissionsSchema,
  updateRoleSchema,
  type AssignGlobalRoleInput,
  type CreateRoleInput,
  type SetRolePermissionsInput,
  type UpdateRoleInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermission, SuperAdminOnly } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { AdminAccessService } from './admin-access.service';

const uuid = new ParseUUIDPipe();

@Controller('admin')
export class AdminAccessController {
  constructor(private readonly access: AdminAccessService) {}

  @Get('permissions')
  @RequirePermission('roles.read')
  permissions() {
    return PERMISSIONS;
  }

  // assignments.read too: assigning project roles needs the role list.
  @Get('roles')
  @RequirePermission('roles.read', 'assignments.read')
  roles(@Query('scope') scope?: string) {
    return this.access.listRoles(scope === 'GLOBAL' || scope === 'PROJECT' ? scope : undefined);
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  createRole(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createRoleSchema)) body: CreateRoleInput) {
    return this.access.createRole(auth.user, body);
  }

  @Get('roles/:roleId')
  @RequirePermission('roles.read')
  role(@Param('roleId', uuid) roleId: string) {
    return this.access.getRole(roleId);
  }

  @Patch('roles/:roleId')
  @RequirePermission('roles.manage')
  updateRole(@CurrentAuth() auth: AuthContext, @Param('roleId', uuid) roleId: string, @Body(new ZodPipe(updateRoleSchema)) body: UpdateRoleInput) {
    return this.access.updateRole(auth.user, roleId, body);
  }

  @Put('roles/:roleId/permissions')
  @RequirePermission('roles.manage')
  setPermissions(
    @CurrentAuth() auth: AuthContext,
    @Param('roleId', uuid) roleId: string,
    @Body(new ZodPipe(setRolePermissionsSchema)) body: SetRolePermissionsInput,
  ) {
    return this.access.setRolePermissions(auth.user, roleId, body.permissionCodes);
  }

  @Get('users/:userId/access')
  @RequirePermission('assignments.read')
  userAccess(@Param('userId', uuid) userId: string) {
    return this.access.userAccess(userId);
  }

  @Post('users/:userId/global-roles')
  @SuperAdminOnly()
  @HttpCode(204)
  grantGlobalRole(@CurrentAuth() auth: AuthContext, @Param('userId', uuid) userId: string, @Body(new ZodPipe(assignGlobalRoleSchema)) body: AssignGlobalRoleInput) {
    return this.access.grantGlobalRole(auth.user, userId, body.roleId);
  }

  @Delete('users/:userId/global-roles/:roleId')
  @SuperAdminOnly()
  @HttpCode(204)
  revokeGlobalRole(@CurrentAuth() auth: AuthContext, @Param('userId', uuid) userId: string, @Param('roleId', uuid) roleId: string) {
    return this.access.revokeGlobalRole(auth.user, userId, roleId);
  }
}
