import JSZip from 'jszip';

/**
 * D-086: minimal in-place editing of an office .xlsx. Only the cells we write change; styles, merges, drawings,
 * charts and formulas stay byte-for-byte, so the file looks exactly like the office's own workbook.
 */
export type XlsxSheet = { name: string; path: string; index: number; hidden: boolean };

export class Xlsx {
  private constructor(
    readonly zip: JSZip,
    readonly sheets: XlsxSheet[],
    private workbookXml: string,
    private shared: string[] | null,
  ) {}

  static async open(buf: Buffer): Promise<Xlsx> {
    const zip = await JSZip.loadAsync(buf);
    const workbookXml = await text(zip, 'xl/workbook.xml');
    const rels = await text(zip, 'xl/_rels/workbook.xml.rels');
    const targets = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = attr(m[0], 'Id');
      const target = attr(m[0], 'Target');
      if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
    const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m, index) => ({
      name: unescapeXml(attr(m[0], 'name') ?? ''),
      path: targets.get(attr(m[0], 'r:id') ?? '') ?? '',
      index,
      hidden: /state="(hidden|veryHidden)"/.test(m[0]),
    }));
    return new Xlsx(zip, sheets, workbookXml, null);
  }

  sheet(name: string): XlsxSheet | undefined {
    return this.sheets.find((s) => s.name === name);
  }

  async read(name: string): Promise<string> {
    const s = this.sheet(name);
    if (!s) throw new Error(`Sheet ${name} tidak ada.`);
    return text(this.zip, s.path);
  }

  write(name: string, xml: string): void {
    this.zip.file(this.sheet(name)!.path, xml);
  }

  /** Shared strings, for reading cached text of `t="s"` cells. */
  async sharedStrings(): Promise<string[]> {
    if (this.shared) return this.shared;
    const file = this.zip.file('xl/sharedStrings.xml');
    const xml = file ? await file.async('string') : '';
    this.shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    return this.shared;
  }

  /** Excel recomputes every formula on open, so totals follow the cells we filled. */
  recalcOnOpen(): void {
    this.workbookXml = this.workbookXml.replace(/<calcPr\b([^>]*?)\/>/, (_m, a: string) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
    if (!/<calcPr\b/.test(this.workbookXml)) this.workbookXml = this.workbookXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  }

  /** Opens the file on `name` and, when `only` is given, hides every other sheet (used for the PDF copy). */
  async focus(name: string, only?: string[]): Promise<void> {
    const target = this.sheet(name);
    if (!target) return;
    const keep = only ? new Set(only) : null;
    let i = -1;
    this.workbookXml = this.workbookXml.replace(/<sheet\b[^>]*\/>/g, (tag) => {
      i++;
      if (!keep) return tag;
      const visible = keep.has(this.sheets[i]!.name);
      const clean = tag.replace(/\s*state="[^"]*"/, '');
      return visible ? clean : clean.replace('<sheet ', '<sheet state="hidden" ');
    });
    if (!/<workbookView\b/.test(this.workbookXml)) this.workbookXml = this.workbookXml.replace('<sheets>', '<bookViews><workbookView/></bookViews><sheets>');
    this.workbookXml = this.workbookXml.replace(/<workbookView\b[^>]*?\/?>/, (tag) =>
      tag.replace(/\s*activeTab="\d+"/, '').replace(/\s*firstSheet="\d+"/, '').replace('<workbookView', `<workbookView firstSheet="${target.index}" activeTab="${target.index}"`),
    );
    for (const s of this.sheets) {
      const xml = await text(this.zip, s.path);
      const selected = s.name === name;
      const next = xml.replace(/<sheetView\b[^>]*?>/, (tag) => {
        const clean = tag.replace(/\s*tabSelected="\d"/, '');
        return selected ? clean.replace('<sheetView', '<sheetView tabSelected="1"') : clean;
      });
      if (next !== xml) this.zip.file(s.path, next);
    }
  }

  /**
   * For printing on the server (D-086): drops links to other files and refuses formulas that fetch outside data,
   * so a recalculating LibreOffice cannot read local files or call URLs from an uploaded workbook.
   */
  async stripOutsideData(): Promise<void> {
    // Denylist over every formula-bearing element of every part (cells, defined names, conditional formats, data
    // validation); the converter also runs without network (pdf-convert.ts), so this is one of two layers.
    const risky = /\b(WEBSERVICE|FILTERXML|INDIRECT|DDE|IMPORTXML|IMPORTDATA|IMPORTRANGE|RTD|CALL|REGISTER|EXEC|HYPERLINK)\s*\(|\[\d+\]|[a-z][a-z0-9+.-]*:\/\/|file:/i;
    // Self-closing elements (shared formula children) carry no text.
    const formula = /<((?:\w+:)?(?:f|formula\d?|definedName))\b[^>]*(?<!\/)>([\s\S]*?)<\/\1>/g;
    // Names pointing into an external link ([n]) die with the links removed below; drop them instead of refusing.
    this.workbookXml = this.workbookXml
      .replace(/<definedName\b[^>]*>[^<]*\[\d+\][^<]*<\/definedName>/g, '')
      .replace(/<definedNames>\s*<\/definedNames>/, '');
    for (const name of Object.keys(this.zip.files)) {
      if (/^xl\/(connections\.xml|queryTables\/)/.test(name))
        throw new UnsafeWorkbookError('File Excel memuat koneksi data luar (connections/query table); PDF tidak dibuat.');
      if (!name.startsWith('xl/') || !name.endsWith('.xml') || name.startsWith('xl/externalLinks/')) continue;
      const xml = name === 'xl/workbook.xml' ? this.workbookXml : await text(this.zip, name);
      for (const m of xml.matchAll(formula)) {
        const f = unescapeXml(m[2]!);
        if (risky.test(f)) throw new UnsafeWorkbookError(`${name} memuat rumus yang mengambil data dari luar file (${f.slice(0, 60)}); PDF tidak dibuat.`);
      }
    }
    for (const name of Object.keys(this.zip.files)) if (name.startsWith('xl/externalLinks/')) this.zip.remove(name);
    this.workbookXml = this.workbookXml.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/, '');
    const rels = await text(this.zip, 'xl/_rels/workbook.xml.rels');
    this.zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*externalLink[^>]*\/>/g, ''));
    const ct = await text(this.zip, '[Content_Types].xml');
    this.zip.file('[Content_Types].xml', ct.replace(/<Override\b[^>]*externalLink[^>]*\/>/g, ''));
  }

  async save(): Promise<Buffer> {
    this.zip.file('xl/workbook.xml', this.workbookXml);
    // The cached calculation order may not match recalculated cells; Excel rebuilds it.
    if (this.zip.file('xl/calcChain.xml')) {
      this.zip.remove('xl/calcChain.xml');
      const ct = await text(this.zip, '[Content_Types].xml');
      this.zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''));
      const rels = await text(this.zip, 'xl/_rels/workbook.xml.rels');
      this.zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''));
    }
    return this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}

