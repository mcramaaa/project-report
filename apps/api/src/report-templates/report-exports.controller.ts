import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { fromDbDate } from '../projects/project-calendar';
import { RequireProjectPermission } from '../auth/guards';
import { DailyReportsService } from '../daily-reports/daily-reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { dailyWorkbook, type ExcelLogo } from './daily-excel';
import { ReportTemplatesService } from './report-templates.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** D-084: report files built from the project's templates; reading follows report access. */
@Controller('projects/:projectId/exports')
export class ReportExportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly daily: DailyReportsService,
    private readonly templates: ReportTemplatesService,
  ) {}

  @Get('daily/:date')
  @RequireProjectPermission('rab.read')
  async dailyExcel(@Param('projectId') projectId: string, @Param('date') date: string) {
    const [report, templates, p] = await Promise.all([
      this.daily.get(projectId, date),
      this.templates.list(projectId),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    const logos: Partial<Record<(typeof templates.logos)[number]['kind'], ExcelLogo>> = {};
    for (const l of templates.logos) {
      // ExcelJS embeds PNG and JPEG only; a WEBP logo stays out of the workbook.
      if (l.mimeType !== 'image/png' && l.mimeType !== 'image/jpeg') continue;
      logos[l.kind] = { data: (await this.templates.readLogo(projectId, l.kind)).data, extension: l.mimeType === 'image/png' ? 'png' : 'jpeg' };
    }
    const data = await dailyWorkbook({
      template: templates.templates.find((t) => t.reportType === 'DAILY')!.config,
      identity: {
        activityName: p.activityName,
        subActivityName: p.subActivityName,
        projectName: p.projectName,
        contractNumber: p.contractNumber,
        contractDate: fromDbDate(p.contractDate),
        spmkNumber: p.spmkNumber,
        spmkDate: fromDbDate(p.spmkDate),
        contractorName: p.contractorName,
        consultantName: p.consultantName,
        location: p.location,
        fiscalYear: p.fiscalYear,
      },
      report,
      logos,
    });
    const filename = `Laporan Harian ${p.code} ${date}.xlsx`;
    return new StreamableFile(data, { type: XLSX, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` });
  }
}
