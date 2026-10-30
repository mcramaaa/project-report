'use client';

import {
  addDays,
  Decimal,
  plannedCurve,
  SCHEDULE_TOLERANCE,
  spreadEvenly,
} from '@laporan-proyek/calc';
import {
  SCENARIO_EXTRA_WEEKS,
  type ScenarioDetailDto,
  type SCurveDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLeaveWarning } from '@/components/grid-tools';
import { Alert, Badge, Button, Section, Select } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatRounded } from '@/lib/project-fields';
import { SCurveLegend, SCurveSheet } from '../../s-curve-chart';

type Entries = Map<string, string>; // `${groupId}:${week}` → weight
const key = (groupId: string, week: number) => `${groupId}:${week}`;
const toMap = (d: ScenarioDetailDto): Entries =>
  new Map(d.entries.map((e) => [key(e.groupId, e.weekNumber), e.weight]));

/** D-078: edit a scenario apart from the official schedule and compare its Kurva S with the plan and the actual. */
export function ScenarioEditor({
  projectId,
  initial,
  official,
  canEdit,
}: {
  projectId: string;
  initial: ScenarioDetailDto;
  official: SCurveDto | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [weekCount, setWeekCount] = useState(initial.weekCount);
  const [entries, setEntries] = useState<Entries>(() => toMap(initial));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'promote' | 'delete'>();
  const [error, setError] = useState<{ message: string; list: string[] }>();
  const [notice, setNotice] = useState<string>();
  const base = `/projects/${projectId}/schedule-scenarios/${saved.id}`;

  const list = useMemo(
    () =>
      [...entries]
        .filter(([, w]) => !new Decimal(w).isZero())
        .map(([k, weight]) => {
          const [groupId, week] = k.split(':');
          return { groupId: groupId!, weekNumber: Number(week), weight };
        })
        .sort((a, b) => a.weekNumber - b.weekNumber),
    [entries],
  );
  const dirty =
    name.trim() !== saved.name ||
    weekCount !== saved.weekCount ||
    list.length !== saved.entries.length ||
    list.some(
      (e) =>
        !new Decimal(entries.get(key(e.groupId, e.weekNumber)) ?? 0).eq(
          saved.entries.find((s) => s.groupId === e.groupId && s.weekNumber === e.weekNumber)
            ?.weight ?? -1,
        ),
    );
  useLeaveWarning(dirty);

  const lastUsed = list.reduce((m, e) => Math.max(m, e.weekNumber), 0);
  const minWeeks = Math.max(saved.projectWeekCount, lastUsed);
  const maxWeeks = saved.projectWeekCount + SCENARIO_EXTRA_WEEKS;
  const curve = plannedCurve(list, weekCount);

  const groups = saved.groups.map((g) => {
    const weeks = list.filter((e) => e.groupId === g.id);
    const sum = weeks.reduce((t, e) => t.plus(e.weight), new Decimal(0));
    return {
      ...g,
      start: weeks[0]?.weekNumber ?? null,
      end: weeks.at(-1)?.weekNumber ?? null,
      sum,
      ok: sum.minus(g.weight).abs().lte(SCHEDULE_TOLERANCE),
    };
  });
  const invalid = groups.filter((g) => !g.ok).length;

  const setRange = (groupId: string, weight: string, from: number, to: number) =>
    setEntries((prev) => {
      const next = new Map([...prev].filter(([k]) => !k.startsWith(`${groupId}:`)));
      for (const e of spreadEvenly(groupId, weight, from, Math.max(from, to)))
        next.set(key(groupId, e.weekNumber), e.weight);
      return next;
    });
  const shift = (groupId: string, delta: number) =>
    setEntries((prev) => {
      const mine = [...prev].filter(([k]) => k.startsWith(`${groupId}:`));
      const next = new Map([...prev].filter(([k]) => !k.startsWith(`${groupId}:`)));
      for (const [k, w] of mine) next.set(key(groupId, Number(k.split(':')[1]) + delta), w);
      return next;
    });

  function reset(d: ScenarioDetailDto) {
    setSaved(d);
    setName(d.name);
    setWeekCount(d.weekCount);
    setEntries(toMap(d));
  }

  async function run(action: () => Promise<ScenarioDetailDto | void>, message: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const d = await action();
      if (d) reset(d);
      setNotice(message);
      setConfirm(undefined);
    } catch (err) {
      const list =
        err instanceof ApiError
          ? ((err.details as { errors?: unknown } | undefined)?.errors ?? [])
          : [];
      setError({
        message: errorMessage(err),
        list: Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [],
      });
    } finally {
      setBusy(false);
    }
  }

  // Sheet data: the scenario is the plan being edited; the official plan is the extra line; actual from D-076.
  const sheet: SCurveDto = {
    baseline: official?.baseline ?? null,
    schedule: official?.schedule ?? null,
    currentWeek: official?.currentWeek ?? 1,
    rows: saved.groups.map((g) => {
      const actual = official?.rows.find((r) => r.id === g.id)?.actual ?? [];
      return {
        id: g.id,
        displayNumber: g.displayNumber,
        description: g.description,
        weight: g.weight,
        planned: Array.from({ length: weekCount }, (_, i) => entries.get(key(g.id, i + 1)) ?? null),
        actual: Array.from({ length: weekCount }, (_, i) => actual[i] ?? null),
      };
    }),
    weeks: Array.from({ length: weekCount }, (_, i) => {
      const w = saved.weeks[i] ?? extendWeek(saved.weeks, i);
      const o = official?.weeks[i];
      const c = curve[i]!;
      return {
        ...w,
        planned: c.planned,
        plannedCumulative: c.cumulative,
        actual: o?.actual ?? null,
        actualCumulative: o?.actualCumulative ?? null,
        deviation:
          o?.actualCumulative != null
            ? new Decimal(o.actualCumulative).minus(c.cumulative).toFixed()
            : null,
      };
    }),
  };
  const officialPlan = official
    ? Array.from(
        { length: weekCount },
        (_, i) =>
          official.weeks[i]?.plannedCumulative ?? official.weeks.at(-1)?.plannedCumulative ?? null,
      )
    : undefined;
  const finish =
    curve.findIndex((c) =>
      new Decimal(c.cumulative).gte(new Decimal(100).minus(SCHEDULE_TOLERANCE)),
    ) + 1;

  return (
    <div className="mt-3 space-y-4">
      <Section
        title={
          <>
            Simulasi: {saved.name} <Badge tone="blue">skenario</Badge>
          </>
        }
        description={`Salinan jadwal ${saved.schedule.rabVersionLabel}. Mengubah skenario tidak mengubah jadwal resmi. Terakhir diubah ${saved.updatedBy.name}.`}
        action={
          <div className="row-actions">
            <Link
              className="btn btn-secondary"
              href={`/projects/${projectId}/schedule/${saved.schedule.id}`}
            >
              Jadwal resmi
            </Link>
          </div>
        }
      >
        <div className="space-y-3">
          {notice && <Alert kind="success">{notice}</Alert>}
          {error && (
            <Alert>
              {error.message}
              {error.list.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {error.list.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <label htmlFor="scenario-name" className="field-label">
                Nama skenario
              </label>
              <input
                id="scenario-name"
                className="field"
                value={name}
                maxLength={120}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="scenario-weeks" className="field-label">
                Jumlah minggu (proyek {saved.projectWeekCount})
              </label>
              <input
                id="scenario-weeks"
                className="field w-28"
                type="number"
                min={minWeeks}
                max={maxWeeks}
                value={weekCount}
                disabled={!canEdit}
                onChange={(e) =>
                  setWeekCount(
                    Math.min(maxWeeks, Math.max(minWeeks, Number(e.target.value) || minWeeks)),
                  )
                }
              />
            </div>
            {canEdit && (
              <>
                <Button
                  type="button"
                  disabled={busy || !dirty || !name.trim()}
                  onClick={() =>
                    void run(
                      () =>
                        api<ScenarioDetailDto>('PUT', base, {
                          name: name.trim(),
                          weekCount,
                          entries: list,
                        }),
                      'Skenario disimpan.',
                    )
                  }
                >
                  {busy ? 'Menyimpan…' : 'Simpan skenario'}
                </Button>
                {dirty && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => reset(saved)}
                  >
                    Batalkan perubahan
                  </Button>
                )}
              </>
            )}
          </div>
          <p className="text-sm text-slate-600">
            {weekCount > saved.projectWeekCount &&
              `${weekCount - saved.projectWeekCount} minggu tambahan setelah akhir proyek (hanya di skenario). `}
            {finish > 0
              ? `Rencana skenario mencapai 100% di M.${finish}`
              : 'Rencana skenario belum mencapai 100%'}
            {invalid > 0 && (
              <span className="text-red-700">
                {' '}
                · {invalid} kelompok jumlahnya belum sama dengan bobot
              </span>
            )}
            .
          </p>
        </div>
      </Section>

      <Section
        title="Kurva S skenario"
        description="Rencana skenario (jingga, diarsir di sheet) dibandingkan dengan rencana resmi (teal) dan realisasi (biru). Deviasi di baris bawah terhadap skenario."
        action={
          <SCurveLegend
            planLabel="Rencana skenario"
            extra={officialPlan ? 'Rencana resmi' : undefined}
          />
        }
        body={false}
      >
        <SCurveSheet
          data={sheet}
          extra={officialPlan ? { label: 'Rencana resmi', cumulative: officialPlan } : undefined}
        />
      </Section>

      <Section
        title="Atur kelompok pekerjaan"
        description="Pilih minggu mulai dan selesai untuk membagi bobot kelompok rata ke minggu-minggu itu, atau geser seluruh kelompok per minggu."
        body={false}
      >
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
                <th role="columnheader" scope="col">
                  Mulai
                </th>
                <th role="columnheader" scope="col">
                  Selesai
                </th>
                <th role="columnheader" scope="col">
                  Geser
                </th>
                <th role="columnheader" scope="col" className="num">
                  Jumlah %
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {groups.map((g) => (
                <tr role="row" key={g.id}>
                  <td role="cell" data-label="Kelompok">
                    <span>
                      <b>{g.displayNumber}</b> {g.description}
                    </span>
                  </td>
                  <td role="cell" data-label="Bobot" className="num">
                    {formatRounded(g.weight, 3)}
                  </td>
                  {(['start', 'end'] as const).map((edge) => (
                    <td role="cell" key={edge} data-label={edge === 'start' ? 'Mulai' : 'Selesai'}>
                      <Select
                        aria-label={`${g.displayNumber} minggu ${edge === 'start' ? 'mulai' : 'selesai'}`}
                        value={g[edge] ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (edge === 'start')
                            setRange(g.id, g.weight, v, Math.max(v, g.end ?? v));
                          else setRange(g.id, g.weight, Math.min(v, g.start ?? v), v);
                        }}
                      >
                        {g[edge] === null && <option value="">–</option>}
                        {Array.from({ length: weekCount }, (_, i) => (
                          <option key={i} value={i + 1}>
                            M.{i + 1}
                            {i + 1 > saved.projectWeekCount ? ' (+)' : ''}
                          </option>
                        ))}
                      </Select>
                    </td>
                  ))}
                  <td role="cell" data-label="Geser">
                    <div className="row-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Majukan ${g.displayNumber} satu minggu`}
                        disabled={!canEdit || !g.start || g.start <= 1}
                        onClick={() => shift(g.id, -1)}
                      >
                        ← 1
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Mundurkan ${g.displayNumber} satu minggu`}
                        disabled={!canEdit || !g.end || g.end >= weekCount}
                        onClick={() => shift(g.id, 1)}
                      >
                        1 →
                      </Button>
                    </div>
                  </td>
                  <td
                    role="cell"
                    data-label="Jumlah"
                    className={`num ${g.ok ? '' : 'text-red-700'}`}
                  >
                    {formatRounded(g.sum.toFixed(), 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {canEdit && (
        <Section title="Jadikan jadwal resmi atau hapus">
          <div className="space-y-3">
            {saved.promoteBlockers.length > 0 ? (
              <Alert kind="info">
                Belum bisa dijadikan jadwal resmi:
                <ul className="mt-1 list-disc pl-5">
                  {saved.promoteBlockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <p className="text-sm text-slate-600">
                Isian skenario akan menggantikan isian jadwal {saved.schedule.rabVersionLabel};
                jadwal tetap harus di-approve.
              </p>
            )}
            {dirty && <Alert kind="info">Simpan skenario dulu.</Alert>}
            {confirm ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {confirm === 'promote'
                    ? `Ganti isian jadwal resmi ${saved.schedule.rabVersionLabel} dengan skenario ini?`
                    : `Hapus skenario "${saved.name}"?`}
                </span>
                <Button
                  type="button"
                  variant={confirm === 'delete' ? 'danger' : 'primary'}
                  disabled={busy}
                  onClick={() =>
                    confirm === 'promote'
                      ? void run(
                          () => api<ScenarioDetailDto>('POST', `${base}/promote`, {}),
                          `Isian jadwal ${saved.schedule.rabVersionLabel} diganti dengan skenario ini. Approve jadwal di halaman jadwal resmi.`,
                        )
                      : void run(async () => {
                          await api('DELETE', base);
                          router.push(`/projects/${projectId}/schedule#scenarios`);
                        }, 'Skenario dihapus.')
                  }
                >
                  {confirm === 'promote' ? 'Ya, jadikan jadwal resmi' : 'Ya, hapus'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm(undefined)}
                >
                  Batal
                </Button>
              </div>
            ) : (
              <div className="row-actions">
                <Button
                  type="button"
                  disabled={busy || dirty || saved.promoteBlockers.length > 0}
                  onClick={() => setConfirm('promote')}
                >
                  Jadikan jadwal resmi
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirm('delete')}
                >
                  Hapus skenario
                </Button>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Weeks past the end of the saved scenario: 7-day weeks continuing the last one. */
function extendWeek(weeks: ScenarioDetailDto['weeks'], i: number) {
  const start = addDays(weeks.at(-1)!.endDate, 1 + (i - weeks.length) * 7);
  return { weekNumber: i + 1, startDate: start, endDate: addDays(start, 6) };
}
