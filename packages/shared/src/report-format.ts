import { Decimal } from '@laporan-proyek/calc';
import type { WeatherCondition } from './daily-reports.js';
import type { IdentityKey, ReportTemplateConfig } from './report-templates.js';
import type { WeeklyReportContent } from './weekly-reports.js';

/** D-082/D-084: text shared by the print page and the Excel export, so both read the same. */
export type ReportIdentity = {
  activityName: string;
  subActivityName: string;
  projectName: string;
  contractNumber: string;
  contractDate: string;
  spmkNumber: string;
  spmkDate: string;
  contractorName: string;
  consultantName: string;
  location: string;
  fiscalYear: number;
};

export const longDateId = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayNameId = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();

export function identityText(id: ReportIdentity, key: IdentityKey): string {
  switch (key) {
    case 'contract':
      return `${id.contractNumber}, TANGGAL ${longDateId(id.contractDate).toUpperCase()}`;
    case 'spmk':
      return `${id.spmkNumber}, TANGGAL ${longDateId(id.spmkDate).toUpperCase()}`;
    case 'contractor':
      return id.contractorName;
    case 'consultant':
      return id.consultantName;
    case 'fiscalYear':
      return String(id.fiscalYear);
    default:
      return id[key];
  }
}

/** Weather rows of the daily office format; Mendung covers cloudy and drizzle (D-084 butir 1). */
export function dailyWeatherRows(
  t: ReportTemplateConfig,
  weather: { condition: WeatherCondition; fromTime: string | null; toTime: string | null }[],
) {
  const l = t.daily.weatherLabels;
  const rows: [string, WeatherCondition[]][] = [
    [l.clear, ['CLEAR']],
    [l.cloudy, ['CLOUDY', 'DRIZZLE']],
    [l.rain, ['RAIN']],
  ];
  return rows.map(([label, conditions]) => ({
    label,
    hours: weather
      .filter((w) => conditions.includes(w.condition))
      .map((w) => (w.fromTime ? `${w.fromTime.replace(':', '.')}-${(w.toTime ?? '').replace(':', '.')}` : '√'))
      .join(', '),
  }));
}

type LaborLine = { name: string; qty: string | null; unit: string | null };
/**
 * Labor lines split into the template's staff and worker groups (D-084 butir 2); one plain list without a staff list.
 * With `showAllStaff` every staff position is listed, empty when nobody worked, like the printed office form.
 */
export function groupLabor(t: ReportTemplateConfig, labor: LaborLine[]): { title: string; rows: LaborLine[] }[] {
  const names = t.laborGroups.staffNames.map((n) => n.trim()).filter(Boolean);
  const staff = new Set(names.map((n) => n.toLowerCase()));
  if (!staff.size) return [{ title: '', rows: labor }];
  const isStaff = (r: LaborLine) => staff.has(r.name.trim().toLowerCase());
  const present = labor.filter(isStaff);
  const staffRows = t.daily.showAllStaff
    ? names.map((n) => present.find((r) => r.name.trim().toLowerCase() === n.toLowerCase()) ?? { name: n, qty: null, unit: null })
    : present;
  return [
    { title: t.laborGroups.staffTitle, rows: staffRows },
    { title: t.laborGroups.workerTitle, rows: labor.filter((r) => !isStaff(r)) },
  ].filter((g) => g.rows.length || g.title);
}

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
/** Indonesian number words for 0..999 999 (week and month numbers on the office cover, e.g. "20 (DUA PULUH)"). */
export function terbilang(n: number): string {
  if (n < 12) return n === 0 ? 'nol' : ONES[n]!;
  if (n < 20) return `${ONES[n - 10]} belas`;
  if (n < 100) return `${ONES[Math.floor(n / 10)]} puluh${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
  if (n < 200) return `seratus${n % 100 ? ` ${terbilang(n % 100)}` : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ''}`;
  if (n < 2000) return `seribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ''}`;
  return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ''}`;
}
export const numberWithWords = (n: number) => `${n} (${terbilang(n).toUpperCase()})`;

export function roman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

/** One line of the office progress sheet (M.n / B.n): exact decimal strings, formatted by the caller. */
export type OfficeItemLine =
  | { kind: 'heading'; no: string; name: string }
  | {
      kind: 'item';
      no: string;
      name: string;
      unit: string;
      volume: string | null;
      weight: string | null;
      previous: string;
      thisPeriod: string | null;
      cumulative: string;
      percent: string | null;
      share: string | null;
    }
  | { kind: 'total'; name: string; weight: string; share: string };

/**
 * D-085: item rows of the weekly content with a JUMLAH line after each schedule group (as the workbook does),
 * and the grand totals. Bobot terhadap seluruh = item bobot × cumulative / volume.
 */
export function officeItemLines(c: WeeklyReportContent): { lines: OfficeItemLine[]; weight: string; share: string } {
  const weights = c.itemWeights ?? {};
  const groups = new Set(c.recap.filter((r) => r.weight !== null).map((r) => r.id));
  const recapIds = new Set(c.recap.map((r) => r.id));
  const lines: OfficeItemLine[] = [];
  let open = false;
  let gWeight = new Decimal(0);
  let gShare = new Decimal(0);
  let tWeight = new Decimal(0);
  let tShare = new Decimal(0);
  const flush = () => {
    if (open) lines.push({ kind: 'total', name: 'JUMLAH', weight: gWeight.toFixed(), share: gShare.toFixed() });
    open = false;
    gWeight = new Decimal(0);
    gShare = new Decimal(0);
  };
  for (const r of c.items) {
    if (r.rowType !== 'ITEM') {
      if (recapIds.has(r.id)) flush();
      if (groups.has(r.id)) open = true;
      lines.push({ kind: 'heading', no: r.displayNumber ?? '', name: r.description });
      continue;
    }
    const weight = weights[r.id] ?? null;
    const volume = r.baselineVolume === null ? null : new Decimal(r.baselineVolume);
    const share = weight !== null && volume && volume.gt(0) ? new Decimal(weight).times(r.cumulative).div(volume) : null;
    if (weight !== null) {
      gWeight = gWeight.plus(weight);
      tWeight = tWeight.plus(weight);
    }
    if (share) {
      gShare = gShare.plus(share);
      tShare = tShare.plus(share);
    }
    lines.push({
      kind: 'item',
      no: r.displayNumber ?? '',
      name: r.description,
      unit: r.unit ?? '',
      volume: r.baselineVolume,
      weight,
      previous: r.previousCumulative,
      thisPeriod: r.thisWeek?.volume ?? null,
      cumulative: r.cumulative,
      percent: r.percent,
      share: share?.toFixed() ?? null,
    });
  }
  flush();
  return { lines, weight: tWeight.toFixed(), share: tShare.toFixed() };
}
