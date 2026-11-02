import { Decimal } from '@laporan-proyek/calc';
import {
  dailyWeatherRows,
  dayNameId,
  DECIMALS,
  groupLabor,
  identityText,
  longDateId,
  WEATHER_LABELS,
  type ReportIdentity,
  type DailyReportDto,
  type LogoKind,
  type ReportTemplateConfig,
  type WeatherCondition,
  type WeeklyReportContent,
} from '@laporan-proyek/shared';
import type { ReactNode } from 'react';
import { FitToPage } from './fit-to-page';

/**
 * D-082: one renderer for the template preview and the print/PDF page, so what is previewed is what is printed.
 * Layout comes only from the template; the data shapes below are filled from the report DTOs.
 */
export type { ReportIdentity };
type Row = { name: string; qty: string; unit: string | null };
export type DailyDoc = {
  kind: 'DAILY';
  identity: ReportIdentity;
  date: string;
  weekNumber: number;
  labor: Row[];
  work: Row[];
  equipment: Row[];
  materials: Row[];
  weather: {
    condition: WeatherCondition;
    fromTime: string | null;
    toTime: string | null;
    note: string | null;
  }[];
  note: string | null;
};
export type PeriodDoc = { kind: 'WEEKLY' | 'MONTHLY'; label: string; content: WeeklyReportContent };
export type ReportDoc = DailyDoc | PeriodDoc;

const PAGE_MM: Record<ReportTemplateConfig['page']['size'], [number, number]> = {
  A4: [210, 297],
  F4: [215, 330],
  LEGAL: [216, 356],
};
export function pageSize(t: ReportTemplateConfig): { width: number; height: number; css: string } {
  const [w, h] = PAGE_MM[t.page.size];
  const landscape = t.page.orientation === 'landscape';
  return {
    width: landscape ? h : w,
    height: landscape ? w : h,
    css: `${landscape ? h : w}mm ${landscape ? w : h}mm`,
  };
}

const longDate = longDateId;
const dayName = dayNameId;

function num(v: string | null | undefined, dp: number): string {
  if (v === null || v === undefined || v === '') return '';
  const [i, f] = new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp).split('.');
  return `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${f ? `,${f}` : ''}`;
}

const identityValue = identityText;

function Table({
  cols,
  rows,
  foot,
}: {
  cols: { key: string; label: string; num?: boolean }[];
  rows: Record<string, ReactNode>[];
  foot?: ReactNode;
}) {
  return (
    <table className="rd-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} className={c.num ? 'rd-num' : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={cols.length} className="rd-empty">
              –
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i} className={r._heading ? 'rd-heading' : undefined}>
              {cols.map((c) => (
                <td key={c.key} className={c.num ? 'rd-num' : undefined}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      {foot}
    </table>
  );
}

const NUMERIC = new Set([
  'qty',
  'weight',
  'previous',
  'thisPeriod',
  'cumulative',
  'volume',
  'percent',
]);
const visibleCols = (s: ReportTemplateConfig['sections'][number]) =>
  s.columns
    .filter((c) => c.visible)
    .map((c) => ({ key: c.key, label: c.label, num: NUMERIC.has(c.key) }));

function QtyTable({
  section,
  rows,
  dp,
}: {
  section: ReportTemplateConfig['sections'][number];
  rows: Row[];
  dp: number;
}) {
  return (
    <Table
      cols={visibleCols(section)}
      rows={rows.map((r, i) => ({
        no: i + 1,
        name: r.name,
        qty: num(r.qty, dp),
        unit: r.unit ?? '',
      }))}
    />
  );
}

/** Kurva S rencana (dashed amber) vs realisasi (solid blue), print-friendly SVG. */
function Curve({ weeks, upTo }: { weeks: WeeklyReportContent['curve']['weeks']; upTo: number }) {
  const W = 760;
  const H = 190;
  const pad = 26;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, weeks.length - 1);
  const y = (v: string | null) => H - pad - (Number(v ?? 0) / 100) * (H - pad * 2);
  const line = (pick: (w: (typeof weeks)[number]) => string | null) =>
    weeks
      .map((w, i) => [i, pick(w)] as const)
      .filter(([, v]) => v !== null)
      .map(([i, v]) => `${x(i)},${y(v)}`)
      .join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="rd-curve"
      role="img"
      aria-label="Kurva S rencana dan realisasi"
    >
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line
            x1={pad}
            x2={W - pad}
            y1={y(String(p))}
            y2={y(String(p))}
            stroke="#d5dbe3"
            strokeWidth={0.6}
          />
          <text x={4} y={y(String(p)) + 3} fontSize={8} fill="#555">
            {p}%
          </text>
        </g>
      ))}
      {weeks.map((w, i) => (
        <text key={w.weekNumber} x={x(i)} y={H - 8} fontSize={7} fill="#555" textAnchor="middle">
          {w.weekNumber}
        </text>
      ))}
      <line
        x1={x(upTo - 1)}
        x2={x(upTo - 1)}
        y1={pad / 2}
        y2={H - pad}
        stroke="#888"
        strokeDasharray="2 2"
        strokeWidth={0.8}
      />
      <polyline
        points={line((w) => w.plannedCumulative)}
        fill="none"
        stroke="#d97706"
        strokeWidth={1.6}
        strokeDasharray="5 3"
      />
      <polyline
        points={line((w) => w.actualCumulative)}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1.8}
      />
      <g fontSize={8} fill="#222">
        <line
          x1={W - 210}
          x2={W - 190}
          y1={12}
          y2={12}
          stroke="#d97706"
          strokeWidth={1.6}
          strokeDasharray="5 3"
        />
        <text x={W - 186} y={15}>
          Rencana kumulatif
        </text>
        <line x1={W - 110} x2={W - 90} y1={12} y2={12} stroke="#2563eb" strokeWidth={1.8} />
        <text x={W - 86} y={15}>
          Realisasi kumulatif
        </text>
      </g>
    </svg>
  );
}

