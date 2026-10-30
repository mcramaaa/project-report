'use client';

import { Decimal, SCHEDULE_TOLERANCE } from '@laporan-proyek/calc';
import type { SCurveDto } from '@laporan-proyek/shared';
import { Fragment, useMemo, useState } from 'react';
import { Badge, Button, Section, Select } from '@/components/ui';
import { formatRounded } from '@/lib/project-fields';
import { GroupDetail } from './group-detail';

const pct = (v: Decimal | string | null) =>
  v === null ? '–' : `${formatRounded(new Decimal(v).toFixed(), 3)}%`;
type Status = 'behind' | 'on-track' | 'ahead' | 'not-started' | 'done';
/** D-077 butir 4: a group's state through the analysis week (tolerance as D-072). */
const STATUS: Record<Status, { label: string; tone: 'red' | 'green' | 'blue' | 'slate' }> = {
  behind: { label: 'Terlambat', tone: 'red' },
  'on-track': { label: 'Sesuai rencana', tone: 'green' },
  ahead: { label: 'Lebih cepat', tone: 'blue' },
  'not-started': { label: 'Belum dijadwalkan', tone: 'slate' },
  done: { label: 'Selesai', tone: 'green' },
};
const SORTS = {
  deviation: 'Paling terlambat dulu',
  ahead: 'Paling cepat dulu',
  weight: 'Bobot terbesar dulu',
  rab: 'Urutan RAB',
} as const;
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
  const tol = new Decimal(SCHEDULE_TOLERANCE);
  let section: SCurveDto['rows'][number] | null = null;
  return data.rows
    .flatMap((r, order) => {
      // Rows come in RAB order: a heading (weight null) names the section of the groups below it.
      if (r.weight === null) {
        section = r;
        return [];
      }
      if (!r.displayNumber?.includes('.')) section = null; // a top-level SECTION group (e.g. A) is its own section
      const planned = sum(r.planned);
      const actual = sum(r.actual);
      const weight = new Decimal(r.weight);
      const deviation = actual.minus(planned);
      const status: Status = actual.gte(weight.minus(tol))
        ? 'done'
        : planned.lte(tol) && actual.lte(tol)
          ? 'not-started'
          : deviation.lt(tol.neg())
            ? 'behind'
            : deviation.gt(tol)
              ? 'ahead'
              : 'on-track';
      const s = section ?? r;
      return [
        {
          row: r,
          order,
          section: { id: s.id, label: `${s.displayNumber ?? ''} ${s.description}`.trim() },
          planned,
          actual,
          deviation,
          weight,
          status,
        },
      ];
    })
    .sort((a, b) => a.deviation.comparedTo(b.deviation));
}

