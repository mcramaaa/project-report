import {
  DECIMALS,
  identityText,
  longDateId,
  numberWithWords,
  officeItemLines,
  REPORT_SECTIONS,
  roman,
  type LogoKind,
  type ReportTemplateConfig,
  type WeeklyReportContent,
} from '@laporan-proyek/shared';
import { Decimal } from '@laporan-proyek/calc';
import type { CSSProperties, ReactNode } from 'react';
import { FitToPage } from './fit-to-page';
import { num as fmt, pageSize } from './report-shared';

/** Numbers as the office workbook shows them (accounting format): zero is "-". */
const num = (v: string | null | undefined, dp: number) =>
  v === null || v === undefined || v === '' ? '' : new Decimal(v).isZero() ? '-' : fmt(v, dp);

type Doc = { kind: 'WEEKLY' | 'MONTHLY'; label: string; content: WeeklyReportContent };
type Section = ReportTemplateConfig['sections'][number];
const W = DECIMALS.weight;
const upper = (d: string) => longDateId(d).toUpperCase();

/**
 * D-085: weekly/monthly report as the office workbook pack (Serangan): cover C.n, rekap RM.n, progress M.n
 * and time schedule, one sheet per page. Visible sections pick the pages and their order.
 */
export function OfficePeriod({
  t,
  d,
  logoUrl,
}: {
  t: ReportTemplateConfig;
  d: Doc;
  logoUrl: (kind: LogoKind) => string | null;
}) {
  const unit = d.kind === 'WEEKLY' ? 'MINGGU' : 'BULAN';
  const pages = t.sections.filter(
    (s) => s.visible && ['cover', 'recap', 'items', 'curve'].includes(s.key),
  );
  return (
    <div className="rd-pack">
      {pages.map((s) =>
        s.key === 'cover' ? (
          <Cover key={s.key} t={t} d={d} s={s} unit={unit} logoUrl={logoUrl} />
        ) : (
          <Sheet key={s.key} t={t} fit={s.key !== 'items'}>
            <Head t={t} d={d} title={s.title} unit={unit} />
            {s.key === 'recap' && <Recap t={t} d={d} s={s} />}
            {s.key === 'items' && <Items t={t} d={d} s={s} />}
            {s.key === 'curve' && (
              <>
                <Schedule d={d} unit={unit} />
                <Signatures t={t} />
              </>
            )}
          </Sheet>
        ),
      )}
    </div>
  );
}

function Sheet({
  t,
  fit,
  orientation,
  className,
  children,
}: {
  t: ReportTemplateConfig;
  fit: boolean;
  orientation?: 'portrait' | 'landscape';
  className?: string;
  children: ReactNode;
}) {
  const size = pageSize(t, orientation);
  return (
    <article
      className={`report-doc rd-sheet ${className ?? ''}`}
      style={{
        width: `${size.width}mm`,
        height: fit ? `${size.height}mm` : undefined,
        minHeight: `${size.height}mm`,
        padding: `${t.page.marginMm}mm`,
        fontSize: `${t.page.fontSizePt}pt`,
      }}
    >
      {fit ? (
        <FitToPage heightMm={size.height - 2 * t.page.marginMm} enabled>
          <div className="rd-frame">{children}</div>
        </FitToPage>
      ) : (
        <div className="rd-frame">{children}</div>
      )}
    </article>
  );
}

function periodRows(d: Doc, unit: string): [string, string][] {
  return [
    [`${unit} KE`, numberWithWords(Number(d.label))],
    ['DARI TANGGAL', upper(d.content.week.startDate)],
    ['SAMPAI DENGAN', upper(d.content.week.endDate)],
  ];
}

