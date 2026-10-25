import { formatAddress, type FormulaNode } from './formula';
import type { CellInfo, CellScalar, WorkbookModel } from './workbook-model';

/** One hop of a reference chain, kept as evidence (sheet!cell, formula text, cached value). */
export interface TraceStep {
  cell: string;
  formula: string | null;
  value: CellScalar;
  via: 'START' | 'REF' | 'VLOOKUP';
}

export interface TraceLookup {
  keyCell: string | null;
  key: CellScalar;
  range: string;
  column: number;
  matches: number;
  matchCell: string;
  /** First-column cell of the matched row (the table's key cell). */
  matchKey: { sheet: string; row: number; col: number };
}

export type TraceProblemCode = 'UNSUPPORTED' | 'EXTERNAL' | 'NOT_FOUND' | 'APPROXIMATE' | 'DUPLICATE_KEY' | 'CYCLE' | 'MISSING_SHEET' | 'TOO_DEEP';

export interface TraceProblem {
  code: TraceProblemCode;
  cell: string;
  message: string;
}

export interface TraceResult {
  steps: TraceStep[];
  /** Last cell reached: a value, an empty cell, or a formula that is not a plain reference (arithmetic, SUM, …). */
  terminal: CellInfo;
  terminalKind: 'FORMULA' | 'VALUE' | 'EMPTY';
  /** ROUND scales met along the chain, outermost first. */
  roundings: number[];
  lookups: TraceLookup[];
  /** Blocking for the chain (it stopped there) except DUPLICATE_KEY, which Excel resolves to the first match. */
  problems: TraceProblem[];
}

const MAX_DEPTH = 40;

const numberLiteral = (n: FormulaNode): number | null =>
  n.kind === 'number' ? n.value : n.kind === 'unary' && n.operand.kind === 'number' ? (n.op === '-' ? -n.operand.value : n.operand.value) : null;

/**
 * Follows reference-like hops from a cell (D-047, D-052): =A1, VLOOKUP exact, IFERROR(x, …), ROUND(x, n),
 * unary +. Stops at a value or at a formula that computes something; never evaluates arithmetic itself.
 */
export function traceCell(model: WorkbookModel, sheet: string, row: number, col: number): TraceResult {
  return run(model, model.cell(sheet, row, col), null);
}

/**
 * Traces from a sub-expression of a cell's formula (e.g. the VLOOKUP inside `VLOOKUP(...)/8`): the cell is
 * the first step, the expression decides the first hop.
 */
export function traceExpression(model: WorkbookModel, at: CellInfo, node: FormulaNode): TraceResult {
  return run(model, at, node);
}

function run(model: WorkbookModel, start: CellInfo, startNode: FormulaNode | null): TraceResult {
  const steps: TraceStep[] = [];
  const roundings: number[] = [];
  const lookups: TraceLookup[] = [];
  const problems: TraceProblem[] = [];
  const visited = new Set<string>();

  let current = start;
  let override = startNode;
  let via: TraceStep['via'] = 'START';
  for (let depth = 0; ; depth++) {
    const key = formatAddress(current.address);
    steps.push({ cell: key, formula: current.formula, value: current.value, via });
    if (visited.has(key)) {
      problems.push({ code: 'CYCLE', cell: key, message: `Referensi melingkar di ${key}.` });
      return { steps, terminal: current, terminalKind: 'FORMULA', roundings, lookups, problems };
    }
    visited.add(key);
    if (depth >= MAX_DEPTH) {
      problems.push({ code: 'TOO_DEEP', cell: key, message: 'Rantai referensi terlalu panjang.' });
      return { steps, terminal: current, terminalKind: 'FORMULA', roundings, lookups, problems };
    }
    const node = override ?? model.formulaOf(current);
    override = null;
    if (!node) return { steps, terminal: current, terminalKind: current.value === null || current.value === '' ? 'EMPTY' : 'VALUE', roundings, lookups, problems };

    const hop = nextHop(model, node, current, roundings, lookups, problems);
    if (!hop) return { steps, terminal: current, terminalKind: 'FORMULA', roundings, lookups, problems };
    current = hop.cell;
    via = hop.via;
  }
}

