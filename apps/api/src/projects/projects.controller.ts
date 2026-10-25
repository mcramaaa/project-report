import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  changeScheduleSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  requiredReasonSchema,
  updateProjectSchema,
  type ChangeScheduleInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type RequiredReasonInput,
  type UpdateProjectInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermission, RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  listMine(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listProjectsQuerySchema)) query: ListProjectsQuery) {
    return this.projects.listMine(auth.user, query);
  }

  @Post()
  @RequirePermission('projects.create')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createProjectSchema)) body: CreateProjectInput) {
    return this.projects.create(auth.user, body);
  }

  @Get(':projectId')
  @RequireProjectPermission('project.read')
  get(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string) {
    return this.projects.get(auth.user, projectId);
  }

  @Patch(':projectId')
  @RequireProjectPermission('project.update')
  update(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(updateProjectSchema)) body: UpdateProjectInput) {
    return this.projects.update(auth.user, projectId, body);
  }

  @Put(':projectId/schedule')
  @RequireProjectPermission('project.update')
  changeSchedule(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(changeScheduleSchema)) body: ChangeScheduleInput,
  ) {
    return this.projects.changeSchedule(auth.user, projectId, body);
  }

  @Post(':projectId/close')
  @RequireProjectPermission('project.update')
  @HttpCode(200)
  close(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput) {
    return this.projects.setStatus(auth.user, projectId, 'CLOSED', body.reason);
  }

  @Post(':projectId/reopen')
  @RequireProjectPermission('project.update')
  @HttpCode(200)
  reopen(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput) {
    return this.projects.setStatus(auth.user, projectId, 'ACTIVE', body.reason);
  }

  @Get(':projectId/weeks')
  @RequireProjectPermission('project.read')
  weeks(@Param('projectId') projectId: string) {
    return this.projects.listWeeks(projectId);
  }

  @Get(':projectId/report-periods')
  @RequireProjectPermission('project.read')
  periods(@Param('projectId') projectId: string) {
    return this.projects.listPeriods(projectId);
  }

  @Get(':projectId/team')
  @RequireProjectPermission('project.read')
  team(@Param('projectId') projectId: string) {
    return this.projects.listTeam(projectId);
  }
}