/** Title, project identity on the left and the period on the right (rows 3–14 of RM/M/Curva S). */
function Head({
  t,
  d,
  title,
  unit,
}: {
  t: ReportTemplateConfig;
  d: Doc;
  title: string;
  unit: string;
}) {
  return (
    <header className="rd-ohead">
      <h2>{title}</h2>
      <div className="rd-ohead-grid">
        <table className="rd-identity">
          <tbody>
            {t.identity
              .filter((f) => f.visible)
              .map((f) => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td>: {identityText(d.content.project, f.key).toUpperCase()}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <table className="rd-meta">
          <tbody>
            {periodRows(d, unit).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>: {v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </header>
  );
}

function Cover({
  t,
  d,
  s,
  unit,
  logoUrl,
}: {
  t: ReportTemplateConfig;
  d: Doc;
  s: Section;
  unit: string;
  logoUrl: (kind: LogoKind) => string | null;
}) {
  const p = d.content.project;
  const agency = t.header.showLogos ? logoUrl('AGENCY') : null;
  const inline = new Set(['location', 'fiscalYear']);
  return (
    <Sheet t={t} fit orientation="portrait" className="rd-cover">
      {(agency || t.header.lines.length > 0) && (
        <div className="rd-cover-kop">
          {/* eslint-disable-next-line @next/next/no-img-element -- private API image, printed as-is */}
          {agency ? <img src={agency} alt={t.header.logoCaptions.AGENCY || 'Logo'} /> : <span />}
          <div>
            {t.header.lines.map((line, i) => (
              <p key={i} className={i === 0 ? 'rd-kop-main' : undefined}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
      <h2 className="rd-cover-title">{s.title}</h2>
      <p className="rd-cover-week">
        {unit} KE&nbsp;&nbsp;:&nbsp;&nbsp;{numberWithWords(Number(d.label))}
      </p>
      <p className="rd-cover-label">PERIODE</p>
      <p className="rd-cover-period">
        {upper(d.content.week.startDate)}&nbsp;&nbsp;S.D&nbsp;&nbsp;{upper(d.content.week.endDate)}
      </p>
      <div className="rd-cover-box">
        {t.identity
          .filter(
            (f) => f.visible && !['contractor', 'consultant', 'subActivityName'].includes(f.key),
          )
          .map((f) =>
            inline.has(f.key) ? (
              <p key={f.key} className="rd-cover-strong">
                {f.label} : {identityText(p, f.key).toUpperCase()}
              </p>
            ) : (
              <div key={f.key}>
                <p className="rd-cover-strong">{f.label}</p>
                <p>{identityText(p, f.key).toUpperCase()}</p>
              </div>
            ),
          )}
      </div>
      <div className="rd-cover-logos">
        {(['CONSULTANT', 'CONTRACTOR'] as const).map((k) => {
          const url = t.header.showLogos ? logoUrl(k) : null;
          return (
            <figure key={k}>
              <figcaption>
                {t.header.logoCaptions[k] ||
                  (k === 'CONSULTANT' ? p.consultantName : p.contractorName)}
              </figcaption>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- private API image, printed as-is
                <img src={url} alt={t.header.logoCaptions[k]} />
              ) : (
                <span>{k === 'CONSULTANT' ? p.consultantName : p.contractorName}</span>
              )}
            </figure>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Template label and visibility for a column, in the workbook's fixed order. */
function columns(t: ReportTemplateConfig, s: Section) {
  const kind = t.sections.find((x) => x.key === s.key)!;
  const order = REPORT_SECTIONS.WEEKLY.find((x) => x.key === s.key)!.columns.map(([k]) => k);
  return order
    .map((k) => kind.columns.find((c) => c.key === k))
    .filter((c): c is Section['columns'][number] => !!c && c.visible);
}

function Recap({ t, d, s }: { t: ReportTemplateConfig; d: Doc; s: Section }) {
  const c = d.content;
  const cols = columns(t, s);
  const has = (k: string) => cols.some((x) => x.key === k);
  const label = (k: string) => cols.find((x) => x.key === k)?.label ?? '';
  const prestasi = ['previous', 'thisPeriod', 'cumulative'].filter(has);
  const total = (pick: (r: WeeklyReportContent['recap'][number]) => string | null) =>
    c.recap.reduce((sum, r) => sum.plus(pick(r) ?? 0), new Decimal(0)).toFixed();
  const cell = (k: string, r: WeeklyReportContent['recap'][number]) =>
    k === 'no'
      ? r.displayNumber
      : k === 'name'
        ? r.description
        : k === 'note' || r.weight === null
          ? ''
          : num(
              k === 'weight'
                ? r.weight
                : k === 'previous'
                  ? r.previous
                  : k === 'thisPeriod'
                    ? r.thisWeek
                    : r.cumulative,
              W,
            );
  const pct = (v: string | null) => (v === null ? '–' : num(v, W));
  const width: Record<string, number> = {
    no: 6,
    name: 38,
    weight: 11,
    previous: 11,
    thisPeriod: 11,
    cumulative: 11,
    note: 12,
  };
  return (
    <>
      <table className="rd-table rd-otable rd-rtable">
        <colgroup>
          {cols.map((col) => (
            <col key={col.key} style={{ width: `${width[col.key]}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {has('no') && <th rowSpan={2}>{label('no')}</th>}
            {has('name') && <th rowSpan={2}>{label('name')}</th>}
            {has('weight') && <th>RAB {c.baseline?.label ?? ''}</th>}
            {prestasi.length > 0 && <th colSpan={prestasi.length}>PRESTASI PEKERJAAN (%)</th>}
            {has('note') && <th rowSpan={2}>{label('note')}</th>}
          </tr>
          <tr>
            {has('weight') && <th>{label('weight')}</th>}
            {prestasi.map((k) => (
              <th key={k}>{label(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.recap.map((r) => (
            <tr key={r.id} className={r.weight === null ? 'rd-heading' : undefined}>
              {cols.map((col) => (
                <td
                  key={col.key}
                  className={
                    col.key === 'no'
                      ? 'rd-center'
                      : col.key === 'name' || col.key === 'note'
                        ? undefined
                        : 'rd-num'
                  }
                >
                  {cell(col.key, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {cols.map((col) => (
              <td key={col.key} className={col.key === 'name' ? 'rd-center' : 'rd-num'}>
                {col.key === 'name'
                  ? 'JUMLAH'
                  : col.key === 'weight'
                    ? num(
                        total((r) => r.weight),
                        W,
                      )
                    : col.key === 'previous'
                      ? num(
                          total((r) => r.previous),
                          W,
                        )
                      : col.key === 'thisPeriod'
                        ? num(
                            total((r) => r.thisWeek),
                            W,
                          )
                        : col.key === 'cumulative'
                          ? num(
                              total((r) => r.cumulative),
                              W,
                            )
                          : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <table className="rd-osummary">
        <tbody>
          <tr>
            <td>REALISASI PROGRES</td>
            <td>: {pct(c.totals.actualCumulative)}</td>
            <td>%</td>
          </tr>
          <tr>
            <td>RENCANA PROGRES</td>
            <td>: {pct(c.totals.plannedCumulative)}</td>
            <td>%</td>
          </tr>
          <tr>
            <td>DEVIASI</td>
            <td>: {pct(c.totals.deviation)}</td>
            <td>%</td>
          </tr>
          <tr>
            <td>TOTAL WAKTU PELAKSANAAN</td>
            <td>: {c.totals.durationDays}</td>
            <td>hari</td>
          </tr>
          <tr>
            <td>TOTAL WAKTU TERPAKAI</td>
            <td>: {c.totals.usedDays}</td>
            <td>hari</td>
          </tr>
          <tr>
            <td>TOTAL SISA WAKTU PELAKSANAAN</td>
            <td>: {c.totals.remainingDays}</td>
            <td>hari</td>
          </tr>
        </tbody>
      </table>
      <Signatures t={t} />
    </>
  );
}

function Items({ t, d, s }: { t: ReportTemplateConfig; d: Doc; s: Section }) {
  const c = d.content;
  const cols = columns(t, s);
  const has = (k: string) => cols.some((x) => x.key === k);
  const label = (k: string) => cols.find((x) => x.key === k)?.label ?? '';
  const dp = t.decimals;
  const { lines, weight, share } = officeItemLines(c);
  const rab = ['volume', 'weight'].filter(has);
  const vol = ['previous', 'thisPeriod', 'cumulative'].filter(has);
  const prog = ['percent', 'share'].filter(has);
  const nameCols = ['no', 'name', 'unit'].filter(has);
  const numCls = (k: string) =>
    k === 'no' || k === 'unit' ? 'rd-center' : k === 'name' || k === 'note' ? undefined : 'rd-num';
  return (
    <>
      <table className="rd-table rd-otable">
        <thead>
          <tr>
            {nameCols.map((k) => (
              <th key={k} rowSpan={2}>
                {label(k)}
              </th>
            ))}
            {rab.length > 0 && <th colSpan={rab.length}>RAB {c.baseline?.label ?? ''}</th>}
            {vol.length > 0 && <th colSpan={vol.length}>VOLUME PEKERJAAN</th>}
            {prog.length > 0 && <th colSpan={prog.length}>KEMAJUAN (%)</th>}
            {has('note') && <th rowSpan={2}>{label('note')}</th>}
          </tr>
          <tr>
            {[...rab, ...vol, ...prog].map((k) => (
              <th key={k}>{label(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) =>
            l.kind === 'heading' ? (
              <tr key={i} className="rd-heading">
                {cols.map((col) => (
                  <td key={col.key} className={numCls(col.key)}>
                    {col.key === 'no' ? l.no : col.key === 'name' ? l.name : ''}
                  </td>
                ))}
              </tr>
            ) : l.kind === 'total' ? (
              <tr key={i} className="rd-subtotal">
                {cols.map((col) => (
                  <td key={col.key} className={col.key === 'name' ? 'rd-center' : numCls(col.key)}>
                    {col.key === 'name'
                      ? l.name
                      : col.key === 'weight'
                        ? num(l.weight, W)
                        : col.key === 'share'
                          ? num(l.share, W)
                          : ''}
                  </td>
                ))}
              </tr>
            ) : (
              <tr key={i}>
                {cols.map((col) => (
                  <td key={col.key} className={numCls(col.key)}>
                    {col.key === 'no'
                      ? l.no
                      : col.key === 'name'
                        ? l.name
                        : col.key === 'unit'
                          ? l.unit
                          : col.key === 'volume'
                            ? num(l.volume, dp)
                            : col.key === 'weight'
                              ? num(l.weight, W)
                              : col.key === 'previous'
                                ? num(l.previous, dp)
                                : col.key === 'thisPeriod'
                                  ? num(l.thisPeriod, dp)
                                  : col.key === 'cumulative'
                                    ? num(l.cumulative, dp)
                                    : col.key === 'percent'
                                      ? num(l.percent, 2)
                                      : col.key === 'share'
                                        ? num(l.share, W)
                                        : ''}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            {cols.map((col) => (
              <td key={col.key} className={col.key === 'name' ? 'rd-center' : 'rd-num'}>
                {col.key === 'name'
                  ? 'JUMLAH TOTAL'
                  : col.key === 'weight'
                    ? num(weight, W)
                    : col.key === 'share'
                      ? num(share, W)
                      : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <table className="rd-osummary">
        <tbody>
          <tr>
            <td>REALISASI KEMAJUAN PEKERJAAN</td>
            <td>: {num(c.totals.actualCumulative, W)}</td>
            <td>%</td>
          </tr>
          <tr>
            <td>RENCANA KEMAJUAN PEKERJAAN</td>
            <td>
              : {c.totals.plannedCumulative === null ? '–' : num(c.totals.plannedCumulative, W)}
            </td>
            <td>%</td>
          </tr>
          <tr>
            <td>DEVIASI</td>
            <td>: {c.totals.deviation === null ? '–' : num(c.totals.deviation, W)}</td>
            <td>%</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/** Time schedule: planned % per group and week, plan/actual rows, and the S-curve drawn over the week columns. */
function Schedule({ d, unit }: { d: Doc; unit: string }) {
  const curve = d.content.curve;
  const weeks = curve.weeks;
  const n = weeks.length;
  const rows = curve.rows;
  const months = Array.from({ length: Math.ceil(n / 4) }, (_, m) => Math.min(4, n - m * 4));
  // Fixed geometry so the curve can be laid over the body rows: % of table width and row height in mm.
  const fixed = { no: 4, name: 17, weight: 5, note: 6 };
  const weekW = (100 - fixed.no - fixed.name - fixed.weight - fixed.note) / Math.max(1, n);
  const rowMm = 5;
  const headMm = 3 * rowMm;
  const bodyMm = rows.length * rowMm;
  const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const x = (i: number) => (i + 1) * (100 / n);
  const y = (v: string | null) => 100 - Math.min(100, Math.max(0, Number(v ?? 0)));
  const pts = (pick: (w: (typeof weeks)[number]) => string | null) =>
    weeks
      .map((w, i) => [i, pick(w)] as const)
      .filter(([, v]) => v !== null)
      .map(([i, v]) => `${x(i)},${y(v)}`);
  const line = (k: 'plannedCumulative' | 'actualCumulative') =>
    ['0,100', ...pts((w) => w[k])].join(' ');
  const foot: [string, (w: (typeof weeks)[number]) => string | null][] = [
    ['RENCANA PROGRES', (w) => w.planned],
    ['RENCANA KUMULATIF', (w) => w.plannedCumulative],
    ['REALISASI PROGRES', (w) => w.actual],
    ['REALISASI KUMULATIF', (w) => w.actualCumulative],
    ['DEVIASI', (w) => w.deviation],
  ];
  const rowStyle: CSSProperties = { height: `${rowMm}mm` };
  return (
    <div className="rd-schedule">
      <table className="rd-table rd-otable rd-stable">
        <colgroup>
          <col style={{ width: `${fixed.no}%` }} />
          <col style={{ width: `${fixed.name}%` }} />
          <col style={{ width: `${fixed.weight}%` }} />
          {weeks.map((w) => (
            <col key={w.weekNumber} style={{ width: `${weekW}%` }} />
          ))}
          <col style={{ width: `${fixed.note}%` }} />
        </colgroup>
        <thead>
          <tr style={rowStyle}>
            <th rowSpan={3}>NO</th>
            <th rowSpan={3}>PEKERJAAN</th>
            <th rowSpan={3}>BOBOT</th>
            {months.map((span, m) => (
              <th key={m} colSpan={span}>
                BULAN {roman(m + 1)}
              </th>
            ))}
            <th rowSpan={3}>KETERANGAN</th>
          </tr>
          <tr style={rowStyle}>
            {weeks.map((w) => (
              <th
                key={w.weekNumber}
                className={
                  w.weekNumber === Number(d.label) && unit === 'MINGGU' ? 'rd-now' : undefined
                }
              >
                M.{w.weekNumber}
              </th>
            ))}
          </tr>
          <tr style={rowStyle}>
            {weeks.map((w) => (
              <th key={w.weekNumber} className="rd-sdate">
                {ddmm(w.startDate)}
                <br />
                {ddmm(w.endDate)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              style={rowStyle}
              className={r.weight === null ? 'rd-heading' : undefined}
            >
              <td className="rd-center">{r.displayNumber}</td>
              <td className="rd-ellipsis">{r.description}</td>
              <td className="rd-num">{r.weight === null ? '' : num(r.weight, W)}</td>
              {weeks.map((w, i) => (
                <td
                  key={w.weekNumber}
                  className={`rd-num ${r.planned[i] && Number(r.planned[i]) > 0 ? 'rd-plan' : ''}`}
                >
                  {r.planned[i] && Number(r.planned[i]) > 0 ? num(r.planned[i], W) : ''}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          {foot.map(([label, pick], i) => (
            <tr
              key={label}
              style={rowStyle}
              className={['rd-fplan', 'rd-fplan', 'rd-fact', 'rd-fact', 'rd-fdev'][i]}
            >
              <td />
              <td>{label}</td>
              <td className="rd-num">
                {label === 'RENCANA PROGRES'
                  ? num(rows.reduce((s, r) => s.plus(r.weight ?? 0), new Decimal(0)).toFixed(), W)
                  : ''}
              </td>
              {weeks.map((w) => (
                <td key={w.weekNumber} className="rd-num">
                  {num(pick(w), W)}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tfoot>
      </table>
      <svg
        className="rd-scurve"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Kurva S rencana dan realisasi"
        style={{
          left: `${fixed.no + fixed.name + fixed.weight}%`,
          width: `${weekW * n}%`,
          top: `${headMm}mm`,
          height: `${bodyMm}mm`,
        }}
      >
        <polyline
          points={line('plannedCumulative')}
          fill="none"
          stroke="#d97706"
          strokeWidth={1.4}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line('actualCumulative')}
          fill="none"
          stroke="#1d4ed8"
          strokeWidth={1.8}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="rd-slegend">
        <span className="rd-slegend-plan" /> Rencana kumulatif{' '}
        <span className="rd-slegend-actual" /> Realisasi kumulatif
      </p>
    </div>
  );
}

function Signatures({ t }: { t: ReportTemplateConfig }) {
  return (
    <>
      {t.signatures.length > 0 && (
        <footer
          className="rd-signatures rd-osigs"
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
    </>
  );
}
