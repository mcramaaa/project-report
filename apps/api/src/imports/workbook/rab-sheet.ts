import { Decimal } from '@laporan-proyek/calc';
import type { RabRowType, RabVersionType } from '@laporan-proyek/shared';
import { excelDecimal, type WorkbookModel } from './workbook-model';

/**
 * Reads the RAB/recap sheet of a workbook: header row with VOLUME and NO. ANALISA, optional side-by-side
 * blocks (KONTRAK | MC - 0 | ADDENDUM n) chosen by the target version, and the row hierarchy
 * (D-044 mapping; item rows keep their recap name, D-047).
 */

export interface RabColumns {
  headerRow: number;
  no: number;
  description: number;
  analysis: number | null;
  volume: number;
  unit: number;
  price: number;
  tax: number | null;
  /** HARGA SAT + PPN and SUB JUMLAH of the block: cached values for reconciliation only. */
  priceWithTax: number | null;
  amount: number | null;
  block: string | null;
}

export interface RabSheetRow {
  row: number;
  rowType: RabRowType;
  parentRow: number | null;
  displayNumber: string | null;
  description: string;
  volume: string | null;
  unit: string | null;
  analysisCode: string | null;
  taxPercent: string | null;
  sourceUnitPrice: string | null;
  /** Cached floats of price + PPN and amount as 17-digit strings (D-054 reconciliation); never app values. */
  workbook: { unitPriceWithTax: string | null; subtotal: string | null };
  priceCell: { sheet: string; row: number; col: number };
}

export interface RabSheet {
  sheet: string;
  columns: RabColumns;
  rows: RabSheetRow[];
  /** "JUMLAH TOTAL"/"JUMLAH" and "DIBULATKAN" of the chosen block, when present. */
  totals: { value: string; rounded: string | null; valueRaw: string | null } | null;
}

export class RabSheetError extends Error {}

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

/** Sheets with a RAB header (VOLUME + NO. ANALISA) in the first 40 rows. */
export function rabSheetCandidates(model: WorkbookModel): string[] {
  return model.sheetNames().filter((s) => findHeaderRow(model, s) !== null);
}

function findHeaderRow(model: WorkbookModel, sheet: string): number | null {
  for (let r = 1; r <= Math.min(40, model.rowCount(sheet)); r++) {
    let volume = false;
    let analysis = false;
    for (let c = 1; c <= Math.min(40, model.columnCount(sheet)); c++) {
      const t = upper(model.text(sheet, r, c));
      if (t === 'VOLUME') volume = true;
      if (/^NO\.? ?ANALISA/.test(t)) analysis = true;
    }
    if (volume && analysis) return r;
  }
  return null;
}

const blockMatches = (label: string, target: RabVersionType) =>
  target === 'CONTRACT' ? /KONTRAK|PENAWARAN/.test(label) : target === 'MC0' ? /^MC\s*-?\s*0\b|MUTUAL/.test(label) : /ADDENDUM|ADD\b/.test(label);

