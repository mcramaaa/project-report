import { Decimal } from '@laporan-proyek/calc';
import {
  DECIMALS,
  identityText,
  longDateId,
  numberWithWords,
  officeItemLines,
  REPORT_SECTIONS,
  roman,
  type LogoKind,
  type ReportTemplateConfig,
  type WeeklyReportContent,
} from '@laporan-proyek/shared';
import ExcelJS from 'exceljs';
import { imageSize, type ExcelLogo } from './daily-excel';
import { addLineChart, type ChartLine } from './xlsx-chart';

/** Office palette of the Serangan workbooks (theme colours with their tints, as plain RGB). */
const COLOR = {
  title: 'FF4474A0', // accent 5, 25 % darker: title bars, white text
  head: 'FFDAE3F3', // accent 1, 80 % lighter: table headers
  group: 'FFE7E6E6', // light 2: JUMLAH per group
  total: 'FFFFF2CC', // accent 4, 80 % lighter: JUMLAH TOTAL, realisation rows, month header
  plan: 'FFE2EFDA', // accent 6, 80 % lighter: plan rows
  week: 'FFDDEBF7', // week header
  now: 'FFFFD966', // the reported week
};
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const PAPER: Record<ReportTemplateConfig['page']['size'], number> = { A4: 9, F4: 9, LEGAL: 5 };
const W = DECIMALS.weight;
/** Accounting format as in the workbook: thousands separators, zero shown as "-". */
const acc = (dp: number) => {
  const d = dp > 0 ? `.${'0'.repeat(dp)}` : '';
  return `_(* #,##0${d}_);_(* (#,##0${d});_(* "-"??_);_(@_)`;
};
const value = (v: string | null | undefined, dp: number) =>
  v === null || v === undefined || v === '' ? null : Number(new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed());
const upper = (d: string) => longDateId(d).toUpperCase();
/** Excel date serial of an ISO date (1900 date system). */
const serial = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000 + 25_569;

type Style = {
  bold?: boolean;
  size?: number;
  underline?: boolean;
  white?: boolean;
  h?: ExcelJS.Alignment['horizontal'];
  v?: ExcelJS.Alignment['vertical'];
  wrap?: boolean;
  fill?: string;
  numFmt?: string;
};
type Side = Partial<ExcelJS.Border> | undefined;

/** Writer around one sheet: write, merge, table grid and the thick page frame of the office sheets. */
function sheet(wb: ExcelJS.Workbook, name: string, t: ReportTemplateConfig, widths: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.properties.defaultRowHeight = 15;
  const put = (r: number, c: number, v: ExcelJS.CellValue, s: Style = {}, c2 = c, r2 = r) => {
    if (c2 !== c || r2 !== r) ws.mergeCells(r, c, r2, c2);
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = { name: 'Calibri', size: s.size ?? 11, bold: s.bold, underline: s.underline, color: s.white ? { argb: 'FFFFFFFF' } : undefined };
    cell.alignment = { vertical: s.v ?? 'middle', horizontal: s.h, wrapText: s.wrap };
    if (s.fill) for (let rr = r; rr <= r2; rr++) for (let cc = c; cc <= c2; cc++) ws.getCell(rr, cc).fill = fill(s.fill);
    if (s.numFmt) cell.numFmt = s.numFmt;
    return cell;
  };
  /** Background over a row range without merging it. */
  const paint = (r: number, c1: number, c2: number, argb: string) => {
    for (let c = c1; c <= c2; c++) ws.getCell(r, c).fill = fill(argb);
  };
  const border = (r: number, c: number, sides: { top?: Side; left?: Side; bottom?: Side; right?: Side }) => {
    const cell = ws.getCell(r, c);
    cell.border = { ...cell.border, ...Object.fromEntries(Object.entries(sides).filter(([, v]) => v)) };
  };
  /** Table body: thin verticals, hairlines between rows, thin top and bottom. */
  const grid = (r1: number, c1: number, r2: number, c2: number) => {
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++)
        ws.getCell(r, c).border = {
          left: { style: 'thin' },
          right: { style: 'thin' },
          top: { style: r === r1 ? 'thin' : 'hair' },
          bottom: { style: r === r2 ? 'thin' : 'hair' },
        };
  };
  /** Line across a row range, e.g. medium above and below a JUMLAH row. */
  const rule = (r: number, c1: number, c2: number, top: ExcelJS.BorderStyle, bottom?: ExcelJS.BorderStyle) => {
    for (let c = c1; c <= c2; c++) border(r, c, { top: { style: top }, bottom: bottom ? { style: bottom } : undefined });
  };
  const frame = (r1: number, c1: number, r2: number, c2: number, style: ExcelJS.BorderStyle = 'thick') => {
    for (let c = c1; c <= c2; c++) {
      border(r1, c, { top: { style } });
      border(r2, c, { bottom: { style } });
    }
    for (let r = r1; r <= r2; r++) {
      border(r, c1, { left: { style } });
      border(r, c2, { right: { style } });
    }
  };
  const setup = (lastCol: number, lastRow: number, orientation: 'portrait' | 'landscape', fitHeight: 0 | 1) => {
    const m = t.page.marginMm / 25.4;
    ws.pageSetup = {
      paperSize: PAPER[t.page.size],
      orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: fitHeight,
      horizontalCentered: true,
      margins: { left: m, right: m, top: m, bottom: m, header: 0.2, footer: 0.2 },
      printArea: `B2:${ws.getColumn(lastCol).letter}${lastRow}`,
    };
  };
  return { ws, put, paint, grid, rule, frame, setup };
}
type Sheet = ReturnType<typeof sheet>;

