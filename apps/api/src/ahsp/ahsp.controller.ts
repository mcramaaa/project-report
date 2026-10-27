import {
  AHSP_CATEGORIES,
  correctAnalysisSchema,
  correctComponentSchema,
  correctPriceItemSchema,
  type AhspCategory,
  type CorrectAnalysisInput,
  type CorrectComponentInput,
  type CorrectPriceItemInput,
} from '@laporan-proyek/shared';
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { RabCorrectionsService } from '../rab/corrections.service';
import { AhspService } from './ahsp.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const searchTerm = (search?: string) =>
  typeof search === 'string' ? search.trim().slice(0, 100) || undefined : undefined;

/** Packages are owned by a RAB version (D-056, D-057): every read names the version. */
@Controller('projects/:projectId/rab-versions/:versionId')
export class AhspController {
  constructor(
    private readonly ahsp: AhspService,
    private readonly corrections: RabCorrectionsService,
  ) {}

  // D-068 source corrections: ahsp.edit here; a REOPENED version also needs rab.reopen + reason (service).
  @Patch('price-items/:priceItemId')
  @RequireProjectPermission('ahsp.edit')
  correctPrice(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('priceItemId', uuid) priceItemId: string,
    @Body(new ZodPipe(correctPriceItemSchema)) body: CorrectPriceItemInput,
  ) {
    return this.corrections.correctPriceItem(auth.user, projectId, versionId, priceItemId, body);
  }

  @Patch('components/:componentId')
  @RequireProjectPermission('ahsp.edit')
  correctComponent(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('componentId', uuid) componentId: string,
    @Body(new ZodPipe(correctComponentSchema)) body: CorrectComponentInput,
  ) {
    return this.corrections.correctComponent(auth.user, projectId, versionId, componentId, body);
  }

  @Patch('analysis-versions/:analysisVersionId')
  @RequireProjectPermission('ahsp.edit')
  correctAnalysis(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('analysisVersionId', uuid) analysisVersionId: string,
    @Body(new ZodPipe(correctAnalysisSchema)) body: CorrectAnalysisInput,
  ) {
    return this.corrections.correctAnalysis(auth.user, projectId, versionId, analysisVersionId, body);
  }

  @Get('analyses')
  @RequireProjectPermission('ahsp.read')
  list(
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Query('search') search?: string,
  ) {
    return this.ahsp.list(projectId, versionId, searchTerm(search));
  }

  @Get('analyses/:analysisId')
  @RequireProjectPermission('ahsp.read')
  get(
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('analysisId', uuid) analysisId: string,
  ) {
    return this.ahsp.get(projectId, versionId, analysisId);
  }

  @Get('price-list')
  @RequireProjectPermission('ahsp.read')
  priceList(
    @Param('projectId') projectId: string,
    @Param('versionId', uuid) versionId: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    if (category !== undefined && !AHSP_CATEGORIES.includes(category as AhspCategory))
      throw new BadRequestException('Kategori harga tidak valid.');
    return this.ahsp.priceList(
      projectId,
      versionId,
      searchTerm(search),
      category as AhspCategory | undefined,
    );
  }
}
