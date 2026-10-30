'use client';

import { Decimal } from '@laporan-proyek/calc';
import type { SCurveGroupDetailDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatNumber, formatRounded } from '@/lib/project-fields';

const vol = (v: string | null) =>
  v === null ? '' : formatNumber(new Decimal(v).toFixed(), { trim: true });

/** D-077 butir 5: the work items behind one group's deviation, read when the row is opened. */
export function GroupDetail({
  projectId,
  groupId,
  week,
}: {
  projectId: string;
  groupId: string;
  week: number;
}) {
  const [state, setState] = useState<{
    key: string;
    data?: SCurveGroupDetailDto;
    error?: string;
  }>();
  const key = `${groupId}:${week}`;

  useEffect(() => {
    let live = true;
    api<SCurveGroupDetailDto>(
      'GET',
      `/projects/${projectId}/schedules/s-curve/groups/${groupId}/weeks/${week}`,
    )
      .then((data) => live && setState({ key, data }))
      .catch((err) => live && setState({ key, error: errorMessage(err) }));
    return () => {
      live = false;
    };
  }, [projectId, groupId, week, key]);

  if (state?.key !== key)
    return <p className="p-3 text-sm text-slate-500">Memuat rincian pekerjaan…</p>;
  if (state.error) return <Alert>{state.error}</Alert>;
  const items = state.data!.rows.filter((r) => r.rowType === 'ITEM');
  const idle = items.filter(
    (r) => r.cumulative !== null && new Decimal(r.cumulative).isZero(),
  ).length;

  return (
    <div className="group-detail">
      <p className="mb-2 text-sm text-slate-600">
        {items.length} item pekerjaan,{' '}
        {idle > 0 ? (
          <b className="text-red-700">{idle} belum dikerjakan</b>
        ) : (
          'semua sudah dikerjakan sebagian'
        )}
        . Volume s.d. M.
        {week}.{' '}
        <Link className="link-button" href={`/projects/${projectId}/progress/${week}`}>
          Buka progres M.{week}
        </Link>
      </p>
      <div className="rab-grid-wrap">
        <table className="rab-grid">
          <thead>
            <tr>
              <th scope="col">No</th>
              <th scope="col">Uraian</th>
              <th scope="col">Sat.</th>
              <th scope="col" className="num">
                Vol. RAB
              </th>
              <th scope="col" className="num">
                M.{week}
              </th>
              <th scope="col" className="num">
                s.d. M.{week}
              </th>
              <th scope="col" className="num">
                Selesai
              </th>
              <th scope="col" className="num">
                Bobot %
              </th>
              <th scope="col" className="num">
                Realisasi %
              </th>
            </tr>
          </thead>
          <tbody>
            {state.data!.rows.map((r) =>
              r.rowType !== 'ITEM' ? (
                <tr key={r.id}>
                  <td className="font-semibold">{r.displayNumber ?? ''}</td>
                  <td
                    className="font-semibold"
                    colSpan={8}
                    style={{ paddingLeft: 11 + r.depth * 14 }}
                  >
                    {r.description}
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td>{r.displayNumber ?? ''}</td>
                  <td style={{ paddingLeft: 11 + r.depth * 14 }}>
                    {r.description}
                    {r.workItemCode && (
                      <span className="block font-mono text-xs text-slate-500">
                        {r.workItemCode}
                      </span>
                    )}
                  </td>
                  <td>{r.unit ?? ''}</td>
                  <td className="num">{vol(r.volume)}</td>
                  <td className="num">{vol(r.thisWeek)}</td>
                  <td className="num">{vol(r.cumulative)}</td>
                  <td className="num">
                    {r.percent === null ? (
                      '–'
                    ) : new Decimal(r.percent).isZero() ? (
                      <Badge tone="red">belum</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="group-progress" style={{ width: 60 }}>
                          <span
                            className="group-progress-bar"
                            style={{ width: `${Math.min(100, Number(r.percent))}%` }}
                          />
                        </span>
                        {formatRounded(r.percent, 0)}%
                      </span>
                    )}
                  </td>
                  <td className="num">{r.weight === null ? '' : formatRounded(r.weight, 3)}</td>
                  <td className="num">
                    {r.actualWeight === null ? '' : formatRounded(r.actualWeight, 3)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
