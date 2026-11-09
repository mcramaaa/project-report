import { ConflictException, Injectable } from '@nestjs/common';
import { Decimal } from '@laporan-proyek/calc';
import { addDays, daysInclusive } from '@laporan-proyek/calc';
import { dailyWeatherRows, groupLabor, numberWithWords, type DailyReportDto } from '@laporan-proyek/shared';
import { DailyReportsService } from '../daily-reports/daily-reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTemplatesService } from './report-templates.service';
import { fillProgressSheets, matchItems, progressItemRows, type WorkbookItem } from './weekly-workbook';
import { rabVersionLabel } from '@laporan-proyek/shared';
import { setCells, UnsafeWorkbookError, Xlsx, type CellValue } from './workbook-xml';

/** Office sheet names of one week or period (Serangan pack): cover, rekap, progress, time schedule. */
const OFFICE = {
  WEEKLY: { code: 'M', label: 'laporan mingguan', sheets: (n: number) => [`C.${n}`, `RM.${n}`, `M.${n}`, `Curva S M.${n}`] },
  MONTHLY: { code: 'B', label: 'laporan bulanan', sheets: (n: number) => [`C.${n}`, `RB.${n}`, `B.${n}`, `CS B.${n}`] },
} as const;

/**
 * D-086: exports that fill the office's own workbook. Only the progress inputs are written (cumulative % per item
 * per week, column R of M.n); every other figure comes from the workbook's formulas, so the file is the office file.
 */
