import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { createScenarioSchema, saveScenarioSchema, type CreateScenarioInput, type SaveScenarioInput } from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { ScenariosService } from './scenarios.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** D-078 schedule scenarios; the whole team reads, schedule editors change and promote. */
@Controller('projects/:projectId/schedule-scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  list(@Param('projectId') projectId: string) {
    return this.scenarios.list(projectId);
  }

  @Post()
  @RequireProjectPermission('schedule.edit')
  @HttpCode(201)
  create(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(createScenarioSchema)) body: CreateScenarioInput) {
    return this.scenarios.create(auth.user, projectId, body);
  }

  @Get(':scenarioId')
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string, @Param('scenarioId', uuid) scenarioId: string) {
    return this.scenarios.get(projectId, scenarioId);
  }

  @Put(':scenarioId')
  @RequireProjectPermission('schedule.edit')
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('scenarioId', uuid) scenarioId: string,
    @Body(new ZodPipe(saveScenarioSchema)) body: SaveScenarioInput,
  ) {
    return this.scenarios.save(auth.user, projectId, scenarioId, body);
  }

  @Delete(':scenarioId')
  @RequireProjectPermission('schedule.edit')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('scenarioId', uuid) scenarioId: string) {
    return this.scenarios.remove(auth.user, projectId, scenarioId);
  }

  @Post(':scenarioId/promote')
  @RequireProjectPermission('schedule.edit')
  @HttpCode(200)
  promote(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('scenarioId', uuid) scenarioId: string) {
    return this.scenarios.promote(auth.user, projectId, scenarioId);
  }
}