function nextHop(
  model: WorkbookModel,
  start: FormulaNode,
  at: CellInfo,
  roundings: number[],
  lookups: TraceLookup[],
  problems: TraceProblem[],
): { cell: CellInfo; via: TraceStep['via'] } | null {
  const here = formatAddress(at.address);
  const sheetOf = (s: string | null) => {
    const name = model.sheetName(s ?? at.address.sheet);
    if (!name) problems.push({ code: 'MISSING_SHEET', cell: here, message: `Sheet "${s}" tidak ada di workbook ini.` });
    return name;
  };
  let node = start;
  for (;;) {
    switch (node.kind) {
      case 'unsupported':
        problems.push({
          code: /eksternal/.test(node.reason) ? 'EXTERNAL' : 'UNSUPPORTED',
          cell: here,
          message: `Rumus di ${here} tidak didukung: ${node.reason}.`,
        });
        return null;
      case 'ref': {
        const name = sheetOf(node.ref.sheet);
        return name ? { cell: model.cell(name, node.ref.row, node.ref.col), via: 'REF' } : null;
      }
      case 'unary':
        if (node.op !== '+') return null;
        node = node.operand;
        continue;
      case 'call': {
        if (node.name === 'IFERROR' && node.args.length >= 1) {
          node = node.args[0]!;
          continue;
        }
        if (node.name === 'ROUND' && node.args.length === 2) {
          const scale = numberLiteral(node.args[1]!);
          if (scale === null) {
            problems.push({ code: 'UNSUPPORTED', cell: here, message: `ROUND di ${here} memakai jumlah digit yang tidak tetap.` });
            return null;
          }
          roundings.push(scale);
          node = node.args[0]!;
          continue;
        }
        if (node.name === 'VLOOKUP') return vlookup(model, node.args, at, lookups, problems, sheetOf);
        // SUM of a single cell is that cell.
        if (node.name === 'SUM' && node.args.length === 1) {
          const a = node.args[0]!;
          if (a.kind === 'ref' || (a.kind === 'range' && a.start.row === a.end.row && a.start.col === a.end.col)) {
            node = a.kind === 'ref' ? a : { kind: 'ref', ref: a.start };
            continue;
          }
        }
        return null;
      }
      default:
        return null;
    }
  }
}

function vlookup(
  model: WorkbookModel,
  args: FormulaNode[],
  at: CellInfo,
  lookups: TraceLookup[],
  problems: TraceProblem[],
  sheetOf: (s: string | null) => string | null,
): { cell: CellInfo; via: 'VLOOKUP' } | null {
  const here = formatAddress(at.address);
  const [keyNode, rangeNode, colNode, exactNode] = args;
  const exact = exactNode && ((exactNode.kind === 'boolean' && !exactNode.value) || numberLiteral(exactNode) === 0);
  if (!exact) {
    problems.push({ code: 'APPROXIMATE', cell: here, message: `VLOOKUP di ${here} bukan pencocokan tepat (FALSE); tidak dapat dibuktikan.` });
    return null;
  }
  const column = colNode ? numberLiteral(colNode) : null;
  if (!rangeNode || rangeNode.kind !== 'range' || column === null || column < 1) {
    problems.push({ code: 'UNSUPPORTED', cell: here, message: `VLOOKUP di ${here} memakai tabel/kolom yang tidak tetap.` });
    return null;
  }
  let key: CellScalar;
  let keyCell: string | null = null;
  if (keyNode?.kind === 'ref') {
    const name = sheetOf(keyNode.ref.sheet);
    if (!name) return null;
    const k = model.cell(name, keyNode.ref.row, keyNode.ref.col);
    key = k.value;
    keyCell = formatAddress(k.address);
  } else if (keyNode?.kind === 'string' || keyNode?.kind === 'number') {
    key = keyNode.value;
  } else {
    problems.push({ code: 'UNSUPPORTED', cell: here, message: `Kunci VLOOKUP di ${here} bukan sel atau nilai tetap.` });
    return null;
  }
  const sheet = sheetOf(rangeNode.start.sheet);
  if (!sheet) return null;
  const range = `${sheet}!${formatAddress({ ...rangeNode.start, sheet: null })}:${formatAddress({ ...rangeNode.end, sheet: null })}`;
  const rows = model.lookupRows(sheet, rangeNode.start.col, rangeNode.start.row, rangeNode.end.row, key);
  if (rows.length === 0) {
    problems.push({ code: 'NOT_FOUND', cell: here, message: `VLOOKUP di ${here}: "${String(key)}" tidak ditemukan di ${range}.` });
    return null;
  }
  const target = model.cell(sheet, rows[0]!, rangeNode.start.col + column - 1);
  const matchCell = formatAddress(target.address);
  lookups.push({ keyCell, key, range, column, matches: rows.length, matchCell, matchKey: { sheet, row: rows[0]!, col: rangeNode.start.col } });
  if (rows.length > 1) {
    problems.push({ code: 'DUPLICATE_KEY', cell: here, message: `Kunci "${String(key)}" muncul ${rows.length}× di ${range}; Excel memakai baris pertama (${matchCell}).` });
  }
  return { cell: target, via: 'VLOOKUP' };
}

export const isBlocking = (p: TraceProblem) => p.code !== 'DUPLICATE_KEY';