function DailyBody({ t, d }: { t: ReportTemplateConfig; d: DailyDoc }) {
  const dp = t.decimals;
  return (
    <>
      <table className="rd-meta">
        <tbody>
          <tr>
            <td>MINGGU KE</td>
            <td>: {d.weekNumber}</td>
          </tr>
          <tr>
            <td>TANGGAL</td>
            <td>: {longDate(d.date)}</td>
          </tr>
          <tr>
            <td>HARI</td>
            <td>: {dayName(d.date)}</td>
          </tr>
        </tbody>
      </table>
      <div className="rd-grid">
        {t.sections
          .filter((s) => s.visible)
          .map((s) => (
            <section key={s.key} className={`rd-section rd-${s.key}`}>
              <h3>{s.title}</h3>
              {s.key === 'labor' && <QtyTable section={s} rows={d.labor} dp={0} />}
              {s.key === 'work' && <QtyTable section={s} rows={d.work} dp={dp} />}
              {s.key === 'equipment' && <QtyTable section={s} rows={d.equipment} dp={dp} />}
              {s.key === 'materials' && <QtyTable section={s} rows={d.materials} dp={dp} />}
              {s.key === 'weather' &&
                (d.weather.length === 0 ? (
                  <p className="rd-empty">–</p>
                ) : (
                  <Table
                    cols={[
                      { key: 'c', label: 'KONDISI' },
                      { key: 'h', label: 'DARI JAM S.D JAM' },
                      { key: 'n', label: 'KETERANGAN' },
                    ]}
                    rows={d.weather.map((w) => ({
                      c: WEATHER_LABELS[w.condition].toUpperCase(),
                      h: w.fromTime ? `${w.fromTime} s.d ${w.toTime ?? ''}` : '',
                      n: w.note ?? '',
                    }))}
                  />
                ))}
              {s.key === 'note' && <p className="rd-note">{d.note || '–'}</p>}
            </section>
          ))}
      </div>
    </>
  );
}

