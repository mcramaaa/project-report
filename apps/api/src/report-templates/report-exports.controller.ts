import { Controller, Get, NotFoundException, Param, ParseIntPipe, StreamableFile } from '@nestjs/common';
import type { LogoKind } from '@laporan-proyek/shared';
import { fromDbDate } from '../projects/project-calendar';
import { RequireProjectPermission } from '../auth/guards';
import { DailyReportsService } from '../daily-reports/daily-reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { dailyWorkbook, type ExcelLogo } from './daily-excel';
import { xlsxToPdf } from './pdf-convert';
import { periodWorkbook } from './period-excel';
import { WeeklyReportsService } from '../weekly-reports/weekly-reports.service';
import { OfficeWorkbookService } from './office-workbook.service';
import { ReportTemplatesService } from './report-templates.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** D-084: report files built from the project's templates; reading follows report access. */
@Controller('projects/:projectId/exports')
export class ReportExportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly daily: DailyReportsService,
    private readonly templates: ReportTemplatesService,
    private readonly weekly: WeeklyReportsService,
    private readonly office: OfficeWorkbookService,
  ) {}

  /** Logos ExcelJS can embed: PNG and JPEG; a WEBP logo stays out of the workbook. */
  private async logos(projectId: string, list: { kind: LogoKind; mimeType: string }[]) {
    const out: Partial<Record<LogoKind, ExcelLogo>> = {};
    for (const l of list) {
      if (l.mimeType !== 'image/png' && l.mimeType !== 'image/jpeg') continue;
      out[l.kind] = {
        data: (await this.templates.readLogo(projectId, l.kind)).data,
        extension: l.mimeType === 'image/png' ? 'png' : 'jpeg',
      };
    }
    return out;
  }

  @Get('weekly/:weekNumber')
  @RequireProjectPermission('rab.read')
  async weeklyExcel(
    @Param('projectId') projectId: string,
    @Param('weekNumber', ParseIntPipe) weekNumber: number,
  ) {
    const [report, templates, p] = await Promise.all([
      this.weekly.get(projectId, weekNumber),
      this.templates.list(projectId),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } }),
    ]);
    // D-086: the office's own workbook when one is uploaded, otherwise the layout built from the template.
    const data =
      (await this.office.weekly(projectId, weekNumber)) ??
      (await periodWorkbook({
        template: templates.templates.find((t) => t.reportType === 'WEEKLY')!.config,
        kind: 'WEEKLY',
        content: report.content,
        logos: await this.logos(projectId, templates.logos),
      }));
    const filename = `Laporan Mingguan ${p.code} M.${weekNumber}.xlsx`;
    return new StreamableFile(data, {
      type: XLSX,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }

  /** D-087: monthly report B.n in the office's workbook when uploaded, otherwise the layout of the MONTHLY template. */
  @Get('monthly/:periodNumber')
  @RequireProjectPermission('rab.read')
  async monthlyExcel(@Param('projectId') projectId: string, @Param('periodNumber', ParseIntPipe) periodNumber: number) {
    const [report, templates, p] = await Promise.all([
      this.weekly.monthly(projectId, periodNumber),
      this.templates.list(projectId),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } }),
    ]);
    const data =
      (await this.office.monthly(projectId, periodNumber)) ??
      (await periodWorkbook({
        template: templates.templates.find((t) => t.reportType === 'MONTHLY')!.config,
        kind: 'MONTHLY',
        content: report.content,
        logos: await this.logos(projectId, templates.logos),
      }));
    const filename = `Laporan Bulanan ${p.code} B.${periodNumber}.xlsx`;
    return new StreamableFile(data, { type: XLSX, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` });
  }

  /** D-086: PDF of the office workbook for one week (its sheets only); 404 when no workbook is uploaded. */
  @Get('weekly/:weekNumber/pdf')
  @RequireProjectPermission('rab.read')
  async weeklyPdf(@Param('projectId') projectId: string, @Param('weekNumber', ParseIntPipe) weekNumber: number) {
    const [, p] = await Promise.all([
      this.weekly.get(projectId, weekNumber),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } }),
    ]);
    const xlsx = await this.office.weekly(projectId, weekNumber, { onlyPeriod: true });
    if (!xlsx) throw new NotFoundException('Proyek ini belum punya file Excel laporan mingguan.');
    return this.pdf(xlsx, `Laporan Mingguan ${p.code} M.${weekNumber}.pdf`);
  }

  /** D-087: PDF of the office workbook for one period B.n (its sheets only); 404 when no workbook is uploaded. */
  @Get('monthly/:periodNumber/pdf')
  @RequireProjectPermission('rab.read')
  async monthlyPdf(@Param('projectId') projectId: string, @Param('periodNumber', ParseIntPipe) periodNumber: number) {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } });
    const xlsx = await this.office.monthly(projectId, periodNumber, { onlyPeriod: true });
    if (!xlsx) throw new NotFoundException('Proyek ini belum punya file Excel laporan bulanan.');
    return this.pdf(xlsx, `Laporan Bulanan ${p.code} B.${periodNumber}.pdf`);
  }

  /** D-088: PDF of one day's page of the office daily workbook; 404 when no workbook is uploaded. */
  @Get('daily/:date/pdf')
  @RequireProjectPermission('rab.read')
  async dailyPdf(@Param('projectId') projectId: string, @Param('date') date: string) {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } });
    const xlsx = await this.office.daily(projectId, date, { onlyDay: true });
    if (!xlsx) throw new NotFoundException('Proyek ini belum punya file Excel laporan harian.');
    return this.pdf(xlsx, `Laporan Harian ${p.code} ${date}.pdf`);
  }

  private async pdf(xlsx: Buffer, filename: string) {
    return new StreamableFile(await xlsxToPdf(xlsx), { type: 'application/pdf', disposition: `inline; filename*=UTF-8''${encodeURIComponent(filename)}` });
  }

  @Get('daily/:date')
  @RequireProjectPermission('rab.read')
  async dailyExcel(@Param('projectId') projectId: string, @Param('date') date: string) {
    const [report, templates, p] = await Promise.all([
      this.daily.get(projectId, date),
      this.templates.list(projectId),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    // D-088: the office's daily workbook when one is uploaded, otherwise the layout built from the template.
    const office = await this.office.daily(projectId, date);
    const logos = office ? {} : await this.logos(projectId, templates.logos);
    const data = office ?? (await dailyWorkbook({
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
    }));
    const filename = `Laporan Harian ${p.code} ${date}.xlsx`;
    return new StreamableFile(data, {
      type: XLSX,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }
}
