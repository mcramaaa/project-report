import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  createScheduleSchema,
  importScheduleSchema,
  requiredReasonSchema,
  saveScheduleEntriesSchema,
  type CreateScheduleInput,
  type ImportScheduleInput,
  type RequiredReasonInput,
  type SaveScheduleEntriesInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { SchedulesService } from './schedules.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** D-072 time schedule; reading follows RAB access. */
@Controller('projects/:projectId/schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  list(@Param('projectId') projectId: string) {
    return this.schedules.list(projectId);
  }

  @Post()
  @RequireProjectPermission('schedule.edit')
  @HttpCode(201)
  create(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(createScheduleSchema)) body: CreateScheduleInput) {
    return this.schedules.create(auth.user, projectId, body);
  }

  /** Declared before ':scheduleId', which would take 's-curve' as an id. */
  @Get('s-curve')
  @RequireProjectPermission('rab.read')
  sCurve(@Param('projectId') projectId: string) {
    return this.schedules.sCurve(projectId);
  }

  @Get(':scheduleId')
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string, @Param('scheduleId', uuid) scheduleId: string) {
    return this.schedules.get(projectId, scheduleId);
  }

  @Put(':scheduleId/entries')
  @RequireProjectPermission('schedule.edit')
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('scheduleId', uuid) scheduleId: string,
    @Body(new ZodPipe(saveScheduleEntriesSchema)) body: SaveScheduleEntriesInput,
  ) {
    return this.schedules.saveEntries(auth.user, projectId, scheduleId, body);
  }

  @Post(':scheduleId/import')
  @RequireProjectPermission('schedule.edit')
  @HttpCode(200)
  import(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('scheduleId', uuid) scheduleId: string,
    @Body(new ZodPipe(importScheduleSchema)) body: ImportScheduleInput,
  ) {
    return this.schedules.import(auth.user, projectId, scheduleId, body);
  }

  @Post(':scheduleId/approve')
  @RequireProjectPermission('schedule.approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('scheduleId', uuid) scheduleId: string) {
    return this.schedules.approve(auth.user, projectId, scheduleId);
  }

  @Post(':scheduleId/reopen')
  @RequireProjectPermission('schedule.approve')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('scheduleId', uuid) scheduleId: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.schedules.reopen(auth.user, projectId, scheduleId, body.reason);
  }
}
