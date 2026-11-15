import {
  matchesWord,
  RAB_PROFILE_ROLES,
  rabProfileSchema,
  type RabProfile,
  type RabProfileAssistDto,
  type WordMatch,
  type WordMatcher,
} from '@laporan-proyek/shared';
import type { ProfileAssistResponse } from './guide/profile-assist-guide';
import { columnLetters } from './workbook/formula';
import type { WorkbookModel } from './workbook/workbook-model';

/**
 * RAB_PLAYGROUND stage 3 (D-095): what the assistant may see, and the mechanical proof of what it proposes. The assistant
 * only names words and the cells that hold them; a word counts only when the cited cell really holds it.
 */

export type EditableProfile = Omit<RabProfile, 'origin' | 'name'>;
export interface AssistSource {
  model: WorkbookModel;
  filename: string;
  role: 'RAB' | 'SUPPORT';
  rabSheet?: string;
}

/** Characters per request (§6): enough for a sheet head and a few problem rows, never a whole workbook. */
export const ASSIST_CONTEXT_CHARS = 24_000;
const HEAD_ROWS = 40;
const COLS = 30;
const CELL_CHARS = 80;
const PROBLEM_ROWS = 12;

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
const address = (sheet: string, row: number, col: number) => `${sheet}!${columnLetters(col)}${row}`;
const clip = (s: string) => (s.length > CELL_CHARS ? `${s.slice(0, CELL_CHARS)}…` : s);

function rulesText(profile: EditableProfile): string {
  return RAB_PROFILE_ROLES.map((r) => {
    const value = getAt(profile, r.path) as WordMatcher | WordMatcher[];
    const list = Array.isArray(value) ? value : [value];
    return `${r.path}${r.many ? ' (many)' : ''} · ${list.map((m) => `[${m.match}: ${m.words.join(', ')}]`).join(' ')}`;
  }).join('\n');
}

/** Builds the assistant's input in priority order and stops at the character budget. */
export function assistContext(
  input: { sources: AssistSource[]; profile: EditableProfile; machine: string; problemCells: string[]; message: string },
  budget = ASSIST_CONTEXT_CHARS,
): { text: string; characters: number; sheets: string[] } {
  const parts: string[] = [];
  const sheets = new Set<string>();
  let used = 0;
  /** Adds lines until the budget is reached; returns false once nothing more fits. */
  const add = (title: string, lines: string[], sheet?: string) => {
    if (used >= budget || lines.length === 0) return false;
    const kept: string[] = [title];
    let size = title.length + 1;
    for (const line of lines) {
      if (used + size + line.length + 1 > budget) break;
      kept.push(line);
      size += line.length + 1;
    }
    if (kept.length === 1) return false;
    parts.push(kept.join('\n'));
    used += size;
    if (sheet) sheets.add(sheet);
    return true;
  };

  add('PERTANYAAN REVIEWER:', [input.message]);
  add('ROLES (path · aturan sekarang):', rulesText(input.profile).split('\n'));
  add('HASIL MESIN DENGAN PROFIL SEKARANG:', input.machine.split('\n'));
  add(
    'SHEET:',
    input.sources.flatMap((s) => s.model.sheetNames().map((n) => `${s.filename} · ${n} (${s.model.rowCount(n)} baris × ${s.model.columnCount(n)} kolom)`)),
  );
  // Heads of the sheets a run reads: the chosen RAB sheet first, then the others.
  const heads = input.sources
    .flatMap((s) => s.model.sheetNames().map((n) => ({ s, n, first: s.role === 'RAB' && (!s.rabSheet || s.rabSheet === n) })))
    .sort((a, b) => Number(b.first) - Number(a.first));
  for (const { s, n } of heads) {
    const lines: string[] = [];
    for (let r = 1; r <= Math.min(HEAD_ROWS, s.model.rowCount(n)); r++)
      for (let c = 1; c <= Math.min(COLS, s.model.columnCount(n)); c++) {
        const t = s.model.text(n, r, c);
        if (t) lines.push(`${address(n, r, c)}: ${clip(t)}`);
      }
    add(`ISI AWAL ${s.filename} · ${n} (${HEAD_ROWS} baris pertama):`, lines, n);
  }
  // Formula surroundings of the rows the machine stopped on.
  const rows = [...new Set(input.problemCells.map((c) => /^(.+)!\$?[A-Z]{1,3}\$?(\d+)$/.exec(c)).flatMap((m) => (m ? [`${m[1]}|${m[2]}`] : [])))].slice(0, PROBLEM_ROWS);
  for (const key of rows) {
    const [sheetName, rowText] = key.split('|') as [string, string];
    const row = Number(rowText);
    const src = input.sources.find((s) => s.model.sheetName(sheetName));
    if (!src) continue;
    const sheet = src.model.sheetName(sheetName)!;
    const lines: string[] = [];
    for (let c = 1; c <= Math.min(COLS, src.model.columnCount(sheet)); c++) {
      const cell = src.model.cell(sheet, row, c);
      if (cell.value === null && !cell.formula) continue;
      lines.push(`${address(sheet, row, c)}: ${cell.formula ? `=${clip(cell.formula)} → ` : ''}${clip(String(cell.value ?? ''))}`);
    }
    add(`SEL DI SEKITAR MASALAH ${sheet} baris ${row}:`, lines, sheet);
  }
  const text = parts.join('\n\n');
  return { text, characters: text.length, sheets: [...sheets] };
}

