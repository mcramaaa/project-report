import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  approveRabVersionSchema,
  correctionReasonSchema,
  correctWorkItemSchema,
  createRabItemSchema,
  createRabVersionSchema,
  moveRabItemSchema,
  reorderRabItemsSchema,
  requiredReasonSchema,
  updateRabItemSchema,
  updateRabVersionSchema,
  type ApproveRabVersionInput,
  type CorrectionReasonInput,
  type CorrectWorkItemInput,
  type CreateRabItemInput,
  type CreateRabVersionInput,
  type MoveRabItemInput,
  type ReorderRabItemsInput,
  type RequiredReasonInput,
  type UpdateRabItemInput,
  type UpdateRabVersionInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AccessService } from '../auth/access.service';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { RabCorrectionsService } from './corrections.service';
import { RabService } from './rab.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/**
 * Nested under the project so ProjectPermissionGuard checks rab.* in that project (D-041). Row changes on a
 * REOPENED version additionally need rab.reopen and a reason, checked in the service (D-068).
 */
@Controller('projects/:projectId/rab-versions')
export class RabController {
  constructor(
    private readonly rab: RabService,
    private readonly corrections: RabCorrectionsService,
    private readonly access: AccessService,
  ) {}

  private async requireRabAndAhspRead(auth: AuthContext, projectId: string) {
    const rab = await this.access.hasProjectPermission(auth.user, projectId, 'rab.read');
    if (rab === null) throw new NotFoundException('Proyek tidak ditemukan.');
    if (!rab) throw new ForbiddenException('Role Anda di proyek ini tidak memiliki izin rab.read.');
    const ahsp = await this.access.hasProjectPermission(auth.user, projectId, 'ahsp.read');
    if (ahsp === null) throw new NotFoundException('Proyek tidak ditemukan.');
    if (!ahsp) throw new ForbiddenException('Role Anda di proyek ini tidak memiliki izin ahsp.read.');
  }

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

  @Get(':versionId/history')
  @RequireProjectPermission('rab.read')
  async history(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('versionId', uuid) versionId: string) {
    await this.requireRabAndAhspRead(auth, projectId);
    return this.rab.history(projectId, versionId);
  }

  @Get(':versionId/snapshots/:snapshotId')
  @RequireProjectPermission('rab.read')
  async snapshot(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('versionId', uuid) versionId: string, @Param('snapshotId', uuid) snapshotId: string) {
    await this.requireRabAndAhspRead(auth, projectId);
    return this.rab.snapshot(projectId, versionId, snapshotId);
  }

  @Post(':versionId/items')
  @RequireProjectPermission('rab.edit')
  addItem(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(createRabItemSchema)) body: CreateRabItemInput,
  ) {
    return this.rab.addItem(auth.user, projectId, versionId, body);
  }

  @Patch(':versionId/items/:itemId')
  @RequireProjectPermission('rab.edit')
  updateItem(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(updateRabItemSchema)) body: UpdateRabItemInput,
  ) {
    return this.rab.updateItem(auth.user, projectId, versionId, itemId, body);
  }

  @Delete(':versionId/items/:itemId')
  @RequireProjectPermission('rab.edit')
  deleteItem(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(correctionReasonSchema)) body: CorrectionReasonInput,
  ) {
    return this.rab.deleteItem(auth.user, projectId, versionId, itemId, body?.reason);
  }

  @Post(':versionId/items/:itemId/move')
  @RequireProjectPermission('rab.edit')
  @HttpCode(200)
  moveItem(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(moveRabItemSchema)) body: MoveRabItemInput,
  ) {
    return this.rab.moveItem(auth.user, projectId, versionId, itemId, body.direction, body.reason);
  }

  @Post(':versionId/items/reorder')
  @RequireProjectPermission('rab.edit')
  @HttpCode(200)
  reorderItems(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(reorderRabItemsSchema)) body: ReorderRabItemsInput,
  ) {
    return this.rab.reorderItems(auth.user, projectId, versionId, body);
  }

  @Post(':versionId/items/:itemId/work-item')
  @RequireProjectPermission('rab.edit')
  @HttpCode(200)
  correctWorkItem(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(correctWorkItemSchema)) body: CorrectWorkItemInput,
  ) {
    return this.corrections.correctWorkItem(auth.user, projectId, versionId, itemId, body);
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

  @Post(':versionId/reopen')
  @RequireProjectPermission('rab.reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.rab.reopen(auth.user, projectId, versionId, body.reason);
  }

  /** D-070: back to the last approved snapshot; same right as opening the correction. */
  @Post(':versionId/cancel-correction')
  @RequireProjectPermission('rab.reopen')
  @HttpCode(200)
  cancelCorrection(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(requiredReasonSchema)) body: RequiredReasonInput,
  ) {
    return this.rab.cancelCorrection(auth.user, projectId, versionId, body.reason);
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