/** Template label and visibility of a period column, in the workbook's fixed order. */
function columns(t: ReportTemplateConfig, key: string) {
  const s = t.sections.find((x) => x.key === key);
  const order = REPORT_SECTIONS.WEEKLY.find((x) => x.key === key)!.columns.map(([k]) => k);
  return order.map((k) => s?.columns.find((c) => c.key === k)).filter((c): c is { key: string; label: string; visible: boolean } => !!c && c.visible);
}

/**
 * D-085: weekly/monthly report built like the office workbook (Serangan) — sheets C.n, RM.n, M.n and Curva S M.n
 * with the workbook's fonts, colours, borders and number formats; titles and column labels come from the template.
 * ExcelJS cannot draw charts, so the time schedule carries the plan/actual rows without the line.
 */
export async function periodWorkbook(input: {
  template: ReportTemplateConfig;
  kind: 'WEEKLY' | 'MONTHLY';
  content: WeeklyReportContent;
  logos: Partial<Record<LogoKind, ExcelLogo>>;
}): Promise<Buffer> {
  const { template: t, content: c, kind } = input;
  const unit = kind === 'WEEKLY' ? 'MINGGU' : 'BULAN';
  const code = kind === 'WEEKLY' ? 'M' : 'B';
  const n = c.week.weekNumber;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LaporanProyek';
  const images = Object.fromEntries(
    Object.entries(input.logos).map(([k, l]) => [k, { id: wb.addImage({ buffer: l!.data as unknown as ExcelJS.Buffer, extension: l!.extension }), size: imageSize(l!.data) }]),
  ) as Partial<Record<LogoKind, { id: number; size: { width: number; height: number } | null }>>;
  /** Logo fitted into columns c1..c2 from row `top` over `rows` rows of 20 px, centred horizontally by offset. */
  const logo = (ws: ExcelJS.Worksheet, k: LogoKind, c1: number, c2: number, top: number, rows: number) => {
    const image = t.header.showLogos ? images[k] : undefined;
    if (!image) return;
    let boxW = 0;
    for (let col = c1; col <= c2; col++) boxW += (ws.getColumn(col).width ?? 8.43) * 7;
    const boxH = rows * 20;
    const scale = image.size ? Math.min(boxW / image.size.width, boxH / image.size.height) : 1;
    const width = image.size ? image.size.width * scale : boxW;
    const height = image.size ? image.size.height * scale : boxH;
    ws.addImage(image.id, { tl: { col: c1 - 1, row: top - 1 }, ext: { width, height } } as unknown as ExcelJS.ImageRange);
  };
  const identity = t.identity.filter((f) => f.visible);
  const period: [string, string][] = [
    [`${unit} KE   :`, numberWithWords(n)],
    ['DARI TANGGAL   :', upper(c.week.startDate)],
    ['SAMPAI DENGAN   :', upper(c.week.endDate)],
  ];
  /** Blue title bar over cA..cB (rows 3–4) and the identity/period block (rows 6–14); returns the next free row. */
  const head = (s: Sheet, title: string, cA: number, cB: number, valueCol: number, valueEnd: number, metaLabel: number) => {
    s.put(3, cA, title, { bold: true, size: 18, white: true, h: 'center', fill: COLOR.title }, cB, 4);
    s.frame(3, cA, 4, cB);
    identity.forEach((f, i) => {
      s.put(6 + i, cA, f.label, { bold: true }, valueCol - 1);
      s.put(6 + i, valueCol, `: ${identityText(c.project, f.key).toUpperCase()}`, { bold: true }, valueEnd);
    });
    period.forEach(([k, v], i) => {
      s.put(6 + i, metaLabel, k, { bold: true, h: 'right' });
      s.put(6 + i, metaLabel + 1, v, { bold: true }, cB);
    });
    return 6 + Math.max(identity.length, period.length) + 1;
  };
  /** Signature band; with four signers it uses the workbook's spans, otherwise equal spans. */
  const signatures = (s: Sheet, row: number, spans: [number, number][]) => {
    t.signatures.forEach((sg, i) => {
      const [a, b] = spans[i]!;
      s.put(row, a, sg.caption, { h: 'center' }, b);
      s.put(row + 1, a, sg.role, { bold: true, h: 'center', wrap: true }, b);
      s.put(row + 2, a, sg.organization, { h: 'center', wrap: true }, b);
      s.put(row + 8, a, sg.name || '(........................................)', { bold: true, underline: true, h: 'center' }, b);
      s.put(row + 9, a, sg.detail, { h: 'center' }, b);
    });
    return row + 10;
  };
  const evenSpans = (c1: number, c2: number): [number, number][] => {
    const count = Math.max(1, t.signatures.length);
    const span = (c2 - c1 + 1) / count;
    return t.signatures.map((_, i) => [c1 + Math.round(i * span), c1 + Math.round((i + 1) * span) - 1]);
  };
  const header = { bold: true, h: 'center' as const, wrap: true, fill: COLOR.head };
  const sections = t.sections.filter((s) => s.visible && ['cover', 'recap', 'items', 'curve'].includes(s.key));
  let chart: { sheet: string; anchor: Parameters<typeof addLineChart>[2]; lines: ChartLine[] } | null = null;

  for (const sec of sections) {
    if (sec.key === 'cover') {
      // C.n: portrait cover, content in C..N as in the workbook.
      const s = sheet(wb, `C.${n}`, t, [2, 1.8, 10.8, 10.8, 10.8, 10.8, 10.8, 4.8, 4.8, 10.8, 10.8, 10.8, 10.8, 10.8, 1.8]);
      logo(s.ws, 'AGENCY', 3, 5, 3, 8);
      const sizes = [16, 22, 11, 11, 11, 11];
      let r = 4;
      t.header.lines.forEach((line, i) => {
        const rows = i === 1 ? 3 : 0;
        s.put(r, 6, line, { bold: true, size: sizes[i], h: 'center', wrap: true }, 14, r + rows);
        r += rows + 1;
      });
      for (let col = 3; col <= 14; col++) s.ws.getCell(11, col).border = { bottom: { style: 'double' } };
      s.put(14, 3, sec.title, { bold: true, size: 36, white: true, h: 'center', fill: COLOR.title }, 14, 16);
      s.put(17, 3, `${unit} KE   :   ${numberWithWords(n)}`, { bold: true, size: 24, white: true, h: 'center', fill: COLOR.title }, 14, 19);
      s.put(20, 3, null, { fill: COLOR.title }, 14);
      s.put(21, 3, 'PERIODE', { bold: true, size: 22, white: true, underline: true, h: 'center', fill: COLOR.title }, 14);
      s.put(22, 3, null, { fill: COLOR.title }, 14);
      s.put(23, 3, upper(c.week.startDate), { bold: true, size: 20, white: true, h: 'center', fill: COLOR.title }, 7);
      s.put(23, 8, 'S.D', { bold: true, size: 20, white: true, h: 'center', fill: COLOR.title }, 9);
      s.put(23, 10, upper(c.week.endDate), { bold: true, size: 20, white: true, h: 'center', fill: COLOR.title }, 14);
      s.put(24, 3, null, { fill: COLOR.title }, 14);
      for (const row of [20, 21, 22, 23, 24]) s.ws.getRow(row).height = 25;
      s.frame(14, 3, 24, 14);
      r = 26;
      for (const f of identity.filter((x) => !['contractor', 'consultant', 'subActivityName'].includes(x.key))) {
        const v = identityText(c.project, f.key).toUpperCase();
        if (f.key === 'location' || f.key === 'fiscalYear') s.put(r++, 3, `${f.label} : ${v}`, { bold: true, size: 16, h: 'center' }, 14);
        else {
          s.put(r++, 3, f.label, { bold: true, size: 16, h: 'center' }, 14);
          s.put(r++, 3, v, { bold: true, size: 16, h: 'center', wrap: true }, 14);
        }
        s.ws.getRow(r - 1).height = 25;
        r++;
      }
      for (let row = 26; row < r; row++) s.ws.getRow(row).height = Math.max(s.ws.getRow(row).height ?? 0, 25);
      s.frame(25, 3, r - 1, 14);
      const top = r + 1;
      s.put(top, 3, t.header.logoCaptions.CONSULTANT || 'KONSULTAN PENGAWAS', { bold: true, size: 18, white: true, h: 'center', fill: COLOR.title }, 8, top + 1);
      s.put(top, 9, t.header.logoCaptions.CONTRACTOR || 'KONTRAKTOR PELAKSANA', { bold: true, size: 18, white: true, h: 'center', fill: COLOR.title }, 14, top + 1);
      logo(s.ws, 'CONSULTANT', 3, 8, top + 2, 6);
      logo(s.ws, 'CONTRACTOR', 9, 14, top + 2, 6);
      s.frame(top, 3, top + 8, 8);
      s.frame(top, 9, top + 8, 14);
      s.setup(15, top + 9, 'portrait', 1);
      continue;
    }

    if (sec.key === 'recap') {
      // RM.n: C NO | D:F PEKERJAAN | G BOBOT | H..J PRESTASI | K:L KETERANGAN (workbook widths).
      const s = sheet(wb, `R${code}.${n}`, t, [2, 1.8, 8.1, 15.9, 45.8, 30.4, 22.7, 22.7, 22.7, 22.7, 13.4, 12.6, 1.8]);
      const cols = columns(t, 'recap');
      const label = (k: string) => cols.find((x) => x.key === k)?.label ?? '';
      const h1 = head(s, sec.title, 3, 12, 5, 9, 10) + 1;
      s.put(h1, 3, label('no') || 'NO', header, 3, h1 + 3);
      s.put(h1, 4, label('name') || 'PEKERJAAN', header, 6, h1 + 3);
      s.put(h1, 7, `RAB ${c.baseline?.label ?? ''}`, header, 7, h1 + 1);
      s.put(h1 + 2, 7, label('weight') || 'BOBOT (%)', header, 7, h1 + 3);
      s.put(h1, 8, 'PRESTASI PEKERJAAN (%)', header, 10);
      (['previous', 'thisPeriod', 'cumulative'] as const).forEach((k, i) => s.put(h1 + 1, 8 + i, label(k), header, 8 + i, h1 + 3));
      s.put(h1, 11, label('note') || 'KETERANGAN', header, 12, h1 + 3);
      s.grid(h1, 3, h1 + 3, 12);
      s.rule(h1, 3, 12, 'medium');
      let r = h1 + 5;
      const first = r - 1;
      for (const row of c.recap) {
        const heading = row.weight === null;
        s.put(r, 3, row.displayNumber, { bold: true, h: 'center' });
        s.put(r, 4, row.description, { bold: heading }, 6);
        if (!heading)
          ([row.weight, row.previous, row.thisWeek, row.cumulative] as const).forEach((v, i) => s.put(r, 7 + i, value(v, W), { h: 'center', numFmt: acc(W) }));
        s.put(r, 11, null, {}, 12);
        r++;
      }
      s.grid(first, 3, r - 1, 12);
      const sum = (pick: (x: WeeklyReportContent['recap'][number]) => string | null) => c.recap.reduce((a, x) => a.plus(pick(x) ?? 0), new Decimal(0)).toFixed();
      s.put(r, 3, null, { fill: COLOR.group });
      s.put(r, 4, 'JUMLAH', { bold: true, fill: COLOR.group }, 6);
      [sum((x) => x.weight), sum((x) => x.previous), sum((x) => x.thisWeek), sum((x) => x.cumulative)].forEach((v, i) => s.put(r, 7 + i, value(v, W), { bold: true, h: 'center', numFmt: acc(W), fill: COLOR.group }));
      s.put(r, 11, null, { fill: COLOR.group }, 12);
      s.ws.getRow(r).height = 24;
      s.grid(r, 3, r, 12);
      s.rule(r, 3, 12, 'double', 'medium');
      // Columns the template hides stay in the grid but are hidden, like hidden workbook columns.
      const at: Record<string, number[]> = { no: [3], name: [4, 5, 6], weight: [7], previous: [8], thisPeriod: [9], cumulative: [10], note: [11, 12] };
      for (const [k, list] of Object.entries(at)) if (!cols.some((x) => x.key === k)) for (const col of list) s.ws.getColumn(col).hidden = true;
      r += 2;
      const tot = c.totals;
      const lines: [string, string | number | null, string][] = [
        ['REALISASI PROGRES :', value(tot.actualCumulative, W), '%'],
        ['RENCANA PROGRES :', value(tot.plannedCumulative, W), '%'],
        ['DEVIASI :', value(tot.deviation, W), '%'],
        ['TOTAL WAKTU PELAKSANAAN :', tot.durationDays, 'hari'],
        ['TOTAL WAKTU TERPAKAI :', tot.usedDays, 'hari'],
        ['TOTAL SISA WAKTU PELAKSANAAN :', tot.remainingDays, 'hari'],
      ];
      lines.forEach(([k, v, u], i) => {
        s.put(r + i, 10, k, { bold: true, h: 'right' });
        s.put(r + i, 11, v, { bold: true, h: 'right', numFmt: u === '%' ? acc(W) : '0' });
        s.put(r + i, 12, u, { bold: true });
      });
      r += lines.length + 2;
      const spans: [number, number][] = t.signatures.length === 4 ? [[3, 5], [6, 7], [8, 9], [10, 12]] : evenSpans(3, 12);
      r = signatures(s, r, spans);
      s.frame(3, 3, r, 12);
      s.setup(13, r + 1, 'landscape', 1);
      continue;
    }

    if (sec.key === 'items') {
      // M.n: C NO | D:E JENIS PEKERJAAN | F SAT | G VOLUME | H BOBOT | I..K VOLUME PEKERJAAN | L..M KEMAJUAN | N KET.
      const s = sheet(wb, `${code}.${n}`, t, [2, 1.8, 8, 23.3, 37.1, 8.7, 17.7, 17.7, 17.7, 17.7, 17.7, 17.7, 17.7, 14.3, 1.8]);
      const cols = columns(t, 'items');
      const label = (k: string) => cols.find((x) => x.key === k)?.label ?? '';
      const h1 = head(s, sec.title, 3, 14, 5, 10, 12) + 1;
      s.put(h1, 3, label('no'), header, 3, h1 + 3);
      s.put(h1, 4, label('name'), header, 5, h1 + 3);
      s.put(h1, 6, label('unit'), header, 6, h1 + 3);
      s.put(h1, 7, `RAB ${c.baseline?.label ?? ''}`, header, 8);
      s.put(h1 + 1, 7, label('volume'), header, 7, h1 + 3);
      s.put(h1 + 1, 8, label('weight'), header, 8, h1 + 3);
      s.put(h1, 9, 'VOLUME PEKERJAAN', header, 11);
      s.put(h1 + 1, 9, label('previous'), header, 9, h1 + 3);
      s.put(h1 + 1, 10, label('thisPeriod'), header, 10, h1 + 3);
      s.put(h1 + 1, 11, label('cumulative'), header, 11, h1 + 3);
      s.put(h1, 12, 'KEMAJUAN (%)', header, 13);
      s.put(h1 + 1, 12, label('percent'), header, 12, h1 + 3);
      s.put(h1 + 1, 13, label('share'), header, 13, h1 + 3);
      s.put(h1, 14, label('note') || 'KETERANGAN', header, 14, h1 + 3);
      s.grid(h1, 3, h1 + 3, 14);
      s.rule(h1, 3, 14, 'medium');
      let r = h1 + 5;
      const first = r - 1;
      const dp = t.decimals;
      const { lines, weight, share } = officeItemLines(c);
      const totals: number[] = [];
      for (const l of lines) {
        if (l.kind === 'heading') {
          s.put(r, 3, l.no, { bold: true, h: 'center' });
          s.put(r, 4, l.name, { bold: true }, 5);
        } else if (l.kind === 'total') {
          s.paint(r, 3, 14, COLOR.group);
          s.put(r, 4, l.name, { bold: true, h: 'center', fill: COLOR.group }, 5);
          s.put(r, 8, value(l.weight, W), { bold: true, h: 'right', numFmt: acc(W), fill: COLOR.group });
          s.put(r, 13, value(l.share, W), { bold: true, h: 'right', numFmt: acc(W), fill: COLOR.group });
          totals.push(r);
        } else {
          s.put(r, 3, l.no, { h: 'center' });
          s.put(r, 4, l.name, { wrap: l.name.length > 70 }, 5);
          s.put(r, 6, l.unit, { h: 'center' });
          s.put(r, 7, value(l.volume, dp), { h: 'center', numFmt: acc(dp) });
          s.put(r, 8, value(l.weight, W), { h: 'right', numFmt: acc(W) });
          s.put(r, 9, value(l.previous, dp), { h: 'right', numFmt: acc(dp) });
          s.put(r, 10, value(l.thisPeriod, dp), { h: 'right', numFmt: acc(dp) });
          s.put(r, 11, value(l.cumulative, dp), { h: 'right', numFmt: acc(dp) });
          s.put(r, 12, value(l.percent, 2), { h: 'center', numFmt: acc(2) });
          s.put(r, 13, value(l.share, W), { h: 'right', numFmt: acc(W) });
          if (l.name.length > 70) s.ws.getRow(r).height = 28;
        }
        r++;
      }
      s.grid(first, 3, r - 1, 14);
      for (const row of totals) s.rule(row, 3, 14, 'medium', 'medium');
      s.paint(r, 3, 14, COLOR.total);
      s.put(r, 4, 'JUMLAH TOTAL', { bold: true, fill: COLOR.total }, 5);
      s.put(r, 8, value(weight, W), { bold: true, h: 'right', numFmt: acc(W), fill: COLOR.total });
      s.put(r, 13, value(share, W), { bold: true, h: 'right', numFmt: acc(W), fill: COLOR.total });
      s.ws.getRow(r).height = 20.4;
      s.grid(r, 3, r, 14);
      s.rule(r, 3, 14, 'medium', 'medium');
      const keyCol: Record<string, number[]> = { no: [3], name: [4, 5], unit: [6], volume: [7], weight: [8], previous: [9], thisPeriod: [10], cumulative: [11], percent: [12], share: [13], note: [14] };
      for (const [k, list] of Object.entries(keyCol)) if (!cols.some((x) => x.key === k)) for (const col of list) s.ws.getColumn(col).hidden = true;
      r += 2;
      const tot = c.totals;
      ([
        ['REALISASI KEMAJUAN PEKERJAAN    :', tot.actualCumulative],
        ['RENCANA KEMAJUAN PEKERJAAN    :', tot.plannedCumulative],
        ['DEVIASI    :', tot.deviation],
      ] as const).forEach(([k, v], i) => {
        s.put(r + i, 10, k, { bold: true, h: 'right' }, 12);
        s.put(r + i, 13, value(v, W), { bold: true, h: 'right', numFmt: acc(W) });
        s.put(r + i, 14, '%', { bold: true });
      });
      r += 3;
      s.frame(3, 3, r, 14);
      s.setup(15, r + 1, 'landscape', 0);
      s.ws.pageSetup.printTitlesRow = `${h1}:${h1 + 3}`;
      continue;
    }

    // Curva S: C NO | D PEKERJAAN | E BOBOT | one column per week | KETERANGAN.
    const weeks = c.curve.weeks;
    const s = sheet(wb, `Curva S ${code}.${n}`, t, [2, 1.8, 7, 46, 10.8, ...weeks.map(() => 10.8), 16, 1.8]);
    const first = 6;
    const ket = first + weeks.length;
    const h1 = head(s, sec.title, 3, ket, 5, Math.min(ket - 4, first + 8), ket - 1) + 1;
    s.put(h1, 3, 'NO', { ...header, fill: 'FFD9D9D9' }, 3, h1 + 4);
    s.put(h1, 4, 'PEKERJAAN', { ...header, fill: 'FFD9D9D9' }, 4, h1 + 4);
    s.put(h1, 5, 'BOBOT', { ...header, fill: 'FFD9D9D9' }, 5, h1 + 4);
    for (let m = 0; m * 4 < weeks.length; m++)
      s.put(h1, first + m * 4, `BULAN ${roman(m + 1)}`, { ...header, fill: COLOR.total }, first + Math.min(weeks.length, m * 4 + 4) - 1);
    weeks.forEach((w, i) => {
      const now = w.weekNumber === n && kind === 'WEEKLY';
      const f = now ? COLOR.now : COLOR.week;
      s.put(h1 + 1, first + i, `M.${w.weekNumber}`, { ...header, fill: f });
      s.put(h1 + 2, first + i, serial(w.startDate), { h: 'center', fill: f, numFmt: 'd-mmm' });
      s.put(h1 + 3, first + i, 'S.D', { h: 'center', fill: f });
      s.put(h1 + 4, first + i, serial(w.endDate), { h: 'center', fill: f, numFmt: 'd-mmm' });
    });
    s.put(h1, ket, 'KETERANGAN', { ...header, fill: 'FFD9D9D9' }, ket, h1 + 4);
    s.grid(h1, 3, h1 + 4, ket);
    s.rule(h1, 3, ket, 'medium');
    let r = h1 + 5;
    for (const row of c.curve.rows) {
      const heading = row.weight === null;
      s.put(r, 3, row.displayNumber, { bold: true, h: 'center' });
      s.put(r, 4, row.description, { bold: heading });
      if (!heading) s.put(r, 5, value(row.weight, W), { numFmt: acc(W) });
      row.planned.forEach((p, i) => {
        if (p !== null && Number(p) > 0) s.put(r, first + i, value(p, W), { numFmt: acc(W) });
      });
      s.ws.getRow(r).height = 19.95;
      r++;
    }
    s.grid(h1 + 5, 3, r - 1, ket);
    const foot: [string, (w: (typeof weeks)[number]) => string | null, string][] = [
      ['RENCANA PROGRES', (w) => w.planned, COLOR.plan],
      ['RENCANA KUMULATIF', (w) => w.plannedCumulative, COLOR.plan],
      ['REALISASI PROGRES', (w) => w.actual, COLOR.total],
      ['REALISASI KUMULATIF', (w) => w.actualCumulative, COLOR.total],
      ['DEVIASI', (w) => w.deviation, COLOR.group],
    ];
    foot.forEach(([k, pick, color], i) => {
      s.put(r + i, 3, null, { fill: color });
      s.put(r + i, 4, k, { bold: true, fill: color });
      // Kumulatif rows start at 0 in the BOBOT column, as in the workbook: the curve's first point.
      const start = i === 0 ? value(c.curve.rows.reduce((a, x) => a.plus(x.weight ?? 0), new Decimal(0)).toFixed(), W) : i === 1 || i === 3 ? 0 : null;
      s.put(r + i, 5, start, { bold: true, numFmt: acc(W), fill: color });
      weeks.forEach((w, j) => s.put(r + i, first + j, value(pick(w), W), { bold: true, numFmt: acc(W), fill: color }));
      s.put(r + i, ket, null, { fill: color });
      s.ws.getRow(r + i).height = 19.95;
    });
    s.grid(r, 3, r + foot.length - 1, ket);
    s.rule(r, 3, ket, 'double');
    const sheetRef = (row: number) => `'${s.ws.name}'!$E$${row}:$${s.ws.getColumn(ket - 1).letter}$${row}`;
    const series = (pick: (w: (typeof weeks)[number]) => string | null) => [0, ...weeks.map((w) => value(pick(w), W))];
    chart = {
      sheet: s.ws.name,
      anchor: { fromCol: first, fromRow: h1 + 5, toCol: ket - 1, toRow: r - 1 },
      lines: [
        { name: 'Rencana kumulatif', ref: sheetRef(r + 1), values: series((w) => w.plannedCumulative), color: 'D97706', dash: true, width: 1.75 },
        { name: 'Realisasi kumulatif', ref: sheetRef(r + 3), values: series((w) => w.actualCumulative), color: '1D4ED8', width: 2.25 },
      ],
    };
    r += foot.length;
    s.put(r, 4, 'Kurva S: garis putus oranye = rencana kumulatif, garis biru = realisasi kumulatif', { size: 9 });
    r += 1;
    r = signatures(s, r, evenSpans(3, ket));
    s.frame(3, 3, r, ket);
    s.setup(ket + 1, r + 1, 'landscape', 1);
  }

  if (!wb.worksheets.length) wb.addWorksheet('Kosong');
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  return chart ? addLineChart(out, chart.sheet, chart.anchor, chart.lines) : out;
}
