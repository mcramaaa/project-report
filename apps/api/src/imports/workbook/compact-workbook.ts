import { closeSync, createReadStream, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createInflateRaw, inflateRawSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import type { CellScalar } from './workbook-model';

/**
 * Memory-lean .xlsx reader for the import pipeline.
 *
 * `ExcelJS.Workbook#xlsx.load` builds a Cell object (with style, address and
 * value wrappers) for every cell, which costs roughly 100 times the file size
 * in heap: a 32 MB office workbook needs about 3 GB. The API only ever reads
 * cached values and formula text through `WorkbookModel`, so this parser streams
 * each sheet's XML once and keeps one small array per row instead.
 *
 * Behaviour matches what `WorkbookModel` saw through exceljs:
 * - shared formulas are translated for every dependent cell (`C2` of `A1*B1`
 *   shared from `C1` reads `A2*B2`), which exceljs' own streaming reader drops;
 * - numbers in a date-formatted cell become `Date`;
 * - rich text and hyperlinks collapse to their text, errors to `null`;
 * - cells covered by a merge are empty (Excel stores nothing there).
 */

export interface CompactRow {
  /** Cached cell values; index = 1-based column, index 0 unused, holes = empty cells. */
  v: CellScalar[];
  /** Formula text per column; only allocated when the row has a formula. */
  f?: (string | null)[];
}

export interface CompactSheet {
  name: string;
  /** index = row number, index 0 unused, holes = rows without cells. */
  rows: (CompactRow | undefined)[];
  /** Last row number present in the sheet (exceljs `rowCount`). */
  rowCount: number;
  /** Highest column number holding a cell (exceljs `columnCount`). */
  columnCount: number;
}

export interface CompactWorkbook {
  readonly kind: 'compact';
  sheets: CompactSheet[];
}

export function isCompactWorkbook(value: unknown): value is CompactWorkbook {
  return typeof value === 'object' && value !== null && (value as CompactWorkbook).kind === 'compact';
}

export interface LoadOptions {
  /**
   * Stop each sheet after this many rows. The sheet inventory at upload time only
   * inspects the first 40 rows, so a 450 000-row workbook need not be read in full.
   */
  headRows?: number;
}

/** Thrown for a file that is not a readable .xlsx (bad zip, missing parts, malformed XML). */
export class WorkbookReadError extends Error {}

/** Reads an .xlsx from a buffer (upload) or a file path (stored document). */
export async function loadCompactWorkbook(input: Buffer | string, options: LoadOptions = {}): Promise<CompactWorkbook> {
  const zip = await openZip(input);
  const text = (name: string) => zip.entry(name)?.text() ?? null;

  const workbookXml = text('xl/workbook.xml');
  if (workbookXml === null) throw new WorkbookReadError('xl/workbook.xml tidak ditemukan');
  const rels = parseRels(text('xl/_rels/workbook.xml.rels') ?? '');
  const { sheets: sheetRefs, date1904 } = parseWorkbook(workbookXml);
  const sharedStrings = parseSharedStrings(text('xl/sharedStrings.xml') ?? '');
  const dateStyles = parseDateStyles(text('xl/styles.xml') ?? '');

  const sheets: CompactSheet[] = [];
  for (const ref of sheetRefs) {
    const target = rels.get(ref.rId);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    // Chart sheets and other non-worksheet parts hold no cells.
    if (!path.startsWith('xl/worksheets/')) continue;
    const entry = zip.entry(path);
    if (!entry) throw new WorkbookReadError(`${path} tidak ditemukan`);
    sheets.push(await parseSheet(ref.name, entry.stream(), { sharedStrings, dateStyles, date1904, headRows: options.headRows }));
  }
  return { kind: 'compact', sheets };
}

// ---------------------------------------------------------------------------
// Zip access: central directory only (the same walk as xlsx-guard), entries
// inflated on demand. Sizes come from the central directory, so files written
// with data descriptors (streaming writers) read fine. ZIP64 is refused.

interface ZipEntry {
  text(): string;
  stream(): Readable;
}

interface ZipReader {
  entry(name: string): ZipEntry | undefined;
}

async function openZip(input: Buffer | string): Promise<ZipReader> {
  const tail = typeof input === 'string' ? await readTail(input) : null;
  const bytes: Buffer = tail ?? (input as Buffer);
  const read = (start: number, end: number): Buffer =>
    typeof input === 'string' ? readRangeSync(input, start, end) : input.subarray(start, end);

  // End of central directory: 22 bytes + comment (≤ 65 535), so it sits in the last 65 557 bytes.
  const tailOffset = tail?.fileOffset ?? 0;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new WorkbookReadError('bukan file zip');
  const count = bytes.readUInt16LE(eocd + 10);
  const dirSize = bytes.readUInt32LE(eocd + 12);
  const dirOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new WorkbookReadError('zip64 tidak didukung');
  const dir = dirOffset >= tailOffset ? bytes.subarray(dirOffset - tailOffset, dirOffset - tailOffset + dirSize) : read(dirOffset, dirOffset + dirSize);

  const entries = new Map<string, { method: number; compressed: number; offset: number }>();
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > dir.length || dir.readUInt32LE(at) !== 0x02014b50) throw new WorkbookReadError('direktori zip rusak');
    const method = dir.readUInt16LE(at + 10);
    const compressed = dir.readUInt32LE(at + 20);
    const nameLength = dir.readUInt16LE(at + 28);
    const extraLength = dir.readUInt16LE(at + 30);
    const commentLength = dir.readUInt16LE(at + 32);
    const offset = dir.readUInt32LE(at + 42);
    const name = dir.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (compressed === 0xffffffff || offset === 0xffffffff) throw new WorkbookReadError('zip64 tidak didukung');
    entries.set(name, { method, compressed, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }

  const dataRange = (e: { compressed: number; offset: number }): [number, number] => {
    const local = read(e.offset, e.offset + 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new WorkbookReadError('header zip rusak');
    const start = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    return [start, start + e.compressed];
  };

  return {
    entry(name) {
      const e = entries.get(name);
      if (!e) return undefined;
      if (e.method !== 0 && e.method !== 8) throw new WorkbookReadError(`kompresi zip ${e.method} tidak didukung`);
      return {
        text() {
          const [start, end] = dataRange(e);
          const raw = read(start, end);
          return (e.method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
        },
        stream() {
          const [start, end] = dataRange(e);
          const source = typeof input === 'string' ? createReadStream(input, { start, end: end - 1 }) : Readable.from([input.subarray(start, end)]);
          if (e.method === 0) return source;
          const inflate = createInflateRaw();
          source.on('error', (err: Error) => inflate.destroy(err));
          return source.pipe(inflate);
        },
      };
    },
  };
}

/** Last 64 KiB + EOCD of a file on disk, tagged with its offset within the file. */
async function readTail(path: string): Promise<Buffer & { fileOffset: number }> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, 65_557 + 22);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return Object.assign(buffer, { fileOffset: size - length });
  } finally {
    await handle.close();
  }
}

