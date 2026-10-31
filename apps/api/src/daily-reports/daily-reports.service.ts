import { addDays, daysInclusive, Decimal, isValidIsoDate, resourceNeeds, type AhspComponentNode } from '@laporan-proyek/calc';
import type { DailyReportDayDto, DailyReportDto, DailyResourceLineDto, SaveDailyReportInput } from '@laporan-proyek/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService, today } from '../progress/progress.service';
import { fromDbDate, toDbDate } from '../projects/project-calendar';

type Db = Prisma.TransactionClient | PrismaService;

const REPORT_SELECT = {
  id: true,
  status: true,
  note: true,
  updatedAt: true,
  finalizedAt: true,
  createdByUser: { select: { id: true, name: true } },
  updatedByUser: { select: { id: true, name: true } },
  finalizedByUser: { select: { id: true, name: true } },
  resources: { orderBy: [{ category: 'asc' as const }, { sortOrder: 'asc' as const }] },
  weather: { orderBy: { sortOrder: 'asc' } },
  work: { select: { workItemId: true, volume: true, workItem: { select: { internalCode: true, canonicalDescription: true } } } },
} satisfies Prisma.DailyReportSelect;

/** D-079: one daily report per project date; work from the daily allocation, materials/equipment from AHSP. */
@Injectable()
export class DailyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
  ) {}

  async days(projectId: string, weekNumber: number): Promise<DailyReportDayDto[]> {
    const project = await findProject(this.prisma, projectId);
    const week = await this.prisma.projectWeek.findUnique({ where: { projectId_weekNumber: { projectId, weekNumber } }, select: { startDate: true, endDate: true } });
    if (!week) throw new NotFoundException(`Minggu ${weekNumber} tidak ada di proyek ini.`);
    const reports = await this.prisma.dailyReport.findMany({ where: { projectId, reportDate: { gte: week.startDate, lte: week.endDate } }, select: { reportDate: true, status: true } });
    const status = new Map(reports.map((r) => [fromDbDate(r.reportDate), r.status]));
    const start = fromDbDate(week.startDate);
    return Array.from({ length: daysInclusive(start, fromDbDate(week.endDate)) }, (_, i) => {
      const date = addDays(start, i);
      return { date, day: i + 1, status: status.get(date) ?? null, open: project.status === 'ACTIVE' && date <= today() };
    });
  }

  async get(projectId: string, date: string): Promise<DailyReportDto> {
    const project = await findProject(this.prisma, projectId);
    const week = await findWeek(this.prisma, projectId, date);
    const day = daysInclusive(week.startDate, date);
    const [report, allocation] = await Promise.all([
      this.prisma.dailyReport.findUnique({ where: { projectId_reportDate: { projectId, reportDate: toDbDate(date) } }, select: REPORT_SELECT }),
      this.progress.daily(projectId, week.weekNumber),
    ]);
    const frozen = report?.status === 'FINAL';
    const baseline = allocation.week.baseline;

    const live = allocation.rows
      .filter((r) => new Decimal(r.volumes[day - 1] ?? 0).gt(0))
      .map((r) => ({ workItemId: r.workItemId, workItemCode: r.workItemCode, description: r.description, unit: r.unit, volume: r.volumes[day - 1]!, method: r.method, mismatch: r.mismatch }));
    const workRows = frozen
      ? report.work.map((w) => ({ workItemId: w.workItemId, workItemCode: w.workItem.internalCode, description: w.workItem.canonicalDescription, unit: null as string | null, volume: new Decimal(w.volume.toString()).toFixed(), method: 'FINAL' as const, mismatch: false }))
      : live;

    // AHSP of each work item in the week's baseline (D-079 butir 4).
    const rabItems = baseline
      ? await this.prisma.rabVersionItem.findMany({
          where: { rabVersionId: baseline.rabVersionId, workItemId: { in: workRows.map((w) => w.workItemId) } },
          select: { workItemId: true, unit: true, analysisVersionId: true, analysisVersion: { select: { code: true } } },
        })
      : [];
    const byWorkItem = new Map(rabItems.map((i) => [i.workItemId!, i]));
    const analyses = await loadAnalyses(this.prisma, rabItems.flatMap((i) => (i.analysisVersionId ? [i.analysisVersionId] : [])));
    const needs = resourceNeeds(
      workRows.map((w) => ({ analysisId: byWorkItem.get(w.workItemId)?.analysisVersionId ?? null, volume: w.volume })),
      analyses,
      ['MATERIAL', 'EQUIPMENT'],
    );

    // Lines: calculated needs merged with what was saved; hand-typed lines as saved.
    const stored = report?.resources ?? [];
    const lineOf = (r: (typeof stored)[number]): DailyResourceLineDto => ({
      id: r.id,
      category: r.category,
      sourceKey: r.sourceKey,
      name: r.name,
      unit: r.unit,
      calculated: r.calculatedQuantity === null ? null : new Decimal(r.calculatedQuantity.toString()).toFixed(),
      actual: r.actualQuantity === null ? null : new Decimal(r.actualQuantity.toString()).toFixed(),
      note: r.note,
    });
    let resources: DailyResourceLineDto[];
    let prefilledFrom: string | null = null;
    if (frozen) resources = stored.map(lineOf);
    else {
      const savedByKey = new Map(stored.filter((r) => r.sourceKey).map((r) => [`${r.category}:${r.sourceKey}`, r]));
      const calculated = needs.map((n): DailyResourceLineDto => {
        const s = savedByKey.get(`${n.category}:${n.key}`);
        savedByKey.delete(`${n.category}:${n.key}`);
        return { ...(s ? lineOf(s) : { id: null, actual: null, note: null }), category: n.category, sourceKey: n.key, name: n.name, unit: n.unit, calculated: n.quantity };
      });
      // A saved calculated line whose work is gone keeps its actual, with nothing calculated now.
      const orphaned = [...savedByKey.values()].map((r) => ({ ...lineOf(r), calculated: '0' }));
      let typed = stored.filter((r) => !r.sourceKey).map(lineOf);
      if (!report) {
        const previous = await this.prisma.dailyReport.findFirst({
          where: { projectId, reportDate: { lt: toDbDate(date) } },
          orderBy: { reportDate: 'desc' },
          select: { reportDate: true, resources: { where: { OR: [{ category: 'LABOR' }, { category: 'EQUIPMENT', sourceKey: null }] }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] } },
        });
        if (previous?.resources.length) {
          prefilledFrom = fromDbDate(previous.reportDate);
          typed = previous.resources.map((r) => ({ ...lineOf(r), id: null }));
        }
      }
      const order = { LABOR: 0, MATERIAL: 1, EQUIPMENT: 2 } as const;
      resources = [...typed.filter((r) => r.category === 'LABOR'), ...calculated, ...orphaned, ...typed.filter((r) => r.category !== 'LABOR')].sort(
        (a, b) => order[a.category] - order[b.category],
      );
    }

    const laborOptions = await this.laborOptions(projectId, baseline?.rabVersionId ?? null);
    const weather = (report?.weather ?? []).map((w) => ({ condition: w.condition, fromTime: w.fromTime, toTime: w.toTime, note: w.note }));
    const errors = frozen ? [] : live.filter((w) => w.mismatch).map((w) => `${w.description}: alokasi manual tidak sama dengan volume minggu; perbaiki di alokasi harian minggu ${week.weekNumber}.`);
    const warnings: string[] = [];
    if (!resources.some((r) => r.category === 'LABOR' && r.actual && new Decimal(r.actual).gt(0))) warnings.push('Tenaga kerja belum diisi.');
    if (!weather.length) warnings.push('Cuaca belum diisi.');
    if (!workRows.length) warnings.push('Tidak ada pekerjaan pada tanggal ini (alokasi harian kosong).');

    return {
      date,
      week: { weekNumber: week.weekNumber, startDate: week.startDate, endDate: week.endDate, baseline },
      day,
      report: report && {
        id: report.id,
        status: report.status,
        createdBy: report.createdByUser,
        updatedBy: report.updatedByUser,
        updatedAt: report.updatedAt.toISOString(),
        finalizedBy: report.finalizedByUser,
        finalizedAt: report.finalizedAt?.toISOString() ?? null,
      },
      open: project.status === 'ACTIVE' && date <= today(),
      note: report?.note ?? null,
      work: workRows.map((w) => {
        const item = byWorkItem.get(w.workItemId);
        return { workItemId: w.workItemId, workItemCode: w.workItemCode, description: w.description, unit: w.unit ?? item?.unit ?? null, volume: w.volume, method: w.method, analysis: item?.analysisVersion?.code ?? null };
      }),
      resources,
      weather,
      laborOptions,
      prefilledFrom,
      issues: { errors, warnings },
    };
  }

  async save(actor: AuthUser, projectId: string, date: string, input: SaveDailyReportInput): Promise<DailyReportDto> {
    for (const w of input.weather)
      if (w.fromTime && w.toTime && w.fromTime > w.toTime) throw new BadRequestException(`Jam cuaca ${w.fromTime}–${w.toTime}: jam mulai setelah jam selesai.`);
    await this.prisma.$transaction(async (tx) => {
      const { week } = await lockOpenDate(tx, projectId, date);
      const existing = await tx.dailyReport.findUnique({ where: { projectId_reportDate: { projectId, reportDate: toDbDate(date) } }, select: { id: true, status: true } });
      if (existing?.status === 'FINAL') throw new ConflictException('Laporan sudah final; buka kembali untuk mengubahnya.');
      const id = existing
        ? (await tx.dailyReport.update({ where: { id: existing.id }, data: { note: input.note || null, updatedBy: actor.id }, select: { id: true } })).id
        : (await tx.dailyReport.create({ data: { projectId, weekId: week.id, reportDate: toDbDate(date), note: input.note || null, createdBy: actor.id, updatedBy: actor.id }, select: { id: true } })).id;
      // Draft lines are working content, replaced on every save (D-079); FINAL freezes them.
      await tx.dailyReportResource.deleteMany({ where: { dailyReportId: id } });
      await tx.dailyReportResource.createMany({
        data: input.resources.map((r, i) => ({
          dailyReportId: id,
          category: r.category,
          sortOrder: i,
          sourceKey: r.category === 'LABOR' ? null : (r.sourceKey ?? null),
          name: r.name,
          unit: r.unit || null,
          actualQuantity: r.actual ?? null,
          note: r.note || null,
        })),
      });
      await tx.dailyReportWeather.deleteMany({ where: { dailyReportId: id } });
      await tx.dailyReportWeather.createMany({
        data: input.weather.map((w, i) => ({ dailyReportId: id, sortOrder: i, condition: w.condition, fromTime: w.fromTime ?? null, toTime: w.toTime ?? null, note: w.note || null })),
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: existing ? 'UPDATE_DAILY_REPORT' : 'CREATE_DAILY_REPORT',
        entityType: 'DAILY_REPORT',
        entityId: id,
        projectId,
        newValue: { date, resourceCount: input.resources.length, weatherCount: input.weather.length },
      });
    });
    return this.get(projectId, date);
  }

  async finalize(actor: AuthUser, projectId: string, date: string, acknowledgeWarnings: boolean): Promise<DailyReportDto> {
    const detail = await this.get(projectId, date);
    if (!detail.report) throw new ConflictException('Simpan laporan dulu sebelum difinalkan.');
    if (detail.issues.errors.length) throw new ConflictException({ message: 'Laporan belum dapat difinalkan.', errors: detail.issues.errors });
    if (detail.issues.warnings.length && !acknowledgeWarnings)
      throw new ConflictException({ message: 'Ada peringatan; konfirmasi untuk tetap memfinalkan.', warnings: detail.issues.warnings });
    await this.prisma.$transaction(async (tx) => {
      await lockOpenDate(tx, projectId, date);
      const report = await tx.dailyReport.findUniqueOrThrow({ where: { id: detail.report!.id }, select: { status: true, updatedAt: true } });
      if (report.status === 'FINAL') throw new ConflictException('Laporan sudah final.');
      if (report.updatedAt.toISOString() !== detail.report!.updatedAt) throw new ConflictException('Laporan baru saja diubah orang lain; muat ulang lalu finalkan.');
      const id = detail.report!.id;
      // Freeze the day's work and the calculated quantities next to the actuals (D-079 butir 7).
      await tx.dailyReportWork.deleteMany({ where: { dailyReportId: id } });
      await tx.dailyReportWork.createMany({ data: detail.work.map((w) => ({ dailyReportId: id, workItemId: w.workItemId, volume: w.volume })) });
      await tx.dailyReportResource.deleteMany({ where: { dailyReportId: id } });
      await tx.dailyReportResource.createMany({
        data: detail.resources.map((r, i) => ({
          dailyReportId: id,
          category: r.category,
          sortOrder: i,
          sourceKey: r.sourceKey,
          name: r.name,
          unit: r.unit,
          calculatedQuantity: r.calculated,
          actualQuantity: r.actual,
          note: r.note,
        })),
      });
      await tx.dailyReport.update({ where: { id }, data: { status: 'FINAL', finalizedBy: actor.id, finalizedAt: new Date(), updatedBy: actor.id } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'FINALIZE_DAILY_REPORT',
        entityType: 'DAILY_REPORT',
        entityId: id,
        projectId,
        newValue: { date, workCount: detail.work.length, acknowledgedWarnings: detail.issues.warnings },
      });
    });
    return this.get(projectId, date);
  }

  async reopen(actor: AuthUser, projectId: string, date: string, reason: string): Promise<DailyReportDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      if ((await findProject(tx, projectId)).status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; laporan tidak dapat diubah.');
      const report = await tx.dailyReport.findUnique({ where: { projectId_reportDate: { projectId, reportDate: toDbDate(checkDate(date)) } }, select: { id: true, status: true } });
      if (!report) throw new NotFoundException('Laporan harian tidak ditemukan.');
      if (report.status !== 'FINAL') throw new ConflictException('Hanya laporan final yang dapat dibuka kembali.');
      await tx.dailyReport.update({ where: { id: report.id }, data: { status: 'REOPENED', updatedBy: actor.id } });
      await writeAudit(tx, { actorId: actor.id, action: 'REOPEN_DAILY_REPORT', entityType: 'DAILY_REPORT', entityId: report.id, projectId, oldValue: { status: 'FINAL' }, newValue: { date, status: 'REOPENED' }, reason });
    });
    return this.get(projectId, date);
  }

  /** Labor names: the AHSP labor of the baseline's analyses, then names typed in earlier reports. */
  private async laborOptions(projectId: string, rabVersionId: string | null): Promise<string[]> {
    const [ahsp, typed] = await Promise.all([
      rabVersionId
        ? this.prisma.ahspComponent.findMany({
            where: { category: 'LABOR', subAnalysisVersionId: null, analysisVersion: { analysis: { rabVersionId } } },
            select: { description: true },
            distinct: ['description'],
          })
        : Promise.resolve([]),
      this.prisma.dailyReportResource.findMany({ where: { category: 'LABOR', dailyReport: { projectId } }, select: { name: true }, distinct: ['name'] }),
    ]);
    const seen = new Map<string, string>();
    for (const n of [...ahsp.map((a) => a.description), ...typed.map((t) => t.name)]) {
      const k = n.trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, n.trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'id'));
  }
}

