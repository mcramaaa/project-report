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
import { SystemAdminOnly } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { AdminProjectsService } from './admin-projects.service';

const uuid = new ParseUUIDPipe();

@Controller('admin/projects')
@SystemAdminOnly()
export class AdminProjectsController {
  constructor(private readonly projects: AdminProjectsService) {}

  @Get()
  list(@Query('search') search?: string) {
    return this.projects.listProjects(typeof search === 'string' ? search.trim().slice(0, 100) : undefined);
  }

  @Get(':projectId/members')
  members(@Param('projectId', uuid) projectId: string) {
    return this.projects.listMembers(projectId);
  }

  @Post(':projectId/members')
  @HttpCode(204)
  add(@CurrentAuth() auth: AuthContext, @Param('projectId', uuid) projectId: string, @Body(new ZodPipe(addMemberSchema)) body: AddMemberInput) {
    return this.projects.addMember(auth.user.id, projectId, body);
  }

  @Patch(':projectId/members/:userId')
  @HttpCode(204)
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId', uuid) projectId: string,
    @Param('userId', uuid) userId: string,
    @Body(new ZodPipe(changeMemberRoleSchema)) body: ChangeMemberRoleInput,
  ) {
    return this.projects.changeRole(auth.user.id, projectId, userId, body.role);
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(204)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId', uuid) projectId: string,
    @Param('userId', uuid) userId: string,
    @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput,
  ) {
    return this.projects.revokeMember(auth.user.id, projectId, userId, body.reason);
  }
}
