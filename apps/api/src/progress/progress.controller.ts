import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { saveDailyAllocationSchema, saveWeeklyProgressSchema, type SaveDailyAllocationInput, type SaveWeeklyProgressInput } from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { ProgressService } from './progress.service';

const weekNumber = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** D-073 weekly progress; reading follows RAB access. */
@Controller('projects/:projectId/progress/weeks')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  weeks(@Param('projectId') projectId: string) {
    return this.progress.weeks(projectId);
  }

  @Get(':weekNumber')
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string, @Param('weekNumber', weekNumber) week: number) {
    return this.progress.get(projectId, week);
  }

  @Put(':weekNumber')
  @RequireProjectPermission('progress.input')
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('weekNumber', weekNumber) week: number,
    @Body(new ZodPipe(saveWeeklyProgressSchema)) body: SaveWeeklyProgressInput,
  ) {
    return this.progress.save(auth.user, projectId, week, body);
  }

  @Get(':weekNumber/daily')
  @RequireProjectPermission('rab.read')
  daily(@Param('projectId') projectId: string, @Param('weekNumber', weekNumber) week: number) {
    return this.progress.daily(projectId, week);
  }

  @Put(':weekNumber/daily/:workItemId')
  @RequireProjectPermission('progress.input')
  saveDaily(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('weekNumber', weekNumber) week: number,
    @Param('workItemId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) workItemId: string,
    @Body(new ZodPipe(saveDailyAllocationSchema)) body: SaveDailyAllocationInput,
  ) {
    return this.progress.saveDaily(auth.user, projectId, week, workItemId, body);
  }
}