function readRangeSync(path: string, start: number, end: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    readSync(fd, buffer, 0, end - start, start);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Small parts (parsed from one string).

function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  const parser = new SaxesParser();
  parser.on('opentag', (node) => {
    if (node.name === 'Relationship' && typeof node.attributes.Id === 'string' && typeof node.attributes.Target === 'string')
      map.set(node.attributes.Id, node.attributes.Target);
  });
  parser.write(xml).close();
  return map;
}

function parseWorkbook(xml: string): { sheets: { name: string; rId: string }[]; date1904: boolean } {
  const sheets: { name: string; rId: string }[] = [];
  let date1904 = false;
  const parser = new SaxesParser();
  parser.on('opentag', (node) => {
    if (node.name === 'sheet') {
      const rId = node.attributes['r:id'];
      if (typeof node.attributes.name === 'string' && typeof rId === 'string') sheets.push({ name: node.attributes.name, rId });
    } else if (node.name === 'workbookPr') {
      const v = node.attributes.date1904;
      date1904 = v === '1' || v === 'true';
    }
  });
  parser.write(xml).close();
  return { sheets, date1904 };
}

/** `<si>` texts in order; rich runs are joined, phonetic runs (`<rPh>`) skipped. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  if (!xml) return out;
  let current: string | null = null;
  let inT = false;
  let inPhonetic = 0;
  const parser = new SaxesParser();
  parser.on('opentag', (node) => {
    if (node.name === 'si') current = '';
    else if (node.name === 'rPh') inPhonetic++;
    else if (node.name === 't' && current !== null && inPhonetic === 0) inT = true;
  });
  parser.on('text', (t) => {
    if (inT && current !== null) current += t;
  });
  parser.on('closetag', (node) => {
    if (node.name === 't') inT = false;
    else if (node.name === 'rPh') inPhonetic--;
    else if (node.name === 'si' && current !== null) {
      out.push(current);
      current = null;
    }
  });
  parser.write(xml).close();
  return out;
}

/** Built-in number formats Excel renders as dates/times (ids 14–22 and 45–47). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Same test exceljs applies: date/time format characters outside quotes and brackets. */
function isDateFormat(code: string): boolean {
  return /[ymdhMsb]+/.test(code.replace(/\[[^\]]*]/g, '').replace(/"[^"]*"/g, ''));
}

