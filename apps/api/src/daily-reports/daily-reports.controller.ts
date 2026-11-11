import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import {
  finalizeDailyReportSchema,
  requiredReasonSchema,
  saveDailyReportSchema,
  type RequiredReasonInput,
  type SaveDailyReportInput,
} from '@laporan-proyek/shared';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { DailyReportsService } from './daily-reports.service';

/** D-079 daily reports; reading follows RAB access, writing follows progress input. */
@Controller('projects/:projectId/daily-reports')
export class DailyReportsController {
  constructor(private readonly reports: DailyReportsService) {}

  @Get('weeks/:weekNumber')
  @RequireProjectPermission('rab.read')
  days(@Param('projectId') projectId: string, @Param('weekNumber', new ParseIntPipe({ errorHttpStatusCode: 404 })) week: number) {
    return this.reports.days(projectId, week);
  }

  @Get(':date')
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string, @Param('date') date: string) {
    return this.reports.get(projectId, date);
  }

  @Put(':date')
  @RequireProjectPermission('progress.input')
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('date') date: string,
    @Body(new ZodPipe(saveDailyReportSchema)) body: SaveDailyReportInput,
  ) {
    return this.reports.save(auth.user, projectId, date, body);
  }

  @Post(':date/finalize')
  @RequireProjectPermission('progress.input')
  @HttpCode(200)
  finalize(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('date') date: string,
    @Body(new ZodPipe(finalizeDailyReportSchema)) body: z.infer<typeof finalizeDailyReportSchema>,
  ) {
    return this.reports.finalize(auth.user, projectId, date, body.acknowledgeWarnings ?? false);
  }

  @Post(':date/reopen')
  @RequireProjectPermission('report.reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('date') date: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.reports.reopen(auth.user, projectId, date, body.reason);
  }
}
