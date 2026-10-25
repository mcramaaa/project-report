/**
 * Excel formula parser for the subset supported by import v1 (D-052): cell/range references across
 * sheets, numbers, strings, booleans, function calls, + - * / & comparisons, unary +/-, and %.
 * Anything else (external workbooks, whole-column ranges, array syntax, …) becomes `unsupported`, so
 * tracing stops and the row goes to review instead of being guessed.
 */

export interface CellAddress {
  sheet: string | null;
  col: number;
  row: number;
}

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'ref'; ref: CellAddress }
  | { kind: 'range'; start: CellAddress; end: CellAddress }
  | { kind: 'call'; name: string; args: FormulaNode[] }
  | { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode }
  | { kind: 'unary'; op: '+' | '-'; operand: FormulaNode }
  | { kind: 'percent'; operand: FormulaNode }
  | { kind: 'unsupported'; reason: string };

export function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function columnLetters(col: number): string {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export const formatAddress = (a: { sheet: string | null; col: number; row: number }) =>
  `${a.sheet ? `${a.sheet}!` : ''}${columnLetters(a.col)}${a.row}`;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; sheet: string | null; col: number; row: number; external: boolean }
  | { t: 'colref'; sheet: string | null }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; } | { t: ')' } | { t: ',' } | { t: ':' };