/** D-077: which groups cause the deviation, and what it takes to finish on time. */
export function ScheduleAnalysis({ data, projectId }: { data: SCurveDto; projectId: string }) {
  const started = data.weeks.filter((w) => w.actual !== null);
  const [week, setWeek] = useState(() => defaultAnalysisWeek(data));
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [sort, setSort] = useState<keyof typeof SORTS>('deviation');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const groups = useMemo(() => groupDeviations(data, week), [data, week]);
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

  const sections = [...new Map(groups.map((g) => [g.section.id, g.section.label])).entries()];
  const q = search.trim().toLowerCase();
  const inScope = groups.filter(
    (g) =>
      (!section || g.section.id === section) &&
      (!q || `${g.row.displayNumber ?? ''} ${g.row.description}`.toLowerCase().includes(q)),
  );
  const counts = Object.fromEntries(
    (Object.keys(STATUS) as Status[]).map((k) => [k, inScope.filter((g) => g.status === k).length]),
  ) as Record<Status, number>;
  const shown = inScope
    .filter((g) => !status || g.status === status)
    .sort((a, b) =>
      sort === 'ahead'
        ? b.deviation.comparedTo(a.deviation)
        : sort === 'weight'
          ? b.weight.comparedTo(a.weight)
          : sort === 'rab'
            ? a.order - b.order
            : 0,
    );
  const filtered = Boolean(q || section || status || sort !== 'deviation');

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

        <details className="analysis-help">
          <summary className="link-button cursor-pointer">Cara membaca kartu ini</summary>
          <ul>
            <li>
              Semua angka dalam <b>% bobot proyek</b> (seluruh pekerjaan = 100%), dihitung sampai
              akhir minggu yang dipilih di kanan atas. Bawaannya minggu laporan terakhir, karena
              minggu yang belum diisi progresnya akan terlihat terlambat.
            </li>
            <li>
              <b>Deviasi</b> = realisasi − rencana. Minus (merah) berarti tertinggal dari jadwal;
              plus berarti lebih cepat. Deviasi proyek adalah jumlah deviasi semua kelompok, jadi
              kelompok dengan minus terbesar adalah penyebab utama keterlambatan.
            </li>
            <li>
              <b>Harus dicapai per minggu</b> = sisa pekerjaan dibagi minggu tersisa. Bandingkan
              dengan <b>laju 4 minggu terakhir</b>: bila laju lebih kecil (angka merah), proyek
              perlu dipercepat. <b>Prakiraan selesai</b> memakai laju itu.
            </li>
            <li>
              <b>Progres kelompok</b>: bilah biru = bagian kelompok yang sudah dikerjakan, garis
              jingga = posisi yang seharusnya menurut jadwal. Biru belum sampai garis jingga berarti
              kelompok itu tertinggal.
            </li>
          </ul>
        </details>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Deviasi per kelompok s.d. M.{week}</h3>
          <div className="analysis-filters" role="search">
            <input
              className="field"
              type="search"
              aria-label="Cari kelompok pekerjaan"
              placeholder="Cari pekerjaan, mis. beton"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label="Bagian"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Semua bagian</option>
              {sections.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Urutkan"
              value={sort}
              onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}
            >
              {Object.entries(SORTS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
            {filtered && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setSection('');
                  setStatus('');
                  setSort('deviation');
                }}
              >
                Hapus filter
              </Button>
            )}
          </div>
          <div className="analysis-chips" role="group" aria-label="Status kelompok">
            <button type="button" aria-pressed={status === ''} onClick={() => setStatus('')}>
              Semua <span>{inScope.length}</span>
            </button>
            {(Object.keys(STATUS) as Status[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={status === k}
                disabled={!counts[k]}
                onClick={() => setStatus(status === k ? '' : k)}
              >
                {STATUS[k].label} <span>{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Kelompok
                  </th>
                  <th role="columnheader" scope="col">
                    Status
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
                    <Fragment key={g.row.id}>
                      <tr role="row">
                        <td role="cell" data-label="Kelompok">
                          {/* One element: on phones the cell is a flex row and would split loose text. */}
                          <span>
                            <button
                              type="button"
                              className="rab-toggle"
                              aria-expanded={open.has(g.row.id)}
                              aria-label={`${open.has(g.row.id) ? 'Tutup' : 'Lihat'} rincian ${g.row.displayNumber ?? ''} ${g.row.description}`}
                              onClick={() => toggle(g.row.id)}
                            >
                              <span aria-hidden="true">{open.has(g.row.id) ? '▾' : '▸'}</span>
                            </button>
                            <b>{g.row.displayNumber}</b> {g.row.description}
                          </span>
                        </td>
                        <td role="cell" data-label="Status">
                          <Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge>
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
                            {formatRounded(done.toFixed(), 0)}% / {formatRounded(plan.toFixed(), 0)}
                            %
                          </span>
                        </td>
                      </tr>
                      {open.has(g.row.id) && (
                        <tr role="row" className="group-detail-row">
                          <td role="cell" colSpan={7}>
                            <GroupDetail projectId={projectId} groupId={g.row.id} week={week} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {shown.length === 0 && (
                  <tr role="row">
                    <td role="cell" colSpan={7} className="text-center text-slate-500">
                      Tidak ada kelompok yang cocok dengan filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Deviasi dalam % bobot proyek. Progres kelompok: realisasi / rencana terhadap bobot
            kelompok itu (garis tegak = posisi rencana).
          </p>
        </div>
      </div>
    </Section>
  );
}