/** Set of cell style indexes (`<c s="">`) whose number format is a date. */
function parseDateStyles(xml: string): Set<number> {
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;
  const customDate = new Set<number>();
  let inCellXfs = false;
  let xfIndex = 0;
  const parser = new SaxesParser();
  parser.on('opentag', (node) => {
    if (node.name === 'numFmt') {
      const id = Number(node.attributes.numFmtId);
      const code = node.attributes.formatCode;
      if (Number.isFinite(id) && typeof code === 'string' && isDateFormat(code)) customDate.add(id);
    } else if (node.name === 'cellXfs') inCellXfs = true;
    else if (node.name === 'xf' && inCellXfs) {
      const id = Number(node.attributes.numFmtId);
      if (customDate.has(id) || BUILTIN_DATE_FORMATS.has(id)) dateStyles.add(xfIndex);
      xfIndex++;
    }
  });
  parser.on('closetag', (node) => {
    if (node.name === 'cellXfs') inCellXfs = false;
  });
  parser.write(xml).close();
  return dateStyles;
}

// ---------------------------------------------------------------------------
// Sheet XML, streamed.

interface SheetContext {
  sharedStrings: string[];
  dateStyles: Set<number>;
  date1904: boolean;
  headRows?: number;
}

function excelToDate(serial: number, date1904: boolean): Date {
  return new Date(Math.round((serial - 25569 + (date1904 ? 1462 : 0)) * 24 * 3600 * 1000));
}

function parseSheet(name: string, source: Readable, ctx: SheetContext): Promise<CompactSheet> {
  return new Promise((resolve, reject) => {
    const rows: (CompactRow | undefined)[] = [];
    let rowCount = 0;
    let columnCount = 0;
    /** Shared formula masters by `si`: formula text and the master cell address. */
    const masters = new Map<string, { formula: string; row: number; col: number }>();

    /** Merged ranges (listed after sheetData); cells they cover are blanked like exceljs does. */
    const merges: { from: { row: number; col: number }; to: { row: number; col: number } }[] = [];
    let row: CompactRow | null = null;
    let rowNumber = 0;
    let col = 0;
    let cell: { col: number; style: number; type: string | undefined } | null = null;
    let formula: { text: string; shared: boolean; si: string | undefined; hasRef: boolean } | null = null;
    let value: { text: string } | null = null;
    let inlineText: string | null = null;
    let inInlineT = false;
    let inPhonetic = 0;
    let done = false;

    const parser = new SaxesParser();
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      source.destroy();
      if (err) return reject(err instanceof WorkbookReadError ? err : new WorkbookReadError(err.message));
      // Excel shows only the top-left cell of a merge; some files still store values in the covered cells.
      for (const { from, to } of merges)
        for (let r = from.row; r <= to.row; r++) {
          const covered = rows[r];
          if (!covered) continue;
          for (let c = from.col; c <= to.col; c++) {
            if (r === from.row && c === from.col) continue;
            delete covered.v[c];
            if (covered.f) delete covered.f[c];
          }
        }
      resolve({ name, rows, rowCount, columnCount });
    };

    parser.on('error', (err) => finish(err));
    parser.on('opentag', (node) => {
      if (done) return;
      switch (node.name) {
        case 'row': {
          const r = Number(node.attributes.r);
          rowNumber = Number.isFinite(r) && r > 0 ? r : rowNumber + 1;
          if (ctx.headRows !== undefined && rowNumber > ctx.headRows) return finish();
          rowCount = Math.max(rowCount, rowNumber);
          row = { v: [] };
          col = 0;
          break;
        }
        case 'c': {
          if (!row) break;
          const ref = typeof node.attributes.r === 'string' ? decodeAddress(node.attributes.r) : null;
          col = ref ? ref.col : col + 1;
          cell = { col, style: Number(node.attributes.s) || 0, type: typeof node.attributes.t === 'string' ? node.attributes.t : undefined };
          formula = null;
          value = null;
          inlineText = null;
          break;
        }
        case 'f':
          if (cell) formula = { text: '', shared: node.attributes.t === 'shared', si: typeof node.attributes.si === 'string' ? node.attributes.si : undefined, hasRef: typeof node.attributes.ref === 'string' };
          break;
        case 'v':
          if (cell) value = { text: '' };
          break;
        case 'is':
          if (cell) inlineText = '';
          break;
        case 'rPh':
          inPhonetic++;
          break;
        case 't':
          if (inlineText !== null && inPhonetic === 0) inInlineT = true;
          break;
        case 'mergeCell': {
          const ref = typeof node.attributes.ref === 'string' ? node.attributes.ref.split(':') : [];
          const from = ref[0] ? decodeAddress(ref[0]) : null;
          const to = ref[1] ? decodeAddress(ref[1]) : from;
          if (from && to) merges.push({ from, to });
          break;
        }
        default:
          break;
      }
    });
    parser.on('text', (t) => {
      if (done) return;
      if (formula && value === null && inlineText === null) formula.text += t;
      else if (value) value.text += t;
      else if (inInlineT && inlineText !== null) inlineText += t;
    });
    parser.on('closetag', (node) => {
      if (done) return;
      switch (node.name) {
        case 't':
          inInlineT = false;
          break;
        case 'rPh':
          inPhonetic--;
          break;
        case 'c': {
          if (!row || !cell) break;
          const { col: c, style, type } = cell;
          let formulaText: string | null = null;
          if (formula) {
            if (formula.shared && formula.si !== undefined) {
              if (formula.text) masters.set(formula.si, { formula: formula.text, row: rowNumber, col: c });
              else {
                const master = masters.get(formula.si);
                formulaText = master ? slideFormula(master.formula, master, { row: rowNumber, col: c }) : null;
              }
            }
            if (formulaText === null && formula.text) formulaText = formula.text;
          }
          let scalar: CellScalar = null;
          if (inlineText !== null) scalar = inlineText;
          // An empty <v/> (e.g. a formula whose cached result is blank) is no value, as in exceljs.
          else if (value && value.text !== '') scalar = decodeValue(value.text, type, style, ctx);
          if (scalar !== null) row.v[c] = scalar;
          if (formulaText !== null) {
            row.f ??= [];
            row.f[c] = formulaText;
          }
          // exceljs keeps a Cell for a value, a formula, or a styled empty cell (`s` non-zero); a bare `<c r="X"/>` is
          // dropped as a merge placeholder. columnCount counts the kept cells.
          if (scalar !== null || formulaText !== null || style !== 0) columnCount = Math.max(columnCount, c);
          cell = null;
          formula = null;
          value = null;
          inlineText = null;
          break;
        }
        case 'row':
          if (row && (row.v.length > 0 || row.f)) rows[rowNumber] = row;
          row = null;
          break;
        case 'mergeCells':
          // <mergeCells> directly follows <sheetData>; nothing the model needs comes after it.
          finish();
          break;
        default:
          break;
      }
    });

    const decoder = new StringDecoder('utf8');
    source.on('data', (chunk: Buffer) => {
      if (done) return;
      try {
        parser.write(decoder.write(chunk));
      } catch (err) {
        finish(err as Error);
      }
    });
    source.on('end', () => {
      if (done) return;
      try {
        parser.write(decoder.end()).close();
        finish();
      } catch (err) {
        finish(err as Error);
      }
    });
    source.on('error', (err) => finish(err));
  });
}

