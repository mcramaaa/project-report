import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  addMemberSchema,
  changeMemberRoleSchema,
  reasonBodySchema,
  type AddMemberInput,
  type ChangeMemberRoleInput,
  type ReasonInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { AdminProjectsService } from './admin-projects.service';

const uuid = new ParseUUIDPipe();

@Controller('admin/projects')
export class AdminProjectsController {
  constructor(private readonly projects: AdminProjectsService) {}

  @Get()
  @RequirePermission('assignments.read')
  list(@Query('search') search?: string) {
    return this.projects.listProjects(typeof search === 'string' ? search.trim().slice(0, 100) : undefined);
  }

  @Get(':projectId/members')
  @RequirePermission('assignments.read')
  members(@Param('projectId', uuid) projectId: string) {
    return this.projects.listMembers(projectId);
  }

  @Post(':projectId/members')
  @RequirePermission('assignments.manage')
  @HttpCode(204)
  add(@CurrentAuth() auth: AuthContext, @Param('projectId', uuid) projectId: string, @Body(new ZodPipe(addMemberSchema)) body: AddMemberInput) {
    return this.projects.addMember(auth.user, projectId, body);
  }

  @Patch(':projectId/members/:userId')
  @RequirePermission('assignments.manage')
  @HttpCode(204)
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId', uuid) projectId: string,
    @Param('userId', uuid) userId: string,
    @Body(new ZodPipe(changeMemberRoleSchema)) body: ChangeMemberRoleInput,
  ) {
    return this.projects.changeRole(auth.user, projectId, userId, body.roleId);
  }

  @Delete(':projectId/members/:userId')
  @RequirePermission('assignments.manage')
  @HttpCode(204)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId', uuid) projectId: string,
    @Param('userId', uuid) userId: string,
    @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput,
  ) {
    return this.projects.revokeMember(auth.user, projectId, userId, body.reason);
  }
}
