import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { activateBaselineSchema, requiredReasonSchema, type ActivateBaselineInput, type RequiredReasonInput } from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { BaselinesService } from './baselines.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** D-071 baseline activation per date; reading follows RAB access. */
@Controller('projects/:projectId/baselines')
export class BaselinesController {
  constructor(private readonly baselines: BaselinesService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string) {
    return this.baselines.get(projectId);
  }

  @Post()
  @RequireProjectPermission('baseline.activate')
  @HttpCode(201)
  activate(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(activateBaselineSchema)) body: ActivateBaselineInput) {
    return this.baselines.activate(auth.user, projectId, body);
  }

  @Post(':assignmentId/revoke')
  @RequireProjectPermission('baseline.activate')
  @HttpCode(200)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.baselines.revoke(auth.user, projectId, assignmentId, body.reason);
  }
}