@Injectable()
export class OfficeWorkbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: ReportTemplatesService,
    private readonly dailyReports: DailyReportsService,
  ) {}

  /**
   * A workbook is made from one RAB version (e.g. MC 0) and keeps it for every week, while the baseline of early
   * weeks may be another version. Progress is per work item, so the workbook pairs with whichever approved version
   * it was made from (newest first); a workbook matching none is refused rather than filled into wrong rows.
   */
  private async pairWithVersion(projectId: string, rows: WorkbookItem[]): Promise<[WorkbookItem, { workItemId: string }][]> {
    const versions = await this.prisma.rabVersion.findMany({
      where: { projectId, status: 'APPROVED' },
      orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, versionType: true, revisionNumber: true, items: { select: { id: true, parentItemId: true, sortOrder: true, rowType: true, description: true, workItemId: true } } },
    });
    let best: { label: string; unmatched: WorkbookItem[] } | null = null;
    for (const v of versions) {
      const children = new Map<string | null, typeof v.items>();
      for (const it of v.items) children.set(it.parentItemId, [...(children.get(it.parentItemId) ?? []), it]);
      const ordered: { description: string; workItemId: string }[] = [];
      const walk = (parent: string | null) => {
        for (const it of (children.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
          if (it.rowType === 'ITEM' && it.workItemId) ordered.push({ description: it.description, workItemId: it.workItemId });
          walk(it.id);
        }
      };
      walk(null);
      const { pairs, unmatched } = matchItems(rows, ordered);
      if (!unmatched.length) return pairs;
      if (!best || unmatched.length < best.unmatched.length) best = { label: rabVersionLabel(v), unmatched };
    }
    throw new ConflictException(
      best
        ? `File Excel tidak cocok dengan versi RAB mana pun di proyek ini. Paling dekat RAB ${best.label}, tapi ${best.unmatched.length} baris tidak ditemukan (${best.unmatched
            .slice(0, 3)
            .map((u) => `baris ${u.row} "${u.description}"`)
            .join(', ')}).`
        : 'Proyek ini belum punya RAB approved untuk dicocokkan dengan file Excel.',
    );
  }

  /** The filled weekly workbook, opened on C.n; null when the project has no weekly workbook. */
  weekly(projectId: string, weekNumber: number, opts: { onlyPeriod?: boolean } = {}): Promise<Buffer | null> {
    return this.fill(projectId, 'WEEKLY', weekNumber, opts);
  }

  /** D-087: the filled monthly workbook (B.n holds the cumulative % at the end of the period's last week). */
  monthly(projectId: string, periodNumber: number, opts: { onlyPeriod?: boolean } = {}): Promise<Buffer | null> {
    return this.fill(projectId, 'MONTHLY', periodNumber, opts);
  }

  private async fill(projectId: string, type: 'WEEKLY' | 'MONTHLY', n: number, opts: { onlyPeriod?: boolean }): Promise<Buffer | null> {
    const file = await this.templates.readWorkbook(projectId, type);
    if (!file) return null;
    const { code, label, sheets: sheetsOf } = OFFICE[type];
    const x = await Xlsx.open(file.data);
    const progressSheets = x.sheets.flatMap((s) => {
      const m = new RegExp(`^${code}\\.(\\d+)$`).exec(s.name);
      return m ? [{ n: Number(m[1]), name: s.name }] : [];
    });
    const last = Math.max(0, ...progressSheets.map((s) => s.n));
    if (!x.sheet(`${code}.${n}`))
      throw new ConflictException(
        last ? `File Excel ${label} baru memuat sheet sampai ${code}.${last}. Tambahkan sheet ${code}.${n} di Excel lalu unggah ulang.` : `File Excel ${label} tidak memuat sheet progres ${code}.n.`,
      );
    const rows = await progressItemRows(x, `${code}.${n}`);
    const pairs = await this.pairWithVersion(projectId, rows);

    // A sheet holds the cumulative % up to its last week: week n, or week 4n for period B.n (D-010).
    const upTo = (k: number) => (type === 'WEEKLY' ? k : 4 * k);
    const progress = await this.prisma.weeklyProgress.findMany({
      where: { projectId, week: { weekNumber: { lte: upTo(n) } } },
      select: { workItemId: true, actualVolume: true, week: { select: { weekNumber: true } } },
    });
    const byItem = new Map<string, { week: number; volume: Decimal }[]>();
    for (const p of progress) byItem.set(p.workItemId, [...(byItem.get(p.workItemId) ?? []), { week: p.week.weekNumber, volume: new Decimal(p.actualVolume.toString()) }]);
    const cumulative = (workItemId: string, week: number) =>
      (byItem.get(workItemId) ?? []).filter((p) => p.week <= week).reduce((a, p) => a.plus(p.volume), new Decimal(0));

    await fillProgressSheets(
      x,
      progressSheets.filter((s) => s.n <= n).map((s) => ({ week: upTo(s.n), name: s.name })),
      pairs,
      cumulative,
    );
    x.recalcOnOpen();
    await x.focus(`C.${n}`, opts.onlyPeriod ? sheetsOf(n).filter((name) => x.sheet(name)) : undefined);
    if (opts.onlyPeriod)
      try {
        await x.stripOutsideData();
      } catch (err) {
        if (err instanceof UnsafeWorkbookError) throw new ConflictException(err.message);
        throw err;
      }
    return x.save();
  }

  /**
   * D-088: the daily workbook (Mengwi format) with the week of `date` filled from the daily reports; Har.n/Cov.n are
   * copied from the latest week sheet when missing. `onlyDay` keeps that day's page only (for the PDF).
   */
  async daily(projectId: string, date: string, opts: { onlyDay?: boolean } = {}): Promise<Buffer | null> {
    const file = await this.templates.readWorkbook(projectId, 'DAILY');
    if (!file) return null;
    const x = await Xlsx.open(file.data);
    const first = await this.dailyReports.get(projectId, date);
    const n = first.week.weekNumber;
    const sheet = `Har.${n}`;
    if (!x.sheet(sheet)) {
      const from = Math.max(0, ...x.sheets.map((s) => Number(/^Har\.(\d+)$/.exec(s.name)?.[1] ?? 0)).filter((k) => k < n));
      if (!from) throw new ConflictException('File Excel laporan harian tidak memuat sheet Har.n (format laporan harian kantor).');
      // Only the week sheets move to week n; A.k/B.k/C.k stay (their helper columns are not printed).
      // Names may be quoted as ' or &apos; (defined names are escaped XML text).
      const retarget = (xml: string) => xml.replace(new RegExp(`(?<![\\w.])(Har|Cov)\\.${from}(?=['!]|&apos;)`, 'g'), `$1.${n}`);
      await x.copySheet(`Har.${from}`, sheet, retarget);
      if (x.sheet(`Cov.${from}`)) await x.copySheet(`Cov.${from}`, `Cov.${n}`, retarget);
    }
    const t = (await this.templates.list(projectId)).templates.find((tp) => tp.reportType === 'DAILY')!.config;
    const days = Array.from({ length: daysInclusive(first.week.startDate, first.week.endDate) }, (_, i) => addDays(first.week.startDate, i));
    const reports = await Promise.all(days.map((d) => (d === date ? first : this.dailyReports.get(projectId, d))));
    const values = new Map<string, CellValue>();
    reports.forEach((r, k) => dailyBlock(values, 60 * k, n, r, t));
    x.write(sheet, setCells(await x.read(sheet), values));
    x.recalcOnOpen();
    const k = days.indexOf(date);
    await x.focus(sheet, opts.onlyDay ? [sheet] : undefined);
    if (opts.onlyDay) {
      x.setPrintArea(sheet, `$B$${2 + 60 * k}:$AD$${61 + 60 * k}`);
      try {
        await x.stripOutsideData();
      } catch (err) {
        if (err instanceof UnsafeWorkbookError) throw new ConflictException(err.message);
        throw err;
      }
    }
    return x.save();
  }
}

