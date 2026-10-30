'use client';

import { Decimal } from '@laporan-proyek/calc';
import type { SCurveDto } from '@laporan-proyek/shared';
import { useState } from 'react';
import { Badge, Button, Section, Select } from '@/components/ui';
import { formatRounded } from '@/lib/project-fields';

const pct = (v: Decimal | string | null) =>
  v === null ? '–' : `${formatRounded(new Decimal(v).toFixed(), 3)}%`;
const SHOWN = 8;
/** Table cells: the unit is in the header. */
const num = (v: Decimal) => formatRounded(v.toFixed(), 3);

/** D-077 butir 2: the last week with realised progress; the current week before anything is reported. */
export function defaultAnalysisWeek(data: SCurveDto): number {
  const reported = data.weeks
    .filter((w) => w.actual !== null && new Decimal(w.actual).gt(0))
    .at(-1);
  return reported?.weekNumber ?? data.currentWeek;
}

/** Plan and realisation of each group through `week`, most behind first (D-077 butir 1). */
export function groupDeviations(data: SCurveDto, week: number) {
  const sum = (values: (string | null)[]) =>
    values.slice(0, week).reduce((t, v) => t.plus(v ?? 0), new Decimal(0));
  return data.rows
    .filter((r) => r.weight !== null)
    .map((r) => {
      const planned = sum(r.planned);
      const actual = sum(r.actual);
      return {
        row: r,
        planned,
        actual,
        deviation: actual.minus(planned),
        weight: new Decimal(r.weight!),
      };
    })
    .sort((a, b) => a.deviation.comparedTo(b.deviation));
}