function checkDate(date: string): string {
  if (!isValidIsoDate(date)) throw new NotFoundException('Tanggal tidak valid.');
  return date;
}

async function findProject(db: Db, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  return project;
}

async function findWeek(db: Db, projectId: string, date: string) {
  const d = toDbDate(checkDate(date));
  const w = await db.projectWeek.findFirst({ where: { projectId, startDate: { lte: d }, endDate: { gte: d } }, select: { id: true, weekNumber: true, startDate: true, endDate: true } });
  if (!w) throw new NotFoundException(`Tanggal ${date} di luar masa proyek.`);
  return { id: w.id, weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) };
}

/** Writes need an ACTIVE project and a date that has come (D-079 butir 1). */
async function lockOpenDate(tx: Prisma.TransactionClient, projectId: string, date: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  if ((await findProject(tx, projectId)).status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; laporan tidak dapat diubah.');
  const week = await findWeek(tx, projectId, date);
  if (date > today()) throw new ConflictException(`Tanggal ${date} belum tiba.`);
  return { week };
}

/** Components of the analyses and of every sub-analysis they use, by analysis version id. */
async function loadAnalyses(db: Db, versionIds: string[]): Promise<Map<string, AhspComponentNode[]>> {
  const map = new Map<string, AhspComponentNode[]>();
  let pending = [...new Set(versionIds)];
  while (pending.length) {
    for (const id of pending) map.set(id, []);
    const components = await db.ahspComponent.findMany({
      where: { analysisVersionId: { in: pending } },
      select: { analysisVersionId: true, category: true, description: true, unit: true, coefficient: true, priceItemId: true, subAnalysisVersionId: true },
      orderBy: [{ analysisVersionId: 'asc' }, { sortOrder: 'asc' }],
    });
    for (const c of components)
      map.get(c.analysisVersionId)!.push({
        category: c.category,
        key: c.priceItemId ?? `${c.description.trim().toLowerCase()}|${(c.unit ?? '').trim().toLowerCase()}`,
        name: c.description.trim(),
        unit: c.unit,
        coefficient: c.coefficient.toString(),
        subAnalysisId: c.subAnalysisVersionId,
      });
    pending = [...new Set(components.flatMap((c) => (c.subAnalysisVersionId && !map.has(c.subAnalysisVersionId) ? [c.subAnalysisVersionId] : [])))];
  }
  return map;
}