class Unsupported extends Error {}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d+)/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const readSheetRef = (sheet: string, external: boolean) => {
    // After "Sheet!" a cell reference must follow.
    const m = CELL.exec(src.slice(i));
    if (!m) {
      if (/^\$?[A-Za-z]{1,3}:/.test(src.slice(i))) throw new Unsupported('rentang kolom penuh tidak didukung');
      throw new Unsupported(`referensi sheet tidak lengkap setelah ${sheet}!`);
    }
    i += m[0].length;
    tokens.push({ t: 'ref', sheet, col: columnNumber(m[1]!), row: Number(m[2]), external });
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      i++;
    } else if (ch === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new Unsupported('teks tidak ditutup');
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      tokens.push({ t: 'str', v: s });
    } else if (ch === "'") {
      // 'Sheet Name'!A1 or '[1]Sheet'!A1
      let name = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new Unsupported('nama sheet tidak ditutup');
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            name += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        name += src[i++];
      }
      if (src[i] !== '!') throw new Unsupported('nama sheet tanpa referensi sel');
      i++;
      const external = /^\[[^\]]+\]/.test(name);
      readSheetRef(external ? name.replace(/^\[[^\]]+\]/, '') : name, external);
    } else if (ch === '[') {
      const m = /^\[([^\]]+)\]([A-Za-z0-9_.]+)!/.exec(src.slice(i));
      if (!m) throw new Unsupported('referensi terstruktur/eksternal tidak didukung');
      i += m[0].length;
      readSheetRef(m[2]!, true);
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      tokens.push({ t: 'num', v: Number(m[0]) });
    } else if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i))!;
      const word = m[0];
      if (src[i + word.length] === '!') {
        i += word.length + 1;
        readSheetRef(word, false);
        continue;
      }
      const cell = CELL.exec(src.slice(i));
      if (cell && cell[0].length === word.length) {
        i += word.length;
        tokens.push({ t: 'ref', sheet: null, col: columnNumber(cell[1]!), row: Number(cell[2]), external: false });
        continue;
      }
      i += word.length;
      tokens.push({ t: 'name', v: word.toUpperCase() });
    } else if (ch === '<' || ch === '>') {
      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ t: 'op', v: two });
        i += 2;
      } else {
        tokens.push({ t: 'op', v: ch });
        i++;
      }
    } else if ('+-*/^&=%'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
    } else if (ch === '(' || ch === ')' || ch === ',' || ch === ':') {
      tokens.push({ t: ch });
      i++;
    } else if (ch === ';') {
      tokens.push({ t: ',' });
      i++;
    } else {
      throw new Unsupported(`karakter "${ch}" tidak didukung`);
    }
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parseFormula(formula: string): FormulaNode {
  const src = formula.startsWith('=') ? formula.slice(1) : formula;
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (err) {
    if (err instanceof Unsupported) return { kind: 'unsupported', reason: err.message };
    throw err;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const primary = (): FormulaNode => {
    const tok = next();
    if (!tok) throw new Unsupported('rumus terpotong');
    if (tok.t === 'op' && (tok.v === '+' || tok.v === '-')) return { kind: 'unary', op: tok.v, operand: postfix(primary()) };
    if (tok.t === 'num') return { kind: 'number', value: tok.v };
    if (tok.t === 'str') return { kind: 'string', value: tok.v };
    if (tok.t === '(') {
      const inner = expression(0);
      if (next()?.t !== ')') throw new Unsupported('kurung tidak ditutup');
      return inner;
    }
    if (tok.t === 'ref') {
      if (tok.external) throw new Unsupported(`referensi ke workbook eksternal (${tok.sheet}) tidak tersedia`);
      const start: CellAddress = { sheet: tok.sheet, col: tok.col, row: tok.row };
      if (peek()?.t === ':') {
        pos++;
        const end = next();
        if (!end || end.t !== 'ref') throw new Unsupported('rentang tidak lengkap');
        return { kind: 'range', start, end: { sheet: end.sheet ?? tok.sheet, col: end.col, row: end.row } };
      }
      return { kind: 'ref', ref: start };
    }
    if (tok.t === 'name') {
      if (tok.v === 'TRUE' || tok.v === 'FALSE') return { kind: 'boolean', value: tok.v === 'TRUE' };
      if (peek()?.t !== '(') throw new Unsupported(`nama "${tok.v}" (named range) tidak didukung`);
      pos++;
      const args: FormulaNode[] = [];
      if (peek()?.t !== ')') {
        for (;;) {
          args.push(peek()?.t === ',' ? { kind: 'unsupported', reason: 'argumen kosong' } : expression(0));
          const sep = next();
          if (sep?.t === ')') break;
          if (sep?.t !== ',') throw new Unsupported('pemisah argumen tidak dikenali');
        }
      } else {
        pos++;
      }
      return { kind: 'call', name: tok.v.replace(/^_XLFN\./, ''), args };
    }
    throw new Unsupported('token tidak terduga');
  };

  const postfix = (node: FormulaNode): FormulaNode => {
    let n = node;
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '%') {
      pos++;
      n = { kind: 'percent', operand: n };
    }
    return n;
  };

  const expression = (minPrec: number): FormulaNode => {
    let left = postfix(primary());
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op' || tok.v === '%') break;
      const prec = PRECEDENCE[tok.v];
      if (prec === undefined || prec < minPrec) break;
      pos++;
      const right = expression(tok.v === '^' ? prec : prec + 1);
      left = { kind: 'binary', op: tok.v, left, right };
    }
    return left;
  };

  try {
    const node = expression(0);
    if (pos < tokens.length) throw new Unsupported('sisa rumus tidak terbaca');
    return node;
  } catch (err) {
    if (err instanceof Unsupported) return { kind: 'unsupported', reason: err.message };
    throw err;
  }
}

/** References (cells and range corners) a node mentions, resolved against the formula's own sheet. */
export function referencedCells(node: FormulaNode, sheet: string): CellAddress[] {
  switch (node.kind) {
    case 'ref':
      return [{ ...node.ref, sheet: node.ref.sheet ?? sheet }];
    case 'range':
      return [{ ...node.start, sheet: node.start.sheet ?? sheet }];
    case 'call':
      return node.args.flatMap((a) => referencedCells(a, sheet));
    case 'binary':
      return [...referencedCells(node.left, sheet), ...referencedCells(node.right, sheet)];
    case 'unary':
    case 'percent':
      return referencedCells(node.operand, sheet);
    default:
      return [];
  }
}
