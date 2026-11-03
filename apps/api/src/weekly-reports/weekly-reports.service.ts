import { addDays, daysInclusive, Decimal, plannedFinishDate } from '@laporan-proyek/calc';
import {
  type MonthlyReportDto,
  type ReviewWeeklyReportInput,
  type WeatherCondition,
  type WeeklyReportContent,
  type WeeklyReportDto,
  type WeeklyReportSummaryDto,
} from '@laporan-proyek/shared';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService, today } from '../progress/progress.service';
import { fromDbDate, toDbDate } from '../projects/project-calendar';
import { SchedulesService } from '../schedules/schedules.service';
import { mergePeriod } from './monthly-report';

const USER = { select: { id: true, name: true } } as const;
const REPORT_SELECT = {
  id: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNote: true,
  finalizedAt: true,
  updatedAt: true,
  submittedByUser: USER,
  reviewedByUser: USER,
  finalizedByUser: USER,
} satisfies Prisma.WeeklyReportSelect;
type ReportRow = Prisma.WeeklyReportGetPayload<{ select: typeof REPORT_SELECT }>;
type Live = { content: WeeklyReportContent; enteredBy: { id: string; name: string }[]; issues: { errors: string[]; warnings: string[] } };

/** D-081: weekly report built from progress, schedule and daily reports; frozen as a snapshot when FINAL. */
@Injectable()
export class WeeklyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
    private readonly schedules: SchedulesService,
  ) {}

  async list(projectId: string): Promise<WeeklyReportSummaryDto[]> {
    const weeks = await this.prisma.projectWeek.findMany({
      where: { projectId },
      select: { weekNumber: true, startDate: true, endDate: true, weeklyReport: { select: { status: true } } },
      orderBy: { weekNumber: 'asc' },
    });
    if (!weeks.length) throw new NotFoundException('Proyek tidak ditemukan.');
    return weeks.map((w) => summaryOf(w, w.weeklyReport?.status ?? null));
  }

  async get(projectId: string, weekNumber: number): Promise<WeeklyReportDto> {
    const week = await findWeek(this.prisma, projectId, weekNumber);
    const [project, report] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } }),
      this.prisma.weeklyReport.findUnique({ where: { weekId: week.id }, select: REPORT_SELECT }),
    ]);
    const summary = summaryOf(week, report?.status ?? null);
    const active = project.status === 'ACTIVE';
    if (report?.status === 'FINAL') {
      const snap = await this.prisma.weeklyReportSnapshot.findFirstOrThrow({ where: { weeklyReportId: report.id }, orderBy: { createdAt: 'desc' }, select: { payload: true } });
      const frozen = snap.payload as unknown as Live;
      return { summary, report: reportDto(report), ...frozen, fromSnapshot: true, active };
    }
    return { summary, report: report && reportDto(report), ...(await this.build(projectId, weekNumber)), fromSnapshot: false, active };
  }

  /** D-087: B.n from its weeks' reports (FINAL weeks from their snapshot, others live). */
  async monthly(projectId: string, periodNumber: number): Promise<MonthlyReportDto> {
    const weeks = (await this.list(projectId)).filter((w) => Math.ceil(w.weekNumber / 4) === periodNumber);
    if (!weeks.length) throw new NotFoundException(`Periode B${periodNumber} tidak ada di proyek ini.`);
    // One week at a time: each report is several queries, and a period has at most four.
    const reports: WeeklyReportDto[] = [];
    for (const w of weeks) reports.push(await this.get(projectId, w.weekNumber));
    return { periodNumber, weeks: reports.map((r) => r.summary), content: mergePeriod(periodNumber, reports.map((r) => r.content)) };
  }

  async submit(actor: AuthUser, projectId: string, weekNumber: number): Promise<WeeklyReportDto> {
    await this.prisma.$transaction(async (tx) => {
      const week = await lockWeek(tx, projectId, weekNumber);
      if (week.endDate > today()) throw new ConflictException(`Minggu ${weekNumber} belum berakhir (sampai ${week.endDate}); ajukan setelah minggu selesai.`);
      if (await tx.weeklyReport.findUnique({ where: { weekId: week.id }, select: { id: true } })) throw new ConflictException(`Laporan minggu ${weekNumber} sudah diajukan.`);
      const { issues } = await this.build(projectId, weekNumber);
      if (issues.errors.length) throw new ConflictException({ message: 'Laporan belum dapat diajukan.', errors: issues.errors });
      const created = await tx.weeklyReport.create({ data: { projectId, weekId: week.id, submittedBy: actor.id, submittedAt: new Date() }, select: { id: true } });
      await writeAudit(tx, { actorId: actor.id, action: 'SUBMIT_WEEKLY_REPORT', entityType: 'WEEKLY_REPORT', entityId: created.id, projectId, newValue: { weekNumber, status: 'DRAFT' } });
    });
    return this.get(projectId, weekNumber);
  }

  async review(actor: AuthUser, projectId: string, weekNumber: number, input: ReviewWeeklyReportInput): Promise<WeeklyReportDto> {
    await this.prisma.$transaction(async (tx) => {
      const week = await lockWeek(tx, projectId, weekNumber);
      const report = await findReport(tx, week.id, weekNumber);
      if (report.status !== 'DRAFT' && report.status !== 'REOPENED') throw new ConflictException('Hanya laporan yang diajukan atau dibuka kembali yang dapat diperiksa.');
      const { issues, enteredBy } = await this.build(projectId, weekNumber);
      // PRD §2: a reviewer never checks their own entries; domain rules apply to super admins too.
      if (enteredBy.some((u) => u.id === actor.id))
        throw new ForbiddenException('Anda ikut mengisi atau mengubah progres minggu ini, jadi tidak dapat memeriksanya. Minta pemeriksa lain.');
      gate(issues, input.acknowledgeWarnings, 'diperiksa');
      await tx.weeklyReport.update({ where: { id: report.id }, data: { status: 'REVIEWED', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: input.note || null } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'REVIEW_WEEKLY_REPORT',
        entityType: 'WEEKLY_REPORT',
        entityId: report.id,
        projectId,
        oldValue: { status: report.status },
        newValue: { weekNumber, status: 'REVIEWED', note: input.note ?? null, acknowledgedWarnings: issues.warnings },
      });
    });
    return this.get(projectId, weekNumber);
  }

  async finalize(actor: AuthUser, projectId: string, weekNumber: number, acknowledgeWarnings: boolean): Promise<WeeklyReportDto> {
    await this.prisma.$transaction(
      async (tx) => {
        const week = await lockWeek(tx, projectId, weekNumber);
        const report = await findReport(tx, week.id, weekNumber);
        if (report.status !== 'REVIEWED') throw new ConflictException('Laporan harus diperiksa dulu sebelum difinalkan.');
        // The project row lock keeps progress writers out, so the snapshot matches what was checked here.
        const live = await this.build(projectId, weekNumber);
        gate(live.issues, acknowledgeWarnings, 'difinalkan');
        await tx.weeklyReportSnapshot.create({ data: { weeklyReportId: report.id, payload: live as unknown as Prisma.InputJsonObject, createdBy: actor.id } });
        await tx.weeklyReport.update({ where: { id: report.id }, data: { status: 'FINAL', finalizedBy: actor.id, finalizedAt: new Date() } });
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'FINALIZE_WEEKLY_REPORT',
          entityType: 'WEEKLY_REPORT',
          entityId: report.id,
          projectId,
          oldValue: { status: report.status },
          newValue: { weekNumber, status: 'FINAL', actualCumulative: live.content.totals.actualCumulative, acknowledgedWarnings: live.issues.warnings },
        });
      },
      { timeout: 30_000 },
    );
    return this.get(projectId, weekNumber);
  }

  async reopen(actor: AuthUser, projectId: string, weekNumber: number, reason: string): Promise<WeeklyReportDto> {
    await this.prisma.$transaction(async (tx) => {
      const week = await lockWeek(tx, projectId, weekNumber);
      const report = await findReport(tx, week.id, weekNumber);
      if (report.status !== 'FINAL') throw new ConflictException('Hanya laporan final yang dapat dibuka kembali.');
      const later = await tx.weeklyReport.findFirst({ where: { projectId, status: 'FINAL', week: { weekNumber: { gt: weekNumber } } }, select: { week: { select: { weekNumber: true } } } });
      // Later final weeks would stay locked anyway (D-081 butir 5); reopen from the latest one backwards.
      if (later) throw new ConflictException(`Laporan minggu ${later.week.weekNumber} juga final; buka kembali laporan itu lebih dulu.`);
      await tx.weeklyReport.update({ where: { id: report.id }, data: { status: 'REOPENED' } });
      await writeAudit(tx, { actorId: actor.id, action: 'REOPEN_WEEKLY_REPORT', entityType: 'WEEKLY_REPORT', entityId: report.id, projectId, oldValue: { status: 'FINAL' }, newValue: { weekNumber, status: 'REOPENED' }, reason });
    });
    return this.get(projectId, weekNumber);
  }

  /** Live content and issues (D-081 butir 1, 3). */
  private async build(projectId: string, weekNumber: number): Promise<Live> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const week = await findWeek(this.prisma, projectId, weekNumber);
    const [curve, progress, daily, progressRows] = await Promise.all([
      this.schedules.sCurve(projectId, weekNumber),
      this.progress.get(projectId, weekNumber),
      this.prisma.dailyReport.findMany({
        where: { projectId, reportDate: { gte: toDbDate(week.startDate), lte: toDbDate(week.endDate) } },
        select: { reportDate: true, status: true, resources: { select: { category: true, name: true, unit: true, actualQuantity: true } }, weather: { select: { condition: true } } },
      }),
      this.prisma.weeklyProgress.findMany({ where: { projectId, weekId: week.id }, select: { enteredByUser: USER, updatedByUser: USER } }),
    ]);

    // Item bobot = subtotal / version total, as on the RAB sheet (column S of the office workbook).
    const itemWeights: Record<string, string> = {};
    if (progress.week.baseline) {
      const version = await this.prisma.rabVersion.findUniqueOrThrow({
        where: { id: progress.week.baseline.rabVersionId },
        select: { totalValue: true, items: { where: { rowType: 'ITEM' }, select: { id: true, subtotal: true } } },
      });
      const total = new Decimal(version.totalValue?.toString() ?? 0);
      if (total.gt(0))
        for (const it of version.items)
          itemWeights[it.id] = new Decimal(it.subtotal?.toString() ?? 0).div(total).times(100).toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed();
    }

    const i = weekNumber - 1;
    const sum = (xs: (string | null | undefined)[]) => xs.reduce((t, x) => t.plus(x ?? 0), new Decimal(0));
    const recap = curve.rows.map((r) => {
      if (r.weight === null) return { id: r.id, displayNumber: r.displayNumber, description: r.description, weight: null, previous: null, thisWeek: null, cumulative: null };
      const previous = sum(r.actual.slice(0, i));
      const thisWeek = new Decimal(r.actual[i] ?? 0);
      return { id: r.id, displayNumber: r.displayNumber, description: r.description, weight: r.weight, previous: previous.toFixed(), thisWeek: thisWeek.toFixed(), cumulative: previous.plus(thisWeek).toFixed() };
    });
    const w = curve.weeks[i]!;
    const startDate = fromDbDate(project.startDate);
    const usedDays = Math.min(daysInclusive(startDate, week.endDate), project.durationDays);

    const byDate = new Map(daily.map((d) => [fromDbDate(d.reportDate), d]));
    const days = Array.from({ length: daysInclusive(week.startDate, week.endDate) }, (_, k) => {
      const date = addDays(week.startDate, k);
      return { date, status: byDate.get(date)?.status ?? null };
    });
    const labor = new Map<string, { name: string; unit: string | null; total: Decimal }>();
    const resources = new Map<string, { category: 'MATERIAL' | 'EQUIPMENT'; name: string; unit: string | null; total: Decimal }>();
    const weather = new Map<WeatherCondition, Set<string>>();
    for (const d of daily) {
      for (const r of d.resources) {
        if (r.actualQuantity === null) continue;
        const key = `${r.category}|${r.name.trim().toLowerCase()}|${(r.unit ?? '').trim().toLowerCase()}`;
        const target = r.category === 'LABOR' ? labor : resources;
        const line = target.get(key) ?? { category: r.category, name: r.name.trim(), unit: r.unit, total: new Decimal(0) };
        line.total = line.total.plus(r.actualQuantity.toString());
        target.set(key, line as never);
      }
      for (const x of d.weather) weather.set(x.condition, (weather.get(x.condition) ?? new Set()).add(fromDbDate(d.reportDate)));
    }
    const wet = new Set([...(weather.get('RAIN') ?? []), ...(weather.get('DRIZZLE') ?? [])]);

    const errors: string[] = [];
    const warnings: string[] = [];
    if (!progress.week.baseline) errors.push(`Minggu ${weekNumber} belum memiliki baseline; aktifkan baseline di halaman RAB.`);
    if (w.plannedCumulative === null) warnings.push('Jadwal versi baseline belum approved; rencana, deviasi, dan rekap per kelompok kosong.');
    const missing = days.filter((d) => !d.status).map((d) => d.date);
    const notFinal = days.filter((d) => d.status && d.status !== 'FINAL').map((d) => d.date);
    if (missing.length) warnings.push(`Laporan harian belum dibuat: ${missing.map(shortDate).join(', ')}.`);
    if (notFinal.length) warnings.push(`Laporan harian belum final: ${notFinal.map(shortDate).join(', ')}.`);

    const enteredBy = new Map<string, { id: string; name: string }>();
    for (const p of progressRows) for (const u of [p.enteredByUser, p.updatedByUser]) enteredBy.set(u.id, u);

    return {
      content: {
        project: {
          code: project.code,
          activityName: project.activityName,
          subActivityName: project.subActivityName,
          projectName: project.projectName,
          location: project.location,
          fiscalYear: project.fiscalYear,
          contractorName: project.contractorName,
          consultantName: project.consultantName,
          contractNumber: project.contractNumber,
          contractDate: fromDbDate(project.contractDate),
          spmkNumber: project.spmkNumber,
          spmkDate: fromDbDate(project.spmkDate),
          startDate,
          durationDays: project.durationDays,
          plannedFinishDate: plannedFinishDate(startDate, project.durationDays),
        },
        week: { weekNumber, startDate: week.startDate, endDate: week.endDate },
        baseline: progress.week.baseline && { label: progress.week.baseline.label },
        recap,
        totals: {
          actualThisWeek: w.actual ?? '0',
          actualCumulative: w.actualCumulative ?? '0',
          plannedThisWeek: w.planned,
          plannedCumulative: w.plannedCumulative,
          deviation: w.deviation,
          durationDays: project.durationDays,
          usedDays,
          remainingDays: project.durationDays - usedDays,
        },
        // Later weeks keep their plan; their actual is not part of this report.
        curve: {
          ...curve,
          currentWeek: weekNumber,
          rows: curve.rows.map((r) => ({ ...r, actual: r.actual.map((a, k) => (k < weekNumber ? a : null)) })),
          weeks: curve.weeks.map((x) => (x.weekNumber <= weekNumber ? x : { ...x, actual: null, actualCumulative: null, deviation: null })),
        },
        items: progress.rows,
        itemWeights,
        daily: {
          days,
          labor: [...labor.values()].map((l) => ({ name: l.name, unit: l.unit, total: l.total.toFixed() })).sort((a, b) => a.name.localeCompare(b.name, 'id')),
          resources: [...resources.values()]
            .map((r) => ({ category: r.category, name: r.name, unit: r.unit, total: r.total.toFixed() }))
            .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'id')),
          weather: [...weather].map(([condition, set]) => ({ condition, days: set.size })),
          rainDays: wet.size,
        },
      },
      enteredBy: [...enteredBy.values()],
      issues: { errors, warnings },
    };
  }
}

