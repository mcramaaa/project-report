import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  approveRabVersionSchema,
  createRabItemSchema,
  createRabVersionSchema,
  moveRabItemSchema,
  requiredReasonSchema,
  updateRabItemSchema,
  updateRabVersionSchema,
  type ApproveRabVersionInput,
  type CreateRabItemInput,
  type CreateRabVersionInput,
  type MoveRabItemInput,
  type RequiredReasonInput,
  type UpdateRabItemInput,
  type UpdateRabVersionInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { RabService } from './rab.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** Nested under the project so ProjectPermissionGuard checks rab.* in that project (D-041). */
@Controller('projects/:projectId/rab-versions')
export class RabController {
  constructor(private readonly rab: RabService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  list(@Param('projectId') projectId: string) {
    return this.rab.list(projectId);
  }

  @Post()
  @RequireProjectPermission('rab.edit')
  create(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(createRabVersionSchema)) body: CreateRabVersionInput) {
    return this.rab.create(auth.user, projectId, body);
  }

  @Get(':versionId')
  @RequireProjectPermission('rab.read')
  get(@Param('projectId') projectId: string, @Param('versionId', uuid) versionId: string) {
    return this.rab.get(projectId, versionId);
  }

  @Patch(':versionId')
  @RequireProjectPermission('rab.edit')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(updateRabVersionSchema)) body: UpdateRabVersionInput,
  ) {
    return this.rab.updateVersion(auth.user, projectId, versionId, body);
  }

  @Get(':baseId/compare/:targetId')
  @RequireProjectPermission('rab.read')
  compare(@Param('projectId') projectId: string, @Param('baseId', uuid) baseId: string, @Param('targetId', uuid) targetId: string) {
    return this.rab.compare(projectId, baseId, targetId);
  }

  @Post(':versionId/items')
  @RequireProjectPermission('rab.edit')
  addItem(@Param('projectId') projectId: string, @Param('versionId', uuid) versionId: string, @Body(new ZodPipe(createRabItemSchema)) body: CreateRabItemInput) {
    return this.rab.addItem(projectId, versionId, body);
  }

  @Patch(':versionId/items/:itemId')
  @RequireProjectPermission('rab.edit')
  updateItem(
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(updateRabItemSchema)) body: UpdateRabItemInput,
  ) {
    return this.rab.updateItem(projectId, versionId, itemId, body);
  }

  @Delete(':versionId/items/:itemId')
  @RequireProjectPermission('rab.edit')
  deleteItem(@Param('projectId') projectId: string, @Param('versionId', uuid) versionId: string, @Param('itemId', uuid) itemId: string) {
    return this.rab.deleteItem(projectId, versionId, itemId);
  }

  @Post(':versionId/items/:itemId/move')
  @RequireProjectPermission('rab.edit')
  @HttpCode(200)
  moveItem(
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(moveRabItemSchema)) body: MoveRabItemInput,
  ) {
    return this.rab.moveItem(projectId, versionId, itemId, body.direction);
  }

  @Post(':versionId/approve')
  @RequireProjectPermission('rab.approve')
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(approveRabVersionSchema)) body: ApproveRabVersionInput,
  ) {
    return this.rab.approve(auth.user, projectId, versionId, body.acknowledgeWarnings);
  }

  @Post(':versionId/discard')
  @RequireProjectPermission('rab.edit')
  @HttpCode(200)
  discard(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.rab.discard(auth.user, projectId, versionId, body.reason);
  }
}
