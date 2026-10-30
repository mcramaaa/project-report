'use client';

import type { SCurveDto } from '@laporan-proyek/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate, formatRounded } from '@/lib/project-fields';
import { defaultAnalysisWeek, groupDeviations } from './schedule-analysis';

// Validated pair (dataviz validator, light surface): plan is also dashed, so identity never rests on color alone.
const PLAN = '#d97706';
const ACTUAL = '#2563eb';
const ROMAN = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
];
const num = (v: string | null) => (v === null || Number(v) === 0 ? '' : formatRounded(v, 3));
const pct = (v: string | null) => (v === null ? '–' : `${formatRounded(v, 3)}%`);
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

type Box = { left: number; top: number; width: number; height: number };

/** Fixed column widths (No, Pekerjaan, Bobot, right axis) for "fit to card" and the full-detail sheet. */
const FIT = { no: 40, desc: 190, weight: 54, axis: 34 };
const DETAIL = { no: 44, desc: 230, weight: 62, axis: 40, week: 50 };
/** Decimals that fit a week column of this width at 11px. */
const decimalsFor = (week: number) => (week >= 48 ? 3 : week >= 38 ? 2 : week >= 28 ? 1 : 0);

/**
 * D-076: the office "Curva S" sheet — groups × weeks with the planned % per week, plan/actual/deviation rows below,
 * and the cumulative curves drawn over the week columns on a 0–100% scale.
 */