const DAY_NAMES = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
const LIST_ROWS = 32; // rows 14..45 of a day block
type Line = { no?: number; name: string; qty?: string | null; unit?: string | null };

/** One day block of Har.n (Mengwi layout, rows 3..62 shifted by `off`); a day without a saved report stays empty. */
function dailyBlock(values: Map<string, CellValue>, off: number, week: number, r: DailyReportDto, t: Parameters<typeof groupLabor>[0]) {
  const at = (col: string, row: number, v: CellValue) => values.set(`${col}${row + off}`, v);
  const [y, m, d] = r.date.split('-').map(Number) as [number, number, number];
  at('AA', 6, numberWithWords(week));
  at('AA', 7, DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!);
  at('AA', 8, (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000); // Excel date serial, cell keeps its format
  const saved = r.report !== null;
  const lines = (category: 'LABOR' | 'MATERIAL' | 'EQUIPMENT') =>
    saved ? r.resources.filter((x) => x.category === category && x.actual && Number(x.actual) > 0).map((x) => ({ name: x.name, qty: x.actual, unit: x.unit })) : [];
  const numbered = (xs: Line[]) => xs.map((l, i) => ({ ...l, no: i + 1 }));
  const labor = groupLabor(t, lines('LABOR')).flatMap((g, i) => [...(i ? [{ name: '' }] : []), ...(g.title ? [{ name: g.title }] : []), ...numbered(g.rows.map((l) => ({ ...l, unit: l.qty ? (l.unit ?? t.daily.totalUnit) : null })))]);
  list(at, ['C', 'D', 'G', 'H'], labor);
  list(at, ['I', 'J', 'K', 'L'], numbered(lines('EQUIPMENT')));
  list(at, ['M', 'N', 'O', 'P'], numbered(lines('MATERIAL')));
  list(at, ['Q', 'R', 'AB', 'AC'], saved ? numbered(r.work.map((w) => ({ name: w.description, qty: w.volume, unit: w.unit }))) : []);
  dailyWeatherRows(t, saved ? r.weather : []).forEach((w, i) => at('I', 47 + i, w.hours));
  const note = (saved ? (r.note ?? '') : '').split('\n').map((s) => s.trim()).filter(Boolean);
  at('Q', 48, note[0] ?? '');
  at('Q', 49, note.slice(1).join(' '));
}

/** A list of 32 rows (number, name, quantity, unit); longer lists end with "… dan N lainnya". */
function list(at: (col: string, row: number, v: CellValue) => void, [no, name, qty, unit]: string[], lines: Line[]) {
  const shown = lines.length > LIST_ROWS ? [...lines.slice(0, LIST_ROWS - 1), { name: `… dan ${lines.length - LIST_ROWS + 1} lainnya` }] : lines;
  for (let i = 0; i < LIST_ROWS; i++) {
    const l = shown[i];
    at(no!, 14 + i, l?.no ?? null);
    at(name!, 14 + i, l?.name ?? null);
    at(qty!, 14 + i, l?.qty ? Number(l.qty) : null);
    at(unit!, 14 + i, l?.unit ?? null);
  }
}
