import { Decimal } from '@laporan-proyek/calc';
import { excelDecimal, type WorkbookModel } from '../imports/workbook/workbook-model';

export const DEFAULT_SCHEDULE_SHEET = 'Master Curva S';
const WEEK_HEADER = /^M\.?\s*(\d+)$/i;
/** The header and group numbers sit near the top-left of `Master Curva S`; this bounds the scan. */
const HEADER_SCAN_ROWS = 60;

export interface ParsedSchedule {
  entries: { groupId: string; weekNumber: number; weight: string }[];
  errors: string[];
}

const code = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/**
 * Reads % per group per week from a time schedule sheet (D-072 butir 4): week columns from the header row
 * with the most `M.n` labels, group rows from the column whose text matches the most group numbers, values
 * from the cached cell results.
 */
export function parseScheduleSheet(model: WorkbookModel, sheet: string, groups: { id: string; displayNumber: string | null }[], weekCount: number): ParsedSchedule {
  const name = model.sheetName(sheet);
  if (!name) return { entries: [], errors: [`Sheet "${sheet}" tidak ditemukan. Sheet tersedia: ${model.sheetNames().join(', ')}.`] };
  const rows = model.rowCount(name);
  const cols = model.columnCount(name);

  let header = { row: 0, weeks: new Map<number, number>() };
  for (let r = 1; r <= Math.min(rows, HEADER_SCAN_ROWS); r++) {
    const weeks = new Map<number, number>();
    for (let c = 1; c <= cols; c++) {
      const m = WEEK_HEADER.exec(model.text(name, r, c));
      if (m) weeks.set(c, Number(m[1]));
    }
    if (weeks.size > header.weeks.size) header = { row: r, weeks };
  }
  if (!header.weeks.size) return { entries: [], errors: [`Header minggu (M.1, M.2, …) tidak ditemukan di sheet "${name}".`] };

  const groupByCode = new Map(groups.filter((g) => g.displayNumber).map((g) => [code(g.displayNumber!), g.id]));
  const firstWeekCol = Math.min(...header.weeks.keys());
  let codeCol = 0;
  let best = 0;
  for (let c = 1; c < firstWeekCol; c++) {
    let hits = 0;
    for (let r = header.row + 1; r <= rows; r++) if (groupByCode.has(code(model.text(name, r, c)))) hits++;
    if (hits > best) [codeCol, best] = [c, hits];
  }
  if (!codeCol) return { entries: [], errors: [`Kolom nomor kelompok (A, B.I, …) tidak ditemukan di sheet "${name}".`] };

  const entries: ParsedSchedule['entries'] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let r = header.row + 1; r <= rows; r++) {
    const label = model.text(name, r, codeCol);
    const values = [...header.weeks].map(([c, weekNumber]) => ({ weekNumber, weight: excelDecimal(model.number(name, r, c)) })).filter((v) => v.weight && !new Decimal(v.weight).isZero());
    const groupId = groupByCode.get(code(label));
    if (!groupId) {
      if (label && values.length) errors.push(`Baris ${r} (${label}) berisi rencana tetapi bukan kelompok jadwal di RAB ini.`);
      continue;
    }
    if (seen.has(groupId)) {
      errors.push(`Kelompok ${label} muncul lebih dari sekali (baris ${r}).`);
      continue;
    }
    seen.add(groupId);
    for (const v of values) {
      if (new Decimal(v.weight!).isNegative()) errors.push(`Baris ${r} (${label}) minggu ${v.weekNumber}: nilai negatif.`);
      else if (v.weekNumber > weekCount) errors.push(`Baris ${r} (${label}): minggu ${v.weekNumber} di luar masa proyek (${weekCount} minggu).`);
      else entries.push({ groupId, weekNumber: v.weekNumber, weight: v.weight! });
    }
  }
  for (const g of groups) if (!seen.has(g.id)) errors.push(`Kelompok ${g.displayNumber ?? '(tanpa nomor)'} tidak ditemukan di sheet "${name}".`);
  return { entries, errors };
}
