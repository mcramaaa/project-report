import type { WorkbookModel } from '../imports/workbook/workbook-model';
import {
  columnLetters,
  columnNumber,
  parseFormula,
  type FormulaNode,
} from '../imports/workbook/formula';

/** Only syntactic references are listed. No formula execution, network access or external workbook loading. */
export function formulaReferences(
  formula: string | null,
  sheet: string,
): { sheet: string; cell: string; range?: string }[] {
  if (!formula) return [];
  const refs: { sheet: string; cell: string; range?: string }[] = [];
  function visit(n: FormulaNode): void {
    if (n.kind === 'ref')
      refs.push({ sheet: n.ref.sheet ?? sheet, cell: `${columnLetters(n.ref.col)}${n.ref.row}` });
    else if (n.kind === 'range')
      refs.push({
        sheet: n.start.sheet ?? sheet,
        cell: `${columnLetters(n.start.col)}${n.start.row}`,
        range: `${columnLetters(n.start.col)}${n.start.row}:${columnLetters(n.end.col)}${n.end.row}`,
      });
    else if (n.kind === 'binary') {
      visit(n.left);
      visit(n.right);
    } else if (n.kind === 'unary' || n.kind === 'percent') visit(n.operand);
    else if (n.kind === 'call') n.args.forEach(visit);
  }
  visit(parseFormula(formula));
  return [...new Map(refs.map((r) => [`${r.sheet}!${r.range ?? r.cell}`, r])).values()].slice(
    0,
    100,
  );
}

export function previewWindow(model: WorkbookModel, sheet: string, cell: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(cell)!;
  const row = Number(match[2]);
  const col = columnNumber(match[1]!);
  const serialize = (r: number, c: number) => {
    const info = model.cell(sheet, r, c);
    return {
      cell: `${columnLetters(c)}${r}`,
      value:
        info.value instanceof Date
          ? info.value.toISOString()
          : info.value === null
            ? null
            : String(info.value),
      formula: info.formula,
    };
  };
  const firstRow = Math.max(1, row - 5);
  const lastRow = Math.min(1048576, row + 5);
  const firstCol = Math.max(1, col - 5);
  const lastCol = Math.min(16384, firstCol + 11);
  const selected = serialize(row, col);
  return {
    selected: { ...selected, references: formulaReferences(selected.formula, sheet) },
    columns: Array.from({ length: lastCol - firstCol + 1 }, (_, i) => columnLetters(firstCol + i)),
    rows: Array.from({ length: lastRow - firstRow + 1 }, (_, i) => ({
      number: firstRow + i,
      cells: Array.from({ length: lastCol - firstCol + 1 }, (_, j) =>
        serialize(firstRow + i, firstCol + j),
      ),
    })),
  };
}