/** D-077: which groups cause the deviation, and what it takes to finish on time. */
export function ScheduleAnalysis({ data }: { data: SCurveDto }) {
  const started = data.weeks.filter((w) => w.actual !== null);
  const [week, setWeek] = useState(() => defaultAnalysisWeek(data));
  const [all, setAll] = useState(false);
  if (!started.length) return null;

  const n = data.weeks.length;
  const at = data.weeks[week - 1]!;
  const done = new Decimal(at.actualCumulative ?? 0);
  const remaining = Decimal.max(new Decimal(100).minus(done), 0);
  const weeksLeft = n - week;
  const need = weeksLeft > 0 ? remaining.div(weeksLeft) : null;
  const recent = data.weeks.slice(Math.max(0, week - 4), week);
  const pace = recent.reduce((t, w) => t.plus(w.actual ?? 0), new Decimal(0)).div(recent.length);
  const best = started
    .slice(0, week)
    .reduce(
      (b, w) =>
        new Decimal(w.actual ?? 0).gt(b.value)
          ? { week: w.weekNumber, value: new Decimal(w.actual!) }
          : b,
      { week: 0, value: new Decimal(0) },
    );
  const finish = remaining.isZero()
    ? week
    : pace.gt(0)
      ? week + remaining.div(pace).ceil().toNumber()
      : null;

  const groups = groupDeviations(data, week);
  const behind = groups.filter((g) => g.deviation.lt(0));
  const shown = all ? groups : groups.slice(0, SHOWN);

  return (
    <Section
      className="mt-4"
      id="schedule-analysis"
      title="Analisis keterlambatan"
      description="Kelompok mana yang tertinggal, dan berapa yang harus dikejar agar selesai tepat waktu. Angka bantu, bukan jadwal resmi."
      action={
        <div className="flex items-center gap-2">
          <label htmlFor="analysis-week" className="whitespace-nowrap text-sm text-slate-600">
            s.d. minggu
          </label>
          <Select id="analysis-week" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {started.map((w) => (
              <option key={w.weekNumber} value={w.weekNumber}>
                M.{w.weekNumber}
                {w.weekNumber === defaultAnalysisWeek(data) ? ' (laporan terakhir)' : ''}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <div className="space-y-5">
        <dl className="analysis-stats">
          <div>
            <dt>Realisasi s.d. M.{week}</dt>
            <dd>{pct(done)}</dd>
            <span>
              rencana {pct(at.plannedCumulative)}, deviasi{' '}
              <b className={at.deviation?.startsWith('-') ? 'text-red-700' : undefined}>
                {pct(at.deviation)}
              </b>
            </span>
          </div>
          <div>
            <dt>Sisa pekerjaan</dt>
            <dd>{pct(remaining)}</dd>
            <span>
              {weeksLeft > 0
                ? `${weeksLeft} minggu tersisa (M.${week + 1}–M.${n})`
                : 'masa pelaksanaan sudah habis'}
            </span>
          </div>
          <div>
            <dt>Harus dicapai per minggu</dt>
            <dd className={need && need.gt(pace) ? 'text-red-700' : undefined}>
              {need ? pct(need) : '–'}
            </dd>
            <span>rata-rata agar selesai di M.{n}</span>
          </div>
          <div>
            <dt>Laju 4 minggu terakhir</dt>
            <dd>{pct(pace)}</dd>
            <span>
              tertinggi {pct(best.value)}
              {best.week > 0 && ` (M.${best.week})`}
            </span>
          </div>
          <div>
            <dt>Prakiraan selesai</dt>
            <dd className={finish !== null && finish > n ? 'text-red-700' : undefined}>
              {finish === null ? '–' : `M.${finish}`}
            </dd>
            <span>
              {finish === null
                ? 'laju 4 minggu terakhir 0'
                : finish > n
                  ? `terlambat ${finish - n} minggu dengan laju sekarang`
                  : 'tepat waktu dengan laju sekarang'}
            </span>
          </div>
        </dl>

        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Deviasi per kelompok s.d. M.{week}{' '}
            {behind.length > 0 && <Badge tone="red">{behind.length} kelompok terlambat</Badge>}
          </h3>
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Kelompok
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Bobot %
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Rencana %
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Realisasi %
                  </th>
                  <th role="columnheader" scope="col" className="num">
                    Deviasi %
                  </th>
                  <th role="columnheader" scope="col">
                    Progres kelompok
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {shown.map((g) => {
                  const done = g.weight.gt(0)
                    ? Decimal.min(g.actual.div(g.weight).times(100), 100)
                    : new Decimal(0);
                  const plan = g.weight.gt(0)
                    ? Decimal.min(g.planned.div(g.weight).times(100), 100)
                    : new Decimal(0);
                  return (
                    <tr role="row" key={g.row.id}>
                      <td role="cell" data-label="Kelompok">
                        {/* One element: on phones the cell is a flex row and would split loose text. */}
                        <span>
                          <b>{g.row.displayNumber}</b> {g.row.description}
                        </span>
                      </td>
                      <td role="cell" data-label="Bobot" className="num">
                        {num(g.weight)}
                      </td>
                      <td role="cell" data-label="Rencana" className="num">
                        {num(g.planned)}
                      </td>
                      <td role="cell" data-label="Realisasi" className="num">
                        {num(g.actual)}
                      </td>
                      <td
                        role="cell"
                        data-label="Deviasi"
                        className={`num ${g.deviation.lt(0) ? 'text-red-700' : ''}`}
                      >
                        {num(g.deviation)}
                      </td>
                      <td role="cell" data-label="Progres kelompok">
                        <span
                          className="group-progress"
                          title={`Realisasi ${formatRounded(done.toFixed(), 1)}% dari kelompok; rencana ${formatRounded(plan.toFixed(), 1)}%`}
                        >
                          <span
                            className="group-progress-bar"
                            style={{ width: `${done.toNumber()}%` }}
                          />
                          <span
                            className="group-progress-plan"
                            style={{ left: `${plan.toNumber()}%` }}
                          />
                        </span>
                        <span className="ml-2 whitespace-nowrap text-xs tabular-nums">
                          {formatRounded(done.toFixed(), 0)}% / {formatRounded(plan.toFixed(), 0)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {groups.length > SHOWN && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => setAll((v) => !v)}
            >
              {all ? 'Tampilkan yang paling terlambat saja' : `Tampilkan semua (${groups.length})`}
            </Button>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Deviasi dalam % bobot proyek. Progres kelompok: realisasi / rencana terhadap bobot
            kelompok itu (garis tegak = posisi rencana).
          </p>
        </div>
      </div>
    </Section>
  );
}
