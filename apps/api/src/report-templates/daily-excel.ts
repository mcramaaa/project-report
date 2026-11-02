import { Decimal } from '@laporan-proyek/calc';
import {
  dailyWeatherRows,
  dayNameId,
  groupLabor,
  identityText,
  longDateId,
  WEATHER_LABELS,
  type DailyReportDto,
  type LogoKind,
  type ReportIdentity,
  type ReportTemplateConfig,
} from '@laporan-proyek/shared';
import ExcelJS from 'exceljs';

/** A logo ExcelJS can embed (it has no WEBP support; those are left out). */
export type ExcelLogo = { data: Buffer; extension: 'png' | 'jpeg' };
type Row = { name: string; qty: string | null; unit: string | null };

const THIN: Partial<ExcelJS.Borders> = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
const FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E9F0' } };
const PAPER: Record<ReportTemplateConfig['page']['size'], number> = { A4: 9, F4: 9, LEGAL: 5 };

/** Pixel size of a PNG or JPEG, read from its header, so a logo keeps its proportions in Excel. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

const fmt = (dp: number) => (dp > 0 ? `#,##0.${'0'.repeat(dp)}` : '#,##0');
const value = (qty: string | null, dp: number) => (qty === null ? null : Number(new Decimal(qty).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed()));

/**
 * D-084: the daily report as an office workbook, laid out by the same template as the print page.
 * `columns` mirrors sheet Har.n of the Mengwi workbook; `stacked` puts the sections under each other.
 */
