import { ConflictException, Injectable } from '@nestjs/common';
import { Decimal } from '@laporan-proyek/calc';
import type { WeeklyReportContent } from '@laporan-proyek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTemplatesService } from './report-templates.service';
import { fillProgressSheets, matchItems, progressItemRows, type WorkbookItem } from './weekly-workbook';
import { rabVersionLabel } from '@laporan-proyek/shared';
import { UnsafeWorkbookError, Xlsx } from './workbook-xml';

/** Office sheet names of one week (Serangan pack): cover, rekap, progress, time schedule. */
export const weeklySheets = (n: number) => [`C.${n}`, `RM.${n}`, `M.${n}`, `Curva S M.${n}`];

/**
 * D-086: exports that fill the office's own workbook. Only the progress inputs are written (cumulative % per item
 * per week, column R of M.n); every other figure comes from the workbook's formulas, so the file is the office file.
 */
@Injectable()
export class OfficeWorkbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: ReportTemplatesService,
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
  async weekly(projectId: string, weekNumber: number, content: WeeklyReportContent, opts: { onlyWeek?: boolean } = {}): Promise<Buffer | null> {
    const file = await this.templates.readWorkbook(projectId, 'WEEKLY');
    if (!file) return null;
    const x = await Xlsx.open(file.data);
    const progressSheets = x.sheets.flatMap((s) => {
      const m = /^M\.(\d+)$/.exec(s.name);
      return m ? [{ week: Number(m[1]), name: s.name }] : [];
    });
    const last = Math.max(0, ...progressSheets.map((s) => s.week));
    if (!x.sheet(`M.${weekNumber}`))
      throw new ConflictException(
        last ? `File Excel laporan mingguan baru memuat sheet sampai M.${last}. Tambahkan sheet minggu ${weekNumber} di Excel lalu unggah ulang.` : 'File Excel laporan mingguan tidak memuat sheet progres M.n.',
      );
    const rows = await progressItemRows(x, `M.${weekNumber}`);
    const pairs = await this.pairWithVersion(projectId, rows);

    const progress = await this.prisma.weeklyProgress.findMany({
      where: { projectId, week: { weekNumber: { lte: weekNumber } } },
      select: { workItemId: true, actualVolume: true, week: { select: { weekNumber: true } } },
    });
    const byItem = new Map<string, Decimal[]>();
    for (const p of progress) {
      const weeks = byItem.get(p.workItemId) ?? byItem.set(p.workItemId, Array.from({ length: weekNumber + 1 }, () => new Decimal(0))).get(p.workItemId)!;
      weeks[p.week.weekNumber] = weeks[p.week.weekNumber]!.plus(p.actualVolume.toString());
    }
    const cumulative = (workItemId: string, week: number) => (byItem.get(workItemId) ?? []).slice(0, week + 1).reduce((a, b) => a.plus(b), new Decimal(0));

    await fillProgressSheets(
      x,
      progressSheets.filter((s) => s.week <= weekNumber),
      pairs,
      cumulative,
    );
    x.recalcOnOpen();
    await x.focus(`C.${weekNumber}`, opts.onlyWeek ? weeklySheets(weekNumber).filter((n) => x.sheet(n)) : undefined);
    if (opts.onlyWeek)
      try {
        await x.stripOutsideData();
      } catch (err) {
        if (err instanceof UnsafeWorkbookError) throw new ConflictException(err.message);
        throw err;
      }
    return x.save();
  }
}
