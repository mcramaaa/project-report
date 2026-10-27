import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  confirmProposalsSchema,
  type ConfirmProposalsInput,
  createRabImportSchema,
  rabImportDecisionsSchema,
  requiredReasonSchema,
  type CreateRabImportInput,
  type RabImportDecisionsInput,
  type RequiredReasonInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { RabImportsService } from './rab-imports.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** D-048/D-049: review actions need rabImport.review; approval/rejection need rabImport.approve. */
@Controller('projects/:projectId/rab-imports')
export class RabImportsController {
  constructor(private readonly imports: RabImportsService) {}

  @Get()
  @RequireProjectPermission('rabImport.review', 'rabImport.approve')
  list(@Param('projectId') projectId: string) {
    return this.imports.list(projectId);
  }

  @Post()
  @RequireProjectPermission('rabImport.review')
  create(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(createRabImportSchema)) body: CreateRabImportInput) {
    return this.imports.create(auth.user, projectId, body);
  }

  @Get(':importId')
  @RequireProjectPermission('rabImport.review', 'rabImport.approve')
  get(@Param('projectId') projectId: string, @Param('importId', uuid) importId: string) {
    return this.imports.get(projectId, importId);
  }

  @Post(':importId/decisions')
  @RequireProjectPermission('rabImport.review')
  @HttpCode(200)
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('importId', uuid) importId: string,
    @Body(new ZodPipe(rabImportDecisionsSchema)) body: RabImportDecisionsInput,
  ) {
    return this.imports.decide(auth.user, projectId, importId, body);
  }

  /** D-067: manual search of the latest approved version's work items for an explicit match. */
  @Get(':importId/work-items')
  @RequireProjectPermission('rabImport.review')
  searchWorkItems(@Param('projectId') projectId: string, @Param('importId', uuid) importId: string, @Query('q') q?: string, @Query('page') page?: string) {
    return this.imports.searchWorkItems(projectId, importId, q, page);
  }

  /** D-065: one explicit confirmation of the backend's package proposals. */
  @Post(':importId/confirm-proposals')
  @RequireProjectPermission('rabImport.review')
  @HttpCode(200)
  confirmProposals(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('importId', uuid) importId: string,
    @Body(new ZodPipe(confirmProposalsSchema)) body: ConfirmProposalsInput,
  ) {
    return this.imports.confirmProposals(auth.user, projectId, importId, body);
  }

  @Post(':importId/retry')
  @RequireProjectPermission('rabImport.review')
  retry(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('importId', uuid) importId: string) {
    return this.imports.retry(auth.user, projectId, importId);
  }

  @Delete(':importId')
  @RequireProjectPermission('rabImport.review')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('importId', uuid) importId: string) {
    return this.imports.remove(auth.user, projectId, importId);
  }

  @Post(':importId/approve')
  @RequireProjectPermission('rabImport.approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('importId', uuid) importId: string) {
    return this.imports.approve(auth.user, projectId, importId);
  }

  @Post(':importId/reject')
  @RequireProjectPermission('rabImport.approve')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('importId', uuid) importId: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.imports.reject(auth.user, projectId, importId, body.reason);
  }
}
