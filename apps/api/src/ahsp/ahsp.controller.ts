import { AHSP_CATEGORIES, type AhspCategory } from '@laporan-proyek/shared';
import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequireProjectPermission } from '../auth/guards';
import { AhspService } from './ahsp.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const searchTerm = (search?: string) =>
  typeof search === 'string' ? search.trim().slice(0, 100) || undefined : undefined;

/** Packages are owned by a RAB version (D-056, D-057): every read names the version. */
@Controller('projects/:projectId/rab-versions/:versionId')
export class AhspController {
  constructor(private readonly ahsp: AhspService) {}

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