function decodeValue(text: string, type: string | undefined, style: number, ctx: SheetContext): CellScalar {
  switch (type) {
    case 's': {
      const index = Number(text);
      return ctx.sharedStrings[index] ?? null;
    }
    case 'str':
    case 'inlineStr':
      return text;
    case 'b':
      return Number(text) !== 0;
    case 'e':
      return null;
    case 'd': {
      const d = new Date(text);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    default: {
      const n = Number(text);
      if (!Number.isFinite(n)) return null;
      // Same as exceljs: a number in a date-formatted cell is a Date, for literals and formula results alike.
      return ctx.dateStyles.has(style) ? excelToDate(n, ctx.date1904) : n;
    }
  }
}

// ---------------------------------------------------------------------------
// Addresses and shared-formula translation (port of exceljs `slideFormula`).

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function columnLetters(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function decodeAddress(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d*)$/.exec(ref);
  return m ? { row: Number(m[2]), col: columnNumber(m[1] ?? '') } : null;
}

const REF_CANDIDATE = /(([a-z_\-0-9]*)!)?([a-z0-9_$]{2,})([(])?/gi;
const CELL_REF = /^([$])?([a-z]+)([$])?([1-9][0-9]*)$/i;

/** Rewrites a shared formula from its master cell to a dependent cell, keeping `$`-anchored parts. */
export function slideFormula(formula: string, from: { row: number; col: number }, to: { row: number; col: number }): string {
  return formula.replace(REF_CANDIDATE, (match, sheet: string | undefined, _sheetName, addr: string, paren: string | undefined) => {
    if (paren) return match;
    const m = CELL_REF.exec(addr);
    if (!m) return match;
    const colLetters = (m[2] ?? '').toUpperCase();
    // Beyond XFD there are no columns: this is a named range, not a reference.
    if (colLetters.length > 3 || (colLetters.length === 3 && colLetters > 'XFD')) return match;
    let col = columnNumber(colLetters);
    let row = Number(m[4]);
    if (!m[1]) col += to.col - from.col;
    if (!m[3]) row += to.row - from.row;
    return `${sheet ?? ''}${m[1] ?? ''}${columnLetters(col)}${m[3] ?? ''}${row}`;
  });
}
