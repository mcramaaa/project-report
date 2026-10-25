import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequireProjectPermission } from '../auth/guards';
import { AhspService } from './ahsp.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('projects/:projectId')
export class AhspController {
  constructor(private readonly ahsp: AhspService) {}

  @Get('analyses')
  @RequireProjectPermission('ahsp.read')
  list(@Param('projectId') projectId: string, @Query('search') search?: string) {
    return this.ahsp.list(projectId, typeof search === 'string' ? search.trim().slice(0, 100) || undefined : undefined);
  }

  @Get('analyses/:analysisId')
  @RequireProjectPermission('ahsp.read')
  get(@Param('projectId') projectId: string, @Param('analysisId', uuid) analysisId: string) {
    return this.ahsp.get(projectId, analysisId);
  }

  @Get('price-lists')
  @RequireProjectPermission('ahsp.read')
  priceLists(@Param('projectId') projectId: string) {
    return this.ahsp.priceLists(projectId);
  }
}
