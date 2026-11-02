import type { WeatherCondition } from './daily-reports.js';
import type { IdentityKey, ReportTemplateConfig } from './report-templates.js';

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