/** "13 Okt" for messages. */
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function summaryOf(w: { weekNumber: number; startDate: Date | string; endDate: Date | string }, status: WeeklyReportSummaryDto['status']): WeeklyReportSummaryDto {
  const startDate = typeof w.startDate === 'string' ? w.startDate : fromDbDate(w.startDate);
  const endDate = typeof w.endDate === 'string' ? w.endDate : fromDbDate(w.endDate);
  return { weekNumber: w.weekNumber, startDate, endDate, status, ended: endDate <= today() };
}

function reportDto(r: ReportRow): NonNullable<WeeklyReportDto['report']> {
  return {
    id: r.id,
    status: r.status,
    submittedBy: r.submittedByUser,
    submittedAt: r.submittedAt.toISOString(),
    reviewedBy: r.reviewedByUser,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote,
    finalizedBy: r.finalizedByUser,
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** ERROR blocks; WARNING needs the caller's acknowledgement (D-081 butir 3). */
function gate(issues: Live['issues'], acknowledged: boolean | undefined, verb: string) {
  if (issues.errors.length) throw new ConflictException({ message: `Laporan belum dapat ${verb}.`, errors: issues.errors });
  if (issues.warnings.length && !acknowledged) throw new ConflictException({ message: 'Ada peringatan; konfirmasi untuk melanjutkan.', warnings: issues.warnings });
}

type Db = Prisma.TransactionClient | PrismaService;

async function findWeek(db: Db, projectId: string, weekNumber: number) {
  const w = await db.projectWeek.findUnique({ where: { projectId_weekNumber: { projectId, weekNumber } }, select: { id: true, weekNumber: true, startDate: true, endDate: true } });
  if (!w) throw new NotFoundException(`Minggu ${weekNumber} tidak ada di proyek ini.`);
  return { id: w.id, weekNumber: w.weekNumber, startDate: fromDbDate(w.startDate), endDate: fromDbDate(w.endDate) };
}

/** Status changes need an ACTIVE project; the row lock serialises them with progress writes. */
async function lockWeek(tx: Prisma.TransactionClient, projectId: string, weekNumber: number) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; laporan tidak dapat diubah.');
  return findWeek(tx, projectId, weekNumber);
}

async function findReport(tx: Prisma.TransactionClient, weekId: string, weekNumber: number) {
  const report = await tx.weeklyReport.findUnique({ where: { weekId }, select: { id: true, status: true } });
  if (!report) throw new NotFoundException(`Laporan minggu ${weekNumber} belum diajukan.`);
  return report;
}