export async function dailyWorkbook(input: {
  template: ReportTemplateConfig;
  identity: ReportIdentity;
  report: DailyReportDto;
  logos: Partial<Record<LogoKind, ExcelLogo>>;
}): Promise<Buffer> {
  const { template: t, report } = input;
  const lines = (category: 'LABOR' | 'MATERIAL' | 'EQUIPMENT'): Row[] =>
    report.resources.filter((x) => x.category === category && x.actual && Number(x.actual) > 0).map((x) => ({ name: x.name, qty: x.actual!, unit: x.unit }));
  const data: Record<string, Row[]> = {
    labor: lines('LABOR'),
    equipment: lines('EQUIPMENT'),
    materials: lines('MATERIAL'),
    work: report.work.map((w) => ({ name: w.description, qty: w.volume, unit: w.unit })),
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'LaporanProyek';
  const ws = wb.addWorksheet(`Harian ${report.date}`, { views: [{ showGridLines: false }] });
  ws.properties.defaultRowHeight = 16;
  const font = { name: 'Arial', size: Math.max(8, t.page.fontSizePt + 1) };
  const put = (r: number, c: number, v: ExcelJS.CellValue, style: Partial<ExcelJS.Style> = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = { ...font, ...style.font };
    // Text sits in the vertical middle of its row, as in the office workbook.
    cell.alignment = { vertical: 'middle', ...style.alignment };
    if (style.border) cell.border = style.border;
    if (style.fill) cell.fill = style.fill;
    if (style.numFmt) cell.numFmt = style.numFmt;
    return cell;
  };
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
  };
  const box = (r1: number, c1: number, r2: number, c2: number) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = THIN;
  };
  const images = Object.fromEntries(
    Object.entries(input.logos).map(([k, l]) => [k, { id: wb.addImage({ buffer: l!.data as unknown as ExcelJS.Buffer, extension: l!.extension }), size: imageSize(l!.data) }]),
  ) as Partial<Record<LogoKind, { id: number; size: { width: number; height: number } | null }>>;
  /** Fits a logo into columns c1..c2 and `rows` rows from 0-based row `top`, centred, without stretching. */
  const placeLogo = (k: LogoKind, c1: number, c2: number, top: number, rows: number) => {
    const image = images[k];
    if (!image) return;
    let boxW = 0;
    for (let c = c1; c <= c2; c++) boxW += (ws.getColumn(c).width ?? 8.43) * 7;
    const boxH = rows * 20;
    const scale = image.size ? Math.min(boxW / image.size.width, boxH / image.size.height) : 1;
    const width = image.size ? image.size.width * scale : boxW;
    const height = image.size ? image.size.height * scale : boxH;
    // Left-aligned in its box: fractional column offsets render differently across Excel versions.
    ws.addImage(image.id, { tl: { col: c1 - 1, row: top }, ext: { width, height } } as unknown as ExcelJS.ImageRange);
  };
  const shownLogos = (['AGENCY', 'CONSULTANT', 'CONTRACTOR'] as const).filter((k) => t.header.showLogos && t.header.logoCaptions[k].trim());
  const dp = t.decimals;

  let row = 2;
  let lastCol: number;
  if (t.layout === 'columns') lastCol = columnsLayout();
  else lastCol = stackedLayout();

  // Signatures across the page, one band per signer.
  if (t.signatures.length) {
    row += 2;
    const span = Math.max(1, Math.floor((lastCol - 1) / t.signatures.length));
    t.signatures.forEach((s, i) => {
      const c1 = 2 + i * span;
      const c2 = i === t.signatures.length - 1 ? lastCol : c1 + span - 1;
      const center = { alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true } };
      [s.caption, s.role, s.organization].forEach((text, k) => {
        merge(row + k, c1, row + k, c2);
        put(row + k, c1, text, { ...center, font: k === 1 ? { bold: true } : {} });
      });
      merge(row + 6, c1, row + 6, c2);
      put(row + 6, c1, s.name || '(........................................)', { ...center, font: { bold: true, underline: true } });
      merge(row + 7, c1, row + 7, c2);
      put(row + 7, c1, s.detail, center);
    });
    row += 8;
  }

  ws.pageSetup = {
    paperSize: PAPER[t.page.size],
    orientation: t.page.orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: t.page.marginMm / 25.4, right: t.page.marginMm / 25.4, top: t.page.marginMm / 25.4, bottom: t.page.marginMm / 25.4, header: 0.2, footer: 0.2 },
    printArea: `A1:${ws.getColumn(lastCol).letter}${row}`,
  };
  return Buffer.from(await wb.xlsx.writeBuffer());

  /** Four tables side by side; the last block carries the title and the date block above it. */
  function columnsLayout(): number {
    const tables = t.sections.filter((s) => s.visible && s.key in data);
    ws.getColumn(1).width = 2;
    let col = 2;
    const blocks = tables.map((s, i) => {
      const cols = s.columns.filter((c) => c.visible);
      const last = i === tables.length - 1;
      const start = col;
      const map: Record<string, number> = {};
      for (const c of cols) {
        map[c.key] = col;
        ws.getColumn(col).width = c.key === 'no' ? 5 : c.key === 'name' ? Math.max(10, Math.round((s.width ?? 70) * 0.42) - (last ? 28 : 0)) : c.key === 'qty' ? 11 : 7;
        col++;
        // The last table is wider: two spare columns after its name hold the title block in the header.
        if (last && c.key === 'name') {
          map.nameEnd = col + 1;
          ws.getColumn(col).width = 14;
          ws.getColumn(col + 1).width = 14;
          col += 2;
        }
      }
      map.nameEnd ??= map.name ?? start;
      return { s, cols, start, end: col - 1, map };
    });
    const end = col - 1;

    // Header: identity | logos | title + week/day/date.
    const lastBlock = blocks.at(-1)!;
    const titleStart = lastBlock.map.name !== undefined ? lastBlock.map.name + 1 : lastBlock.start;
    const regions: { c1: number; c2: number }[] = [];
    if (lastBlock.map.name !== undefined) regions.unshift({ c1: lastBlock.start, c2: lastBlock.map.name });
    for (let b = blocks.length - 2; b >= 0 && regions.length < shownLogos.length; b--) regions.unshift({ c1: blocks[b]!.start, c2: blocks[b]!.end });
    const logoRegions = regions.slice(-shownLogos.length || regions.length);
    const identityEnd = shownLogos.length && logoRegions[0] ? logoRegions[0].c1 - 1 : titleStart - 1;
    for (const line of t.header.lines) {
      merge(row, 2, row, end);
      put(row, 2, line, { font: { bold: true, size: font.size + 2 }, alignment: { horizontal: 'center' } });
      row++;
    }
    const top = row;
    shownLogos.forEach((k, i) => {
      const r = logoRegions[i];
      if (!r) return;
      merge(top, r.c1, top, r.c2);
      put(top, r.c1, t.header.logoCaptions[k], { font: { bold: true }, alignment: { horizontal: 'center' } });
      placeLogo(k, r.c1, r.c2, top + 1, Math.max(2, Math.round(t.daily.logoHeightMm / 5.6)));
    });
    merge(top, titleStart, top + 1, end);
    put(top, titleStart, t.title, { font: { bold: true, size: font.size + 7 }, alignment: { horizontal: 'center', vertical: 'middle' } });
    [
      [t.daily.weekLabel, String(report.week.weekNumber)],
      [t.daily.dayLabel, dayNameId(report.date)],
      [t.daily.dateLabel, longDateId(report.date)],
    ].forEach(([label, v], i) => {
      put(top + 3 + i, titleStart, label, { font: { bold: true } });
      merge(top + 3 + i, titleStart + 1, top + 3 + i, end);
      put(top + 3 + i, titleStart + 1, `: ${v}`);
    });
    const identity = t.identity.filter((f) => f.visible);
    const labelEnd = Math.min(blocks[0]!.map.name ?? 2, identityEnd);
    identity.forEach((f, i) => {
      merge(top + i, 2, top + i, labelEnd);
      put(top + i, 2, f.label, { font: { bold: true } });
      if (identityEnd > labelEnd) {
        merge(top + i, labelEnd + 1, top + i, identityEnd);
        put(top + i, labelEnd + 1, `: ${identityText(input.identity, f.key)}`, { alignment: { wrapText: false } });
      }
    });
    row = top + Math.max(identity.length, 6) + 1;

    // Tables, padded to one height like the workbook.
    const labor = groupLabor(t, data.labor!);
    const laborLines = labor.reduce((n, g) => n + g.rows.length + (g.title ? 1 : 0), 0);
    const height = Math.max(t.daily.minRows, ...blocks.map((b) => (b.s.key === 'labor' ? laborLines : data[b.s.key]!.length)));
    const head = row;
    for (const b of blocks) {
      merge(head, b.start, head, b.end);
      put(head, b.start, b.s.title, { font: { bold: true }, alignment: { horizontal: 'center' }, fill: FILL });
      for (const c of b.cols) {
        const c1 = b.map[c.key]!;
        const c2 = c.key === 'name' ? b.map.nameEnd! : c1;
        merge(head + 1, c1, head + 1, c2);
        put(head + 1, c1, c.label, { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, fill: FILL });
      }
      const write = (r: number, item: Row, n: number, qtyDp: number) => {
        // Excel does not grow merged/wrapped rows on open: size the row for the longest name in it.
        if (b.map.name !== undefined) {
          let width = 0;
          for (let c = b.map.name; c <= b.map.nameEnd!; c++) width += ws.getColumn(c).width ?? 8.43;
          // A width unit holds about 1.3 characters at this font size; 11 pt per wrapped line.
          const lines = Math.ceil(item.name.length / Math.max(8, width * 1.3));
          ws.getRow(r).height = Math.max(ws.getRow(r).height ?? 16, 16, lines * 11 + 4);
        }
        for (const c of b.cols) {
          const c1 = b.map[c.key]!;
          if (c.key === 'name') merge(r, c1, r, b.map.nameEnd!);
          if (c.key === 'no') put(r, c1, n, { alignment: { horizontal: 'center', vertical: 'middle' } });
          if (c.key === 'name') put(r, c1, item.name, { alignment: { wrapText: true, vertical: 'middle' } });
          if (c.key === 'qty') put(r, c1, value(item.qty, qtyDp), { numFmt: fmt(qtyDp), alignment: { vertical: 'middle' } });
          if (c.key === 'unit') put(r, c1, item.unit ?? '', { alignment: { horizontal: 'center', vertical: 'middle' } });
        }
      };
      let r = head + 2;
      if (b.s.key === 'labor') {
        for (const g of labor) {
          if (g.title) {
            const nameCol = b.map.name ?? b.start;
            merge(r, nameCol, r, b.map.nameEnd!);
            put(r, nameCol, g.title, { font: { bold: true }, alignment: { vertical: 'middle' } });
            r++;
          }
          g.rows.forEach((item, i) => write(r++, item, i + 1, 0));
        }
        const total = head + 2 + height;
        if (b.map.name !== undefined) {
          merge(total, b.map.name, total, b.map.nameEnd!);
          put(total, b.map.name, t.daily.totalLabel, { font: { bold: true }, alignment: { horizontal: 'center' } });
        }
        if (b.map.qty !== undefined)
          put(total, b.map.qty, value(data.labor!.reduce((sum, x) => sum.plus(x.qty ?? 0), new Decimal(0)).toFixed(), 0), { font: { bold: true }, numFmt: fmt(0) });
        if (b.map.unit !== undefined) put(total, b.map.unit, t.daily.totalUnit, { font: { bold: true }, alignment: { horizontal: 'center' } });
      } else data[b.s.key]!.forEach((item, i) => write(r++, item, i + 1, dp));
      box(head, b.start, head + 2 + height, b.end);
    }
    row = head + 3 + height + 1;

    // Weather (left) and note (right).
    const weather = t.sections.find((s) => s.key === 'weather' && s.visible);
    const note = t.sections.find((s) => s.key === 'note' && s.visible);
    const split = blocks.length > 1 ? blocks[1]!.end : end;
    if (weather) {
      const c = blocks[0]!.start;
      merge(row, c, row + 2, c + 1);
      put(row, c, weather.title, { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, fill: FILL });
      dailyWeatherRows(t, report.weather).forEach((w, i) => {
        merge(row + i, c + 2, row + i, Math.min(c + 3, split));
        put(row + i, c + 2, w.label, { font: { bold: true } });
        if (split > c + 3) {
          merge(row + i, c + 4, row + i, split);
          put(row + i, c + 4, w.hours);
        }
      });
      box(row, c, row + 2, split);
    }
    if (note) {
      const c1 = weather ? split + 1 : 2;
      merge(row, c1, row, end);
      put(row, c1, note.title, { font: { bold: true }, fill: FILL });
      merge(row + 1, c1, row + 2, end);
      put(row + 1, c1, report.note ?? '', { alignment: { wrapText: true, vertical: 'middle' } });
      box(row, c1, row + 2, end);
    }
    row += 3;
    return end;
  }

  /** One column of sections under each other (the older office format). */
  function stackedLayout(): number {
    const widths = [2, 5, 54, 12, 8];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const end = 5;
    const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
    if (shownLogos.length) {
      shownLogos.forEach((k, i) => {
        const c = 2 + i;
        placeLogo(k, c, c, row - 1, 3);
        put(row + 3, c, t.header.logoCaptions[k], { font: { bold: true }, alignment: center });
      });
      row += 5;
    }
    for (const line of t.header.lines) {
      merge(row, 2, row, end);
      put(row, 2, line, { font: { bold: true }, alignment: center });
      row++;
    }
    merge(row, 2, row, end);
    put(row, 2, t.title, { font: { bold: true, size: font.size + 4, underline: true }, alignment: center });
    row += 2;
    const meta: [string, string][] = [
      ...t.identity.filter((f) => f.visible).map((f) => [f.label, identityText(input.identity, f.key)] as [string, string]),
      ['MINGGU KE', String(report.week.weekNumber)],
      ['TANGGAL', longDateId(report.date)],
      ['HARI', dayNameId(report.date)],
    ];
    for (const [label, v] of meta) {
      put(row, 2, label, { font: { bold: true } });
      merge(row, 3, row, end);
      put(row, 3, `: ${v}`);
      row++;
    }
    for (const s of t.sections.filter((x) => x.visible)) {
      row++;
      put(row, 2, s.title, { font: { bold: true } });
      row++;
      if (s.key in data) {
        const cols = s.columns.filter((c) => c.visible);
        cols.forEach((c, i) => put(row, 2 + i, c.label, { font: { bold: true }, alignment: center, fill: FILL }));
        const start = row;
        const items = data[s.key]!;
        items.forEach((item, i) => {
          row++;
          cols.forEach((c, j) => {
            const qtyDp = s.key === 'labor' ? 0 : dp;
            if (c.key === 'no') put(row, 2 + j, i + 1, { alignment: { horizontal: 'center' } });
            if (c.key === 'name') put(row, 2 + j, item.name, { alignment: { wrapText: true } });
            if (c.key === 'qty') put(row, 2 + j, value(item.qty, qtyDp), { numFmt: fmt(qtyDp) });
            if (c.key === 'unit') put(row, 2 + j, item.unit ?? '');
          });
        });
        box(start, 2, row, 1 + cols.length);
      } else if (s.key === 'weather') {
        for (const w of report.weather) {
          row++;
          put(row, 2, WEATHER_LABELS[w.condition].toUpperCase());
          merge(row, 3, row, end);
          put(row, 3, [w.fromTime && `${w.fromTime} s.d ${w.toTime ?? ''}`, w.note].filter(Boolean).join(' · '));
        }
      } else if (s.key === 'note') {
        row++;
        merge(row, 2, row + 1, end);
        put(row, 2, report.note ?? '', { alignment: { wrapText: true, vertical: 'middle' } });
        row++;
      }
    }
    return end;
  }
}