function getAt(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], o);
}
function setAt<T>(o: T, path: string, value: unknown): T {
  const next = structuredClone(o);
  const keys = path.split('.');
  let cur = next as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
  return next;
}

/** Header text a reader could see at the cell: the cell alone, or over two rows as the readers join titles. */
function headerTexts(model: WorkbookModel, cell: string): string[] | null {
  const m = /^(.+)!\$?([A-Z]{1,3})\$?(\d+)$/.exec(cell.trim());
  if (!m) return null;
  const sheet = model.sheetName(m[1]!.replace(/^'(.*)'$/, '$1'));
  if (!sheet) return null;
  const col = [...m[2]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const row = Number(m[3]);
  const at = (r: number) => (r >= 1 ? model.text(sheet, r, col) : '');
  const own = at(row);
  if (!own) return [];
  return [upper(own), upper(`${own} ${at(row + 1)}`), upper(`${at(row - 1)} ${own}`)];
}

type Accepted = RabProfileAssistDto['accepted'][number];
type Rejected = RabProfileAssistDto['rejected'][number];

/**
 * Applies the proposals whose words are proven: the cited cell (alone or as a two-row title) matches the word under the
 * proposed mode. Words only add to a role; a single-matcher role keeps its mode. The result must still be a valid profile.
 */
export function proveChanges(
  models: WorkbookModel[],
  profile: EditableProfile,
  changes: ProfileAssistResponse['changes'],
): { profile: EditableProfile; accepted: Accepted[]; rejected: Rejected[] } {
  let current = profile;
  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const editable = rabProfileSchema.omit({ origin: true, name: true });

  for (const change of changes) {
    const role = RAB_PROFILE_ROLES.find((r) => r.path === change.role);
    const words = change.words.map((w) => ({ word: upper(w.word), cell: w.cell }));
    if (!role) {
      rejected.push({ role: change.role, words: words.map((w) => w.word), reason: 'role tidak dikenal' });
      continue;
    }
    const proven: { word: string; cell: string }[] = [];
    for (const w of words) {
      const texts = models.map((m) => headerTexts(m, w.cell)).find((t) => t !== null);
      const reason = !w.word
        ? 'kata kosong'
        : texts === undefined
          ? `sel ${w.cell} tidak ada di dokumen`
          : !texts.some((t) => matchesWord(t, { match: change.match, words: [w.word] }))
            ? `sel ${w.cell} tidak memuat "${w.word}" dengan cara cocok ${change.match}`
            : null;
      if (reason) rejected.push({ role: change.role, words: [w.word], reason });
      else proven.push(w);
    }
    if (proven.length === 0) continue;

    const value = getAt(current, role.path) as WordMatcher | WordMatcher[];
    const add = (m: WordMatcher): WordMatcher => ({ ...m, words: [...m.words, ...proven.map((w) => w.word).filter((w) => !m.words.includes(w))] });
    let next: WordMatcher | WordMatcher[];
    if (Array.isArray(value)) {
      const same = value.findIndex((m) => m.match === change.match);
      next = same >= 0 ? value.map((m, i) => (i === same ? add(m) : m)) : [...value, add({ match: change.match, words: [] })];
    } else if (value.match !== change.match) {
      rejected.push({ role: change.role, words: proven.map((w) => w.word), reason: `cara cocok ${change.match} berbeda dari aturan yang ada (${value.match}); ubah manual di editor` });
      continue;
    } else {
      next = add(value);
    }
    const fresh = proven.filter((w) => !(Array.isArray(value) ? value : [value]).some((m) => m.match === change.match && m.words.includes(w.word)));
    if (fresh.length === 0) {
      rejected.push({ role: change.role, words: proven.map((w) => w.word), reason: 'kata sudah ada di profil' });
      continue;
    }
    const candidate = setAt(current, role.path, next);
    const valid = editable.safeParse(candidate);
    if (!valid.success) {
      rejected.push({ role: change.role, words: fresh.map((w) => w.word), reason: `profil tidak valid: ${valid.error.issues[0]?.message ?? 'skema'}` });
      continue;
    }
    current = valid.data;
    accepted.push({
      role: role.path,
      label: role.label,
      match: change.match as WordMatch,
      words: fresh.map((w) => w.word),
      cells: fresh.map((w) => w.cell),
      reason: change.reason,
    });
  }
  return { profile: current, accepted, rejected };
}
