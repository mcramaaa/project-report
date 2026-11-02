import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import {
  finalizeWeeklyReportSchema,
  requiredReasonSchema,
  reviewWeeklyReportSchema,
  type RequiredReasonInput,
  type ReviewWeeklyReportInput,
} from '@laporan-proyek/shared';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { WeeklyReportsService } from './weekly-reports.service';

const week = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** D-081: reading follows RAB access; each status step has its own permission. */
@Controller('projects/:projectId/weekly-reports')
export class WeeklyReportsController {
  constructor(private readonly reports: WeeklyReportsService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  list(@Param('projectId') projectId: string) {
    return this.reports.list(projectId);
  }

  @Get(':weekNumber')
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string, @Param('weekNumber', week) weekNumber: number) {
    return this.reports.get(projectId, weekNumber);
  }

  @Post(':weekNumber/submit')
  @RequireProjectPermission('progress.input')
  @HttpCode(200)
  submit(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('weekNumber', week) weekNumber: number) {
    return this.reports.submit(auth.user, projectId, weekNumber);
  }

  @Post(':weekNumber/review')
  @RequireProjectPermission('report.review')
  @HttpCode(200)
  review(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('weekNumber', week) weekNumber: number,
    @Body(new ZodPipe(reviewWeeklyReportSchema)) body: ReviewWeeklyReportInput,
  ) {
    return this.reports.review(auth.user, projectId, weekNumber, body);
  }

  @Post(':weekNumber/finalize')
  @RequireProjectPermission('report.finalize')
  @HttpCode(200)
  finalize(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('weekNumber', week) weekNumber: number,
    @Body(new ZodPipe(finalizeWeeklyReportSchema)) body: z.infer<typeof finalizeWeeklyReportSchema>,
  ) {
    return this.reports.finalize(auth.user, projectId, weekNumber, body.acknowledgeWarnings ?? false);
  }

  @Post(':weekNumber/reopen')
  @RequireProjectPermission('report.reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('weekNumber', week) weekNumber: number,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.reports.reopen(auth.user, projectId, weekNumber, body.reason);
  }
}