export function detectRabColumns(model: WorkbookModel, sheet: string, target: RabVersionType): RabColumns {
  const headerRow = findHeaderRow(model, sheet);
  if (headerRow === null) throw new RabSheetError(`Sheet "${sheet}" tidak memiliki header RAB (VOLUME dan NO. ANALISA).`);
  const width = Math.min(60, model.columnCount(sheet));
  // Header text may continue on the next one or two rows ("HARGA" / "SATUAN" / "(Rp)").
  const label = (c: number) => upper([0, 1, 2].map((d) => model.text(sheet, headerRow + d, c)).filter(Boolean).join(' '));
  const top = (c: number) => upper(model.text(sheet, headerRow, c));

  // Block labels on the row above the header (merged cells report their value on the first column).
  const blocks: { col: number; label: string }[] = [];
  for (let c = 1; c <= width; c++) {
    const t = upper(model.text(sheet, headerRow - 1, c));
    if (t && /KONTRAK|PENAWARAN|MC\s*-?\s*0|ADDENDUM|MUTUAL/.test(t)) blocks.push({ col: c, label: t });
  }
  const volumeCols = Array.from({ length: width }, (_, i) => i + 1).filter((c) => top(c) === 'VOLUME');
  let span: [number, number] = [1, width];
  let block: string | null = null;
  if (blocks.length > 0) {
    const chosen = blocks.filter((b) => blockMatches(b.label, target));
    if (chosen.length !== 1) {
      throw new RabSheetError(`Sheet "${sheet}" memiliki blok ${blocks.map((b) => b.label).join(', ')}; blok untuk versi ${target} tidak dapat dipastikan.`);
    }
    const start = chosen[0]!.col;
    const next = blocks.find((b) => b.col > start)?.col ?? width + 1;
    span = [start, next - 1];
    block = chosen[0]!.label;
  } else if (volumeCols.length !== 1) {
    throw new RabSheetError(`Sheet "${sheet}" memiliki ${volumeCols.length} kolom VOLUME tanpa label blok.`);
  }
  const inSpan = (c: number) => c >= span[0] && c <= span[1];
  const first = (test: (c: number) => boolean, within: boolean) => {
    for (let c = 1; c <= width; c++) if ((!within || inSpan(c)) && test(c)) return c;
    return null;
  };

  const volume = first((c) => top(c) === 'VOLUME', true);
  // NO / uraian headers may sit one row above, merged down over the header row.
  const near = (c: number) => [top(c), upper(model.text(sheet, headerRow - 1, c))];
  const no = first((c) => near(c).some((t) => t === 'NO' || t === 'NO.'), false);
  const description = first((c) => near(c).some((t) => /^(JENIS PEKERJAAN|URAIAN)/.test(t)), false);
  const analysis = first((c) => /^NO\.? ?ANALISA/.test(top(c)), false);
  const price = first((c) => /^HARGA/.test(label(c)) && !/PPN/.test(label(c)), true);
  const tax = first((c) => /^PPN\b/.test(label(c)), true) ?? first((c) => /^PPN\b/.test(label(c)), false);
  const priceWithTax = first((c) => /^HARGA/.test(label(c)) && /PPN/.test(label(c)), true);
  const amount = first((c) => /^(SUB ?JUMLAH|JUMLAH)\b/.test(label(c)), true);
  if (!volume || !no || !description || !price) {
    throw new RabSheetError(`Kolom NO, uraian, VOLUME, atau HARGA tidak dikenali di sheet "${sheet}".`);
  }
  // The unit column is "SAT"/"SATUAN" or, without its own header, the column after VOLUME.
  const unit = first((c) => /^(SAT|SATUAN)$/.test(top(c)), true) ?? volume + 1;
  return { headerRow, no, description, analysis, volume, unit, price, tax, priceWithTax, amount, block };
}

const isSection = (no: string) => /^[A-Z]$/.test(no);
const isSubsection = (no: string) => /^[A-Z]\.[IVXLC]+$/.test(no);
const isTotalLabel = (t: string) => /^(JUMLAH|DIBULATKAN|TOTAL|SUB ?TOTAL|REAL COST)\b/.test(t);