export class UnsafeWorkbookError extends Error {}

export type CellValue = number | string | null;
/** One parsed cell: address parts, style, raw formula and cached value. */
export type CellInfo = { ref: string; col: string; row: number; formula: string | null; shared: string | null; value: string | null; type: string | null };

/** Cells of every row, parsed lazily by the caller's filter (rows are cheap to split, cells only when needed). */
export function rowsOf(xml: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) out.set(Number(m[1]), m[0]);
  return out;
}

export function cellsOf(rowXml: string): CellInfo[] {
  return [...rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
    const ref = attr(`<c${m[1]}>`, 'r') ?? '';
    const body = m[2] ?? '';
    const f = /<f\b([^>]*)>([\s\S]*?)<\/f>/.exec(body);
    const fTag = /<f\b[^>]*\/?>/.exec(body)?.[0] ?? '';
    const v = /<v>([\s\S]*?)<\/v>/.exec(body) ?? /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
    const [, col = '', row = '0'] = /^([A-Z]+)(\d+)$/.exec(ref) ?? [];
    return {
      ref,
      col,
      row: Number(row),
      formula: f && f[2] ? unescapeXml(f[2]) : null,
      shared: /t="shared"/.test(fTag) ? attr(fTag, 'si') : null,
      value: v ? unescapeXml(v[1]!) : null,
      type: attr(`<c${m[1]}>`, 't'),
    };
  });
}

/** Writes constant values into cells (keeping each cell's style), creating missing cells in column order. */
export function setCells(xml: string, values: Map<string, CellValue>): string {
  const byRow = new Map<number, Map<string, CellValue>>();
  for (const [ref, v] of values) {
    const [, col, row] = /^([A-Z]+)(\d+)$/.exec(ref)!;
    (byRow.get(Number(row)) ?? byRow.set(Number(row), new Map()).get(Number(row))!).set(col!, v);
  }
  const done = new Set<number>();
  let out = xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (rowXml, r: string) => {
    const edits = byRow.get(Number(r));
    if (!edits) return rowXml;
    done.add(Number(r));
    return editRow(rowXml, Number(r), edits);
  });
  const missing = [...byRow.keys()].filter((r) => !done.has(r)).sort((a, b) => a - b);
  for (const r of missing) {
    const rowXml = editRow(`<row r="${r}"></row>`, r, byRow.get(r)!);
    // Insert before the first later row to keep rows sorted.
    const first = [...out.matchAll(/<row\b[^>]*\br="(\d+)"/g)].find((m) => Number(m[1]) > r);
    const at = first ? first.index! : out.indexOf('</sheetData>');
    out = out.slice(0, at) + rowXml + out.slice(at);
  }
  return out;
}

function editRow(rowXml: string, row: number, edits: Map<string, CellValue>): string {
  const open = /^<row\b[^>]*?(\/?)>/.exec(rowXml)!;
  const head = open[0].replace(/\/>$/, '>');
  const cells = open[1] ? [] : [...rowXml.slice(open[0].length, rowXml.lastIndexOf('</row>')).matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map((m) => m[0]);
  const list = cells.map((c) => ({ col: /\br="([A-Z]+)\d+"/.exec(c)![1]!, xml: c }));
  for (const [col, v] of edits) {
    const at = list.findIndex((c) => c.col === col);
    const style = at >= 0 ? (/\bs="(\d+)"/.exec(list[at]!.xml)?.[1] ?? null) : null;
    const xml = cellXml(`${col}${row}`, style, v);
    if (at >= 0) list[at] = { col, xml };
    else {
      const after = list.findIndex((c) => colNumber(c.col) > colNumber(col));
      list.splice(after < 0 ? list.length : after, 0, { col, xml });
    }
  }
  return `${head}${list.map((c) => c.xml).join('')}</row>`;
}

function cellXml(ref: string, style: string | null, v: CellValue): string {
  const s = style ? ` s="${style}"` : '';
  if (v === null || v === '') return `<c r="${ref}"${s}/>`;
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
}

export function colNumber(col: string): number {
  return [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

async function text(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`Bagian ${path} tidak ada di file Excel.`);
  return f.async('string');
}
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}