function PeriodBody({ t, d }: { t: ReportTemplateConfig; d: PeriodDoc }) {
  const c = d.content;
  const dp = t.decimals;
  // Bobot (% of project weight) follows D-083; volumes follow the template's decimals.
  const pct = (v: string | null) => (v === null ? '–' : `${num(v, DECIMALS.weight)}%`);
  const w = DECIMALS.weight;
  return (
    <>
      <table className="rd-meta">
        <tbody>
          <tr>
            <td>{d.kind === 'WEEKLY' ? 'MINGGU KE' : 'BULAN KE'}</td>
            <td>: {d.label}</td>
          </tr>
          <tr>
            <td>DARI TANGGAL</td>
            <td>: {longDate(c.week.startDate)}</td>
          </tr>
          <tr>
            <td>SAMPAI DENGAN</td>
            <td>: {longDate(c.week.endDate)}</td>
          </tr>
        </tbody>
      </table>
      {t.sections
        .filter((s) => s.visible)
        .map((s) => (
          <section key={s.key} className={`rd-section rd-${s.key}`}>
            <h3>{s.title}</h3>
            {s.key === 'summary' && (
              <table className="rd-totals">
                <tbody>
                  <tr>
                    <td>REALISASI PROGRES</td>
                    <td>: {pct(c.totals.actualCumulative)}</td>
                    <td>TOTAL WAKTU PELAKSANAAN</td>
                    <td>: {c.totals.durationDays} hari</td>
                  </tr>
                  <tr>
                    <td>RENCANA PROGRES</td>
                    <td>: {pct(c.totals.plannedCumulative)}</td>
                    <td>TOTAL WAKTU TERPAKAI</td>
                    <td>: {c.totals.usedDays} hari</td>
                  </tr>
                  <tr>
                    <td>DEVIASI</td>
                    <td>: {pct(c.totals.deviation)}</td>
                    <td>SISA WAKTU PELAKSANAAN</td>
                    <td>: {c.totals.remainingDays} hari</td>
                  </tr>
                </tbody>
              </table>
            )}
            {s.key === 'recap' && (
              <Table
                cols={visibleCols(s)}
                rows={c.recap.map((r) =>
                  r.weight === null
                    ? { _heading: true, no: r.displayNumber, name: r.description }
                    : {
                        no: r.displayNumber,
                        name: r.description,
                        weight: num(r.weight, w),
                        previous: num(r.previous, w),
                        thisPeriod: num(r.thisWeek, w),
                        cumulative: num(r.cumulative, w),
                        note: '',
                      },
                )}
                foot={
                  <tfoot>
                    <tr>
                      {visibleCols(s).map((col) => (
                        <td key={col.key} className={col.num ? 'rd-num' : undefined}>
                          {col.key === 'name'
                            ? 'JUMLAH'
                            : col.key === 'weight' ||
                                col.key === 'previous' ||
                                col.key === 'thisPeriod' ||
                                col.key === 'cumulative'
                              ? num(
                                  c.recap
                                    .reduce(
                                      (sum, r) =>
                                        sum.plus(
                                          (col.key === 'thisPeriod'
                                            ? r.thisWeek
                                            : r[col.key as 'weight']) ?? 0,
                                        ),
                                      new Decimal(0),
                                    )
                                    .toFixed(),
                                  w,
                                )
                              : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                }
              />
            )}
            {s.key === 'curve' && <Curve weeks={c.curve.weeks} upTo={c.week.weekNumber} />}
            {s.key === 'items' && (
              <Table
                cols={visibleCols(s)}
                rows={c.items.map((r) =>
                  r.rowType !== 'ITEM'
                    ? { _heading: true, no: r.displayNumber, name: r.description }
                    : {
                        no: r.displayNumber,
                        name: r.description,
                        unit: r.unit ?? '',
                        volume: num(r.baselineVolume, dp),
                        previous: r.workItemId ? num(r.previousCumulative, dp) : '',
                        thisPeriod: r.thisWeek ? num(r.thisWeek.volume, dp) : '',
                        cumulative: r.workItemId ? num(r.cumulative, dp) : '',
                        percent: r.percent === null ? '' : num(r.percent, 2),
                      },
                )}
              />
            )}
            {s.key === 'daily' && (
              <div className="rd-grid">
                <Table
                  cols={[
                    { key: 'name', label: 'TENAGA KERJA' },
                    { key: 'qty', label: 'ORANG-HARI', num: true },
                  ]}
                  rows={c.daily.labor.map((l) => ({ name: l.name, qty: num(l.total, 0) }))}
                />
                <Table
                  cols={[
                    { key: 'name', label: 'BAHAN / ALAT' },
                    { key: 'qty', label: 'JUMLAH', num: true },
                    { key: 'unit', label: 'SAT' },
                  ]}
                  rows={c.daily.resources.map((r) => ({
                    name: r.name,
                    qty: num(r.total, dp),
                    unit: r.unit ?? '',
                  }))}
                />
                <p className="rd-note">
                  Cuaca:{' '}
                  {c.daily.weather.length
                    ? c.daily.weather
                        .map((w) => `${WEATHER_LABELS[w.condition]} ${w.days} hari`)
                        .join(', ')
                    : '–'}
                  . Hari hujan/gerimis: {c.daily.rainDays}.
                </p>
              </div>
            )}
          </section>
        ))}
    </>
  );
}

/** D-084: office daily format, four tables side by side on one landscape page. */
function DailyColumns({
  t,
  d,
  logoUrl,
}: {
  t: ReportTemplateConfig;
  d: DailyDoc;
  logoUrl: (kind: LogoKind) => string | null;
}) {
  const size = pageSize(t);
  const f = t.daily;
  const tables = t.sections
    .filter((s) => s.visible && ['labor', 'equipment', 'materials', 'work'].includes(s.key))
    .map((s) => ({ ...s, cols: s.columns.filter((c) => c.visible) }))
    .filter((s) => s.cols.length > 0);
  const weather = t.sections.find((s) => s.key === 'weather' && s.visible);
  const note = t.sections.find((s) => s.key === 'note' && s.visible);
  const logos = (['AGENCY', 'CONSULTANT', 'CONTRACTOR'] as const)
    .map((k) => ({ kind: k, url: logoUrl(k), caption: t.header.logoCaptions[k] }))
    .filter((l) => t.header.showLogos && l.caption.trim());

  // One line per table row: either a data row or a group heading spanning that table.
  type Line =
    | { row: Row | { name: string; qty: string | null; unit: string | null }; n: number }
    | { heading: string };
  const linesOf = (key: string): Line[] => {
    if (key === 'labor')
      return groupLabor(t, d.labor).flatMap((g) => [
        ...(g.title ? [{ heading: g.title }] : []),
        ...g.rows.map((row, i) => ({ row, n: i + 1 })),
      ]);
    const rows = key === 'equipment' ? d.equipment : key === 'materials' ? d.materials : d.work;
    return rows.map((row, i) => ({ row, n: i + 1 }));
  };
  const lines = Object.fromEntries(tables.map((s) => [s.key, linesOf(s.key)]));
  const hasLabor = tables.some((s) => s.key === 'labor');
  // Every table is padded to the longest one, as in the workbook; the labor total takes the last line.
  const height = Math.max(f.minRows, ...tables.map((s) => lines[s.key]!.length));

  // Column widths in % of the page: number columns are the same in every table, name columns share the rest by table width.
  const fixed: Record<string, number> = { no: 2.6, qty: 4.6, unit: 3.4 };
  const totalWidth = tables.reduce((sum, s) => sum + (s.width ?? 70), 0);
  const rest =
    100 - tables.reduce((sum, s) => sum + s.cols.reduce((a, c) => a + (fixed[c.key] ?? 0), 0), 0);
  const widths = tables.flatMap((s) =>
    s.cols.map((c) =>
      c.key === 'name' ? Math.max(4, (rest * (s.width ?? 70)) / totalWidth) : fixed[c.key]!,
    ),
  );
  const sum = widths.reduce((a, b) => a + b, 0);

  const cells = (s: (typeof tables)[number], line: Line | undefined) => {
    const first = (j: number) => (j === 0 ? 'rd-dsec' : undefined);
    if (line && 'heading' in line)
      return [
        <td key={`${s.key}h`} colSpan={s.cols.length} className={`rd-dsec rd-dgroup`}>
          {line.heading}
        </td>,
      ];
    return s.cols.map((c, j) => {
      const cls = [
        first(j),
        c.key === 'no' || c.key === 'qty' ? 'rd-num' : c.key === 'unit' ? 'rd-center' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const v = !line
        ? ' '
        : c.key === 'no'
          ? line.n
          : c.key === 'name'
            ? line.row.name
            : c.key === 'qty'
              ? num(line.row.qty, s.key === 'labor' ? 0 : t.decimals)
              : (line.row.unit ?? '');
      return (
        <td key={`${s.key}${c.key}`} className={cls || undefined}>
          {v}
        </td>
      );
    });
  };

  return (
    <article
      className="report-doc rd-daily"
      style={{
        width: `${size.width}mm`,
        height: f.fitToPage ? `${size.height}mm` : undefined,
        minHeight: `${size.height}mm`,
        padding: `${t.page.marginMm}mm`,
        fontSize: `${t.page.fontSizePt}pt`,
      }}
    >
      <FitToPage heightMm={size.height - 2 * t.page.marginMm} enabled={f.fitToPage}>
        {t.header.lines.length > 0 && (
          <header className="rd-kop">
            {t.header.lines.map((line, i) => (
              <p key={i} className={i === 0 ? 'rd-kop-main' : undefined}>
                {line}
              </p>
            ))}
          </header>
        )}
        <div className="rd-dhead">
          <table className="rd-identity">
            <tbody>
              {t.identity
                .filter((x) => x.visible)
                .map((x) => (
                  <tr key={x.key}>
                    <td>{x.label}</td>
                    <td>: {identityValue(d.identity, x.key)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="rd-dlogos">
            {logos.map((l) => (
              <figure key={l.kind} className="rd-dlogo">
                <figcaption>{l.caption}</figcaption>
                {l.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private API image, printed as-is
                  <img src={l.url} alt={l.caption} style={{ height: `${f.logoHeightMm}mm` }} />
                ) : (
                  <span style={{ height: `${f.logoHeightMm}mm` }} />
                )}
              </figure>
            ))}
          </div>
          <div className="rd-dtitle">
            <h2>{t.title}</h2>
            <table className="rd-meta">
              <tbody>
                <tr>
                  <td>{f.weekLabel}</td>
                  <td>: {d.weekNumber}</td>
                </tr>
                <tr>
                  <td>{f.dayLabel}</td>
                  <td>: {dayName(d.date)}</td>
                </tr>
                <tr>
                  <td>{f.dateLabel}</td>
                  <td>: {longDate(d.date)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {tables.length > 0 && (
          <table className="rd-table rd-dgrid">
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: `${(w / sum) * 100}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {tables.map((s) => (
                  <th key={s.key} colSpan={s.cols.length} className="rd-dsec rd-dsec-title">
                    {s.title}
                  </th>
                ))}
              </tr>
              <tr>
                {tables.flatMap((s) =>
                  s.cols.map((c, j) => (
                    <th key={`${s.key}${c.key}`} className={j === 0 ? 'rd-dsec' : undefined}>
                      {c.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: height }, (_, r) => (
                <tr key={r}>{tables.flatMap((s) => cells(s, lines[s.key]![r]))}</tr>
              ))}
              {hasLabor && (
                <tr className="rd-total">
                  {tables.flatMap((s) =>
                    s.cols.map((c, j) => (
                      <td
                        key={`t${s.key}${c.key}`}
                        className={
                          [
                            j === 0 ? 'rd-dsec' : '',
                            c.key === 'qty' ? 'rd-num' : c.key === 'unit' ? 'rd-center' : '',
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                      >
                        {s.key !== 'labor'
                          ? ' '
                          : c.key === 'name'
                            ? f.totalLabel
                            : c.key === 'qty'
                              ? num(
                                  d.labor
                                    .reduce((acc, x) => acc.plus(x.qty), new Decimal(0))
                                    .toFixed(),
                                  0,
                                )
                              : c.key === 'unit'
                                ? f.totalUnit
                                : ''}
                      </td>
                    )),
                  )}
                </tr>
              )}
            </tbody>
          </table>
        )}

        {(weather || note) && (
          <div
            className="rd-dfoot"
            style={{ gridTemplateColumns: weather && note ? '1fr 1.4fr' : '1fr' }}
          >
            {weather && (
              <table className="rd-table rd-dweather">
                <tbody>
                  {dailyWeatherRows(t, d.weather).map((w, i) => (
                    <tr key={i}>
                      {i === 0 && (
                        <th rowSpan={3} scope="row">
                          {weather.title}
                        </th>
                      )}
                      <td>{w.label}</td>
                      <td>{w.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {note && (
              <table className="rd-table rd-dnote">
                <tbody>
                  <tr>
                    <th scope="col">{note.title}</th>
                  </tr>
                  <tr>
                    <td>{d.note || ' '}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {t.signatures.length > 0 && (
          <footer
            className="rd-signatures rd-dsigs"
            style={{ gridTemplateColumns: `repeat(${t.signatures.length}, 1fr)` }}
          >
            {t.signatures.map((sg, i) => (
              <div key={i}>
                <p>{sg.caption || ' '}</p>
                <p className="rd-sig-role">{sg.role}</p>
                <p>{sg.organization || ' '}</p>
                <p className="rd-sig-name">
                  {sg.name || '(........................................)'}
                </p>
                <p>{sg.detail}</p>
              </div>
            ))}
          </footer>
        )}
      </FitToPage>
    </article>
  );
}

export function ReportDocument({
  template: t,
  doc,
  logoUrl,
}: {
  template: ReportTemplateConfig;
  doc: ReportDoc;
  logoUrl: (kind: LogoKind) => string | null;
}) {
  if (doc.kind === 'DAILY' && t.layout === 'columns')
    return <DailyColumns t={t} d={doc} logoUrl={logoUrl} />;
  const identity = doc.kind === 'DAILY' ? doc.identity : doc.content.project;
  const size = pageSize(t);
  const logos = (['AGENCY', 'CONSULTANT', 'CONTRACTOR'] as const).map((k) => ({
    kind: k,
    url: logoUrl(k),
    caption: t.header.logoCaptions[k],
  }));
  return (
    <article
      className="report-doc"
      style={{
        width: `${size.width}mm`,
        minHeight: `${size.height}mm`,
        padding: `${t.page.marginMm}mm`,
        fontSize: `${t.page.fontSizePt}pt`,
      }}
    >
      {t.header.showLogos && logos.some((l) => l.url) && (
        <div className="rd-logos">
          {logos.map((l) => (
            <figure key={l.kind}>
              {/* eslint-disable-next-line @next/next/no-img-element -- private API image, printed as-is */}
              {l.url ? <img src={l.url} alt={l.caption} /> : <span />}
              <figcaption>{l.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {t.header.lines.length > 0 && (
        <header className="rd-kop">
          {t.header.lines.map((line, i) => (
            <p key={i} className={i === 0 ? 'rd-kop-main' : undefined}>
              {line}
            </p>
          ))}
        </header>
      )}
      <h2 className="rd-title">{t.title}</h2>
      <table className="rd-identity">
        <tbody>
          {t.identity
            .filter((f) => f.visible)
            .map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td>: {identityValue(identity, f.key)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {doc.kind === 'DAILY' ? <DailyBody t={t} d={doc} /> : <PeriodBody t={t} d={doc} />}
      {t.signatures.length > 0 && (
        <footer
          className="rd-signatures"
          style={{ gridTemplateColumns: `repeat(${t.signatures.length}, 1fr)` }}
        >
          {t.signatures.map((s, i) => (
            <div key={i}>
              <p>{s.caption || ' '}</p>
              <p className="rd-sig-role">{s.role}</p>
              <p>{s.organization || ' '}</p>
              <p className="rd-sig-name">
                {s.name || '(........................................)'}
              </p>
              <p>{s.detail}</p>
            </div>
          ))}
        </footer>
      )}
    </article>
  );
}

/** Daily DTO -> document data; only lines with an actual quantity are printed. */
export function dailyDoc(identity: ReportIdentity, r: DailyReportDto): DailyDoc {
  const lines = (category: 'LABOR' | 'MATERIAL' | 'EQUIPMENT') =>
    r.resources
      .filter((x) => x.category === category && x.actual && Number(x.actual) > 0)
      .map((x) => ({ name: x.name, qty: x.actual!, unit: x.unit }));
  return {
    kind: 'DAILY',
    identity,
    date: r.date,
    weekNumber: r.week.weekNumber,
    labor: lines('LABOR'),
    work: r.work.map((w) => ({ name: w.description, qty: w.volume, unit: w.unit })),
    equipment: lines('EQUIPMENT'),
    materials: lines('MATERIAL'),
    weather: r.weather,
    note: r.note,
  };
}
