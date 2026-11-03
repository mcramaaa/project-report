import { Body, Controller, Delete, Get, Header, NotFoundException, Param, Post, Put, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  importReportTemplatesSchema,
  LOGO_MAX_BYTES,
  REPORT_WORKBOOK_MAX_BYTES,
  reportTemplateConfigSchema,
  type ImportReportTemplatesInput,
  type ReportTemplateConfig,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedPart } from '../documents/documents.service';
import { isLogoKind, isReportType, ReportTemplatesService } from './report-templates.service';

const reportType = (v: string) => {
  if (!isReportType(v)) throw new NotFoundException('Jenis laporan tidak dikenal.');
  return v;
};
const logoKind = (v: string) => {
  if (!isLogoKind(v)) throw new NotFoundException('Jenis logo tidak dikenal.');
  return v;
};

/** D-082: reading follows RAB access; changing templates and logos needs project.update. */
@Controller('projects/:projectId/report-templates')
export class ReportTemplatesController {
  constructor(private readonly templates: ReportTemplatesService) {}

  @Get()
  @RequireProjectPermission('rab.read')
  list(@Param('projectId') projectId: string) {
    return this.templates.list(projectId);
  }

  @Post('import')
  @RequireProjectPermission('project.update')
  importFrom(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Body(new ZodPipe(importReportTemplatesSchema)) body: ImportReportTemplatesInput) {
    return this.templates.importFrom(auth.user, projectId, body);
  }

  @Get('logos/:kind')
  @RequireProjectPermission('rab.read')
  @Header('Cache-Control', 'private, max-age=60')
  async logo(@Param('projectId') projectId: string, @Param('kind') kind: string) {
    const file = await this.templates.readLogo(projectId, logoKind(kind));
    return new StreamableFile(file.data, { type: file.mimeType });
  }

  @Post('logos/:kind')
  @RequireProjectPermission('project.update')
  @UseInterceptors(FilesInterceptor('files', 1, { limits: { fileSize: LOGO_MAX_BYTES } }))
  uploadLogo(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('kind') kind: string, @UploadedFiles() files: UploadedPart[]) {
    return this.templates.uploadLogo(auth.user, projectId, logoKind(kind), files?.[0]);
  }

  @Delete('logos/:kind')
  @RequireProjectPermission('project.update')
  removeLogo(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('kind') kind: string) {
    return this.templates.removeLogo(auth.user, projectId, logoKind(kind));
  }

  @Post('workbooks/:reportType')
  @RequireProjectPermission('project.update')
  @UseInterceptors(FilesInterceptor('files', 1, { limits: { fileSize: REPORT_WORKBOOK_MAX_BYTES } }))
  uploadWorkbook(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('reportType') type: string, @UploadedFiles() files: UploadedPart[]) {
    return this.templates.uploadWorkbook(auth.user, projectId, reportType(type), files?.[0]);
  }

  @Delete('workbooks/:reportType')
  @RequireProjectPermission('project.update')
  removeWorkbook(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @Param('reportType') type: string) {
    return this.templates.removeWorkbook(auth.user, projectId, reportType(type));
  }

  @Put(':reportType')
  @RequireProjectPermission('project.update')
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('projectId') projectId: string,
    @Param('reportType') type: string,
    @Body(new ZodPipe(reportTemplateConfigSchema)) body: ReportTemplateConfig,
  ) {
    return this.templates.save(auth.user, projectId, reportType(type), body);
  }
}