export function readRabSheet(model: WorkbookModel, sheetName: string, target: RabVersionType): RabSheet {
  const sheet = model.sheetName(sheetName);
  if (!sheet) throw new RabSheetError(`Sheet "${sheetName}" tidak ada.`);
  const cols = detectRabColumns(model, sheet, target);
  const rows: RabSheetRow[] = [];
  let section: number | null = null;
  let subsection: number | null = null;
  let parentItem: number | null = null;
  let totalValue: { value: string; raw: string | null } | null = null;
  let rounded: string | null = null;
  const raw = (r: number, c: number | null) => {
    const v = c === null ? null : model.cell(sheet, r, c).value;
    return typeof v === 'number' && Number.isFinite(v) ? v.toPrecision(17) : null;
  };

  for (let r = cols.headerRow + 1; r <= model.rowCount(sheet); r++) {
    const no = model.text(sheet, r, cols.no);
    const description = model.text(sheet, r, cols.description);
    // Totals may be labelled in the description or in a column left of the price ("JUMLAH" in the price
    // column on office RAB sheets); section subtotals labelled in the description are skipped.
    const labelled = [1, 2, 3, 4, 5, 6, 7, cols.price].map((c) => ({ c, t: upper(model.text(sheet, r, c)) })).find((x) => isTotalLabel(x.t));
    if (labelled) {
      parentItem = null;
      const grandTotal = /^JUMLAH TOTAL/.test(labelled.t) || (labelled.t === 'JUMLAH' && labelled.c !== cols.description);
      if (grandTotal) totalValue = blockAmount(model, sheet, r, cols) ?? totalValue;
      if (/^DIBULATKAN/.test(labelled.t)) {
        rounded = blockAmount(model, sheet, r, cols)?.value ?? null;
        break;
      }
      continue;
    }
    if (!description) continue;
    if (section === null && !isSection(no)) continue;

    const volume = excelDecimal(model.cell(sheet, r, cols.volume).value);
    const analysisRaw = cols.analysis ? model.cell(sheet, r, cols.analysis).value : null;
    const analysisCode = typeof analysisRaw === 'string' && analysisRaw.trim() ? analysisRaw.trim() : null;
    const sourceUnitPrice = excelDecimal(model.cell(sheet, r, cols.price).value);
    const hasPrice = sourceUnitPrice !== null && !new Decimal(sourceUnitPrice).isZero();
    const hasVolume = volume !== null && !new Decimal(volume).isZero();
    const base = {
      row: r,
      displayNumber: no || null,
      description,
      volume: null as string | null,
      unit: null as string | null,
      analysisCode: null as string | null,
      taxPercent: null as string | null,
      sourceUnitPrice: null as string | null,
      workbook: { unitPriceWithTax: null as string | null, subtotal: null as string | null },
      priceCell: { sheet, row: r, col: cols.price },
    };

    if (isSection(no)) {
      rows.push({ ...base, rowType: 'SECTION', parentRow: null });
      [section, subsection, parentItem] = [r, null, null];
    } else if (isSubsection(no)) {
      rows.push({ ...base, rowType: 'SUBSECTION', parentRow: section });
      [subsection, parentItem] = [r, null];
    } else if (analysisCode || hasPrice || hasVolume) {
      // An item is a row with an analysis reference, a price, or a volume; volume 0 alone does not drop it.
      if (no) parentItem = null;
      rows.push({
        ...base,
        rowType: 'ITEM',
        parentRow: (no ? null : parentItem) ?? subsection ?? section,
        volume: volume ?? '0',
        unit: model.text(sheet, r, cols.unit) || null,
        analysisCode,
        taxPercent: cols.tax ? excelDecimal(model.cell(sheet, r, cols.tax).value) : null,
        sourceUnitPrice,
        workbook: { unitPriceWithTax: raw(r, cols.priceWithTax), subtotal: raw(r, cols.amount) },
      });
    } else if (no) {
      rows.push({ ...base, rowType: 'PARENT_ITEM', parentRow: subsection ?? section });
      parentItem = r;
    } else if (rows.length > 0) {
      const previous = rows[rows.length - 1]!;
      previous.description = `${previous.description} ${description}`.slice(0, 1000);
    }
  }
  // Group rows without any item under them are headings with nothing to price.
  const hasChild = new Set(rows.map((r) => r.parentRow));
  const keep = rows.filter((r) => r.rowType === 'ITEM' || hasChild.has(r.row) || descendantItem(rows, r.row));
  return { sheet, columns: cols, rows: keep, totals: totalValue ? { value: totalValue.value, rounded, valueRaw: totalValue.raw } : null };
}

function descendantItem(rows: RabSheetRow[], row: number): boolean {
  return rows.some((r) => r.parentRow === row && (r.rowType === 'ITEM' || descendantItem(rows, r.row)));
}

/** Amount of the chosen block on a total row: the first numeric cell right of the price column. */
function blockAmount(model: WorkbookModel, sheet: string, row: number, cols: RabColumns): { value: string; raw: string } | null {
  for (let c = cols.price + 1; c <= cols.price + 4; c++) {
    const cached = model.cell(sheet, row, c).value;
    const v = excelDecimal(cached);
    if (v !== null && !new Decimal(v).isZero()) return { value: v, raw: (cached as number).toPrecision(17) };
  }
  return null;
}