export function SCurveSheet({ data }: { data: SCurveDto }) {
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const foot = useRef<HTMLTableSectionElement>(null);
  const firstWeek = useRef<HTMLTableCellElement>(null);
  const [box, setBox] = useState<Box>();
  const [hover, setHover] = useState<number>();
  const [detail, setDetail] = useState(false);
  const [available, setAvailable] = useState(0);
  /** Widths the user dragged; they win over fit/detail until reset by double-click. */
  const [sizes, setSizes] = useState<{ desc?: number; week?: number }>({});
  const [pointer, setPointer] = useState<{ x: number; y: number; row?: number }>();
  const [full, setFull] = useState(false);
  const n = data.weeks.length;
  // D-077 butir 2: groups behind plan at the last reported week are marked in the sheet.
  const [behind] = useState(
    () =>
      new Set(
        groupDeviations(data, defaultAnalysisWeek(data))
          .filter((g) => g.deviation.lt(0))
          .map((g) => g.row.id),
      ),
  );
  const base = detail ? DETAIL : FIT;
  const desc = sizes.desc ?? base.desc;
  const cols = {
    ...base,
    desc,
    week:
      sizes.week ??
      (detail
        ? DETAIL.week
        : Math.max(16, Math.floor((available - 2 - FIT.no - desc - FIT.weight - FIT.axis) / n))),
  };

  /** Drag the right edge of a header cell to resize; pointer capture keeps the drag outside the cell. */
  const startResize = (key: 'desc' | 'week') => (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = cols[key];
    const [min, max] = key === 'desc' ? [100, 520] : [16, 140];
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setSizes((sz) => ({
        ...sz,
        [key]: Math.min(max, Math.max(min, Math.round(start + ev.clientX - startX))),
      }));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const resetSize = (key: 'desc' | 'week') => () => setSizes((sz) => ({ ...sz, [key]: undefined }));

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen();
  };
  const decimals = decimalsFor(cols.week);
  const showDates = cols.week >= 36;
  const headRows = showDates ? 3 : 2;

  // The curve fills the visible body area between the sticky header and footer, so the whole 0–100% scale stays in
  // view while the rows scroll under it (measured: widths and the scroll position change it).
  const measure = useCallback(() => {
    const sc = scroll.current;
    if (
      !sc ||
      !wrap.current ||
      !head.current ||
      !body.current ||
      !foot.current ||
      !firstWeek.current
    )
      return;
    const w = wrap.current.getBoundingClientRect();
    const f = firstWeek.current.getBoundingClientRect();
    const headH = head.current.getBoundingClientRect().height;
    const visible = sc.clientHeight - headH - foot.current.getBoundingClientRect().height;
    setBox({
      left: f.left - w.left,
      top: sc.scrollTop + headH,
      width: f.width * n,
      height: Math.max(40, Math.min(body.current.getBoundingClientRect().height, visible)),
    });
  }, [n]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (scroll.current) setAvailable(scroll.current.clientWidth);
      measure();
    });
    if (wrap.current) ro.observe(wrap.current);
    if (scroll.current) ro.observe(scroll.current);
    return () => ro.disconnect();
  }, [measure]);

  const periods = Array.from({ length: Math.ceil(n / 4) }, (_, i) => ({
    label: `BULAN ${ROMAN[i] ?? i + 1}`,
    span: Math.min(4, n - i * 4),
  }));
  const footer: [string, (w: SCurveDto['weeks'][number]) => string | null][] = [
    ['Rencana progres', (w) => w.planned],
    ['Rencana kumulatif', (w) => w.plannedCumulative],
    ['Realisasi progres', (w) => w.actual],
    ['Realisasi kumulatif', (w) => w.actualCumulative],
    ['Deviasi', (w) => w.deviation],
  ];
  const onHover = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const week = target.closest<HTMLElement>('[data-week]')?.dataset.week;
    const row = target.closest<HTMLElement>('[data-row]')?.dataset.row;
    setHover(week ? Number(week) : undefined);
    setPointer(
      week
        ? { x: e.clientX, y: e.clientY, row: row === undefined ? undefined : Number(row) }
        : undefined,
    );
  };

  const curve = (key: 'plannedCumulative' | 'actualCumulative') => {
    if (!box) return '';
    const pts = data.weeks.flatMap((w, i) =>
      w[key] === null
        ? []
        : [
            [
              (i + 1) * (box.width / n),
              box.height * (1 - Math.min(Math.max(Number(w[key]), 0), 100) / 100),
            ],
          ],
    );
    return pts.length
      ? `M0,${box.height} ` + pts.map(([x, y]) => `L${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ')
      : '';
  };
  const h = hover === undefined ? undefined : data.weeks[hover - 1];

  const shown = h ?? data.weeks[data.currentWeek - 1];

  const hoveredRow = pointer?.row === undefined ? undefined : data.rows[pointer.row];
  const hoveredPlan = hoveredRow && hover ? hoveredRow.planned[hover - 1] : null;

  return (
    <div className="s-curve-root" ref={root}>
      <div className="s-toolbar">
        {/* Hover readout lives outside the scroll area so it is always in view. */}
        <p className="s-readout" role="status">
          {shown && (
            <>
              <strong>
                M.{shown.weekNumber} ({formatDate(shown.startDate)} – {formatDate(shown.endDate)})
              </strong>
              {' · '}rencana {pct(shown.plannedCumulative)} · realisasi{' '}
              {pct(shown.actualCumulative)}
              {shown.deviation !== null && (
                <>
                  {' · '}deviasi{' '}
                  <span className={shown.deviation.startsWith('-') ? 'text-red-700' : undefined}>
                    {pct(shown.deviation)}
                  </span>
                </>
              )}
            </>
          )}
        </p>
        <div className="row-actions">
          {full && <SCurveLegend />}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setDetail((d) => !d);
              setSizes({});
            }}
          >
            {detail ? 'Muat lebar kartu' : 'Tampilkan angka lengkap'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={toggleFull}
            aria-pressed={full}
          >
            {full ? 'Keluar layar penuh' : 'Layar penuh'}
          </button>
        </div>
      </div>
      <div className="s-sheet-scroll" ref={scroll} onScroll={measure}>
        <div
          className={`s-sheet ${cols.week < 30 ? 's-narrow' : ''}`}
          ref={wrap}
          style={
            {
              '--c1': `${cols.no}px`,
              '--c2': `${cols.desc}px`,
              '--c3': `${cols.weight}px`,
              '--wk': `${cols.week}px`,
              '--ax': `${cols.axis}px`,
            } as React.CSSProperties
          }
          onMouseMove={onHover}
          onMouseLeave={() => {
            setHover(undefined);
            setPointer(undefined);
          }}
        >
          {/* Explicit width: with table-layout fixed, an auto width lets the browser widen columns past their pins. */}
          <table
            className="s-table"
            style={{ width: cols.no + cols.desc + cols.weight + cols.week * n + cols.axis }}
          >
            <colgroup>
              <col className="s-col-no" />
              <col className="s-col-desc" />
              <col className="s-col-weight" />
              {data.weeks.map((w) => (
                <col key={w.weekNumber} className="s-col-week" />
              ))}
              <col className="s-col-axis" />
            </colgroup>
            <thead ref={head}>
              <tr>
                <th rowSpan={headRows}>No</th>
                <th rowSpan={headRows} className="s-resizable">
                  Pekerjaan
                  <span
                    className="s-resize"
                    role="separator"
                    aria-label="Ubah lebar kolom Pekerjaan (klik dua kali: lebar awal)"
                    onPointerDown={startResize('desc')}
                    onDoubleClick={resetSize('desc')}
                  />
                </th>
                <th rowSpan={headRows}>Bobot %</th>
                {periods.map((p) => (
                  <th key={p.label} colSpan={p.span}>
                    {p.label}
                  </th>
                ))}
                <th rowSpan={headRows} aria-label="Skala kumulatif" />
              </tr>
              <tr>
                {data.weeks.map((w, i) => (
                  <th
                    key={w.weekNumber}
                    ref={i === 0 ? firstWeek : undefined}
                    data-week={w.weekNumber}
                    className={`s-resizable ${w.weekNumber === data.currentWeek ? 's-now' : ''}`}
                  >
                    {cols.week >= 30 ? `M.${w.weekNumber}` : w.weekNumber}
                    {/* Any week edge resizes all week columns; they share one width. */}
                    <span
                      className="s-resize"
                      role="separator"
                      aria-label="Ubah lebar kolom minggu (klik dua kali: lebar awal)"
                      onPointerDown={startResize('week')}
                      onDoubleClick={resetSize('week')}
                    />
                  </th>
                ))}
              </tr>
              {showDates && (
                <tr>
                  {data.weeks.map((w) => (
                    <th key={w.weekNumber} data-week={w.weekNumber} className="s-date">
                      {shortDate(w.startDate)}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody ref={body}>
              {data.rows.map((r, ri) => (
                <tr
                  key={r.id}
                  data-row={ri}
                  className={
                    r.weight === null ? 's-heading' : behind.has(r.id) ? 's-behind' : undefined
                  }
                >
                  <td>{r.displayNumber ?? ''}</td>
                  <td className="s-desc" title={r.description}>
                    {r.description}
                  </td>
                  <td className="num">{r.weight === null ? '' : formatRounded(r.weight, 3)}</td>
                  {r.planned.map((v, i) => (
                    <td
                      key={i}
                      data-week={i + 1}
                      className={`num ${v !== null && Number(v) > 0 ? 's-planned' : ''}`}
                    >
                      {/* Narrow columns keep the shading only; the value is in the title and the detail view. */}
                      {decimals === 3 ? num(v) : ''}
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
            <tfoot ref={foot}>
              {footer.map(([label, value]) => (
                <tr key={label}>
                  <th colSpan={3} scope="row">
                    {label}
                  </th>
                  {data.weeks.map((w) => {
                    const v = value(w);
                    return (
                      <td
                        key={w.weekNumber}
                        data-week={w.weekNumber}
                        className={`num ${label === 'Deviasi' && v?.startsWith('-') ? 'text-red-700' : ''}`}
                      >
                        {v === null ? '' : formatRounded(v, decimals)}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            </tfoot>
          </table>
          {box && (
            <svg
              className="s-overlay"
              style={{ left: box.left, top: box.top }}
              width={box.width + cols.axis}
              height={box.height}
              aria-hidden="true"
            >
              {[0, 25, 50, 75, 100].map((t) => (
                <text
                  key={t}
                  x={box.width + 6}
                  y={Math.min(Math.max(box.height * (1 - t / 100), 7), box.height - 7)}
                  dominantBaseline="middle"
                  className="s-axis"
                >
                  {t}%
                </text>
              ))}
              <line
                x1={data.currentWeek * (box.width / n)}
                x2={data.currentWeek * (box.width / n)}
                y1={0}
                y2={box.height}
                className="s-today"
              />
              {hover !== undefined && (
                <line
                  x1={hover * (box.width / n)}
                  x2={hover * (box.width / n)}
                  y1={0}
                  y2={box.height}
                  className="s-cross"
                />
              )}
              <path
                d={curve('plannedCumulative')}
                fill="none"
                stroke={PLAN}
                strokeWidth="2"
                strokeDasharray="6 4"
                strokeLinejoin="round"
              />
              <path
                d={curve('actualCumulative')}
                fill="none"
                stroke={ACTUAL}
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {h &&
                (['plannedCumulative', 'actualCumulative'] as const).map((k) =>
                  h[k] === null ? null : (
                    <circle
                      key={k}
                      cx={hover! * (box.width / n)}
                      cy={box.height * (1 - Math.min(Math.max(Number(h[k]), 0), 100) / 100)}
                      r="4"
                      fill={k === 'plannedCumulative' ? PLAN : ACTUAL}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                  ),
                )}
            </svg>
          )}
        </div>
      </div>
      {h && pointer && (
        // Fixed to the viewport at the cursor, so it never scrolls out of view.
        <div className="s-tip" role="status" style={{ left: pointer.x + 14, top: pointer.y + 14 }}>
          <strong>
            M.{h.weekNumber} · {formatDate(h.startDate)} – {formatDate(h.endDate)}
          </strong>
          {hoveredRow && hoveredRow.weight !== null && (
            <span className="s-tip-row">
              {hoveredRow.displayNumber} {hoveredRow.description}: rencana{' '}
              {pct(hoveredPlan && Number(hoveredPlan) > 0 ? hoveredPlan : '0')}
            </span>
          )}
          <span>
            Rencana minggu ini {pct(h.planned)} · kumulatif {pct(h.plannedCumulative)}
          </span>
          <span>
            Realisasi minggu ini {pct(h.actual)} · kumulatif {pct(h.actualCumulative)}
          </span>
          {h.deviation !== null && (
            <span>
              Deviasi{' '}
              <span className={h.deviation.startsWith('-') ? 'text-red-700' : undefined}>
                {pct(h.deviation)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function SCurveLegend() {
  return (
    <span className="s-legend" aria-hidden="true">
      <span>
        <svg width="22" height="8">
          <line x1="0" y1="4" x2="22" y2="4" stroke={PLAN} strokeWidth="2" strokeDasharray="5 3" />
        </svg>
        Rencana kumulatif
      </span>
      <span>
        <svg width="22" height="8">
          <line x1="0" y1="4" x2="22" y2="4" stroke={ACTUAL} strokeWidth="2" />
        </svg>
        Realisasi kumulatif
      </span>
    </span>
  );
}
