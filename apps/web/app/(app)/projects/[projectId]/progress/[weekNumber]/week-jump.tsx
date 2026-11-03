'use client';

import type { CalendarWeek } from '@laporan-proyek/calc';
import { useRouter } from 'next/navigation';

const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** Jump straight to any week (same tab), grouped by period B.n. */
export function WeekJump({
  weeks,
  current,
  hrefOf,
}: {
  weeks: CalendarWeek[];
  current: number;
  /** `${base}/{n}{path}` with `{n}` replaced; a function cannot cross from the server component. */
  hrefOf: string;
}) {
  const router = useRouter();
  const periods = [...new Set(weeks.map((w) => w.periodNumber))];
  return (
    <select
      className="field week-jump"
      aria-label="Pilih minggu"
      value={current}
      onChange={(e) => router.push(hrefOf.replace('{n}', e.target.value))}
    >
      {periods.map((p) => (
        <optgroup key={p} label={`B.${p}`}>
          {weeks
            .filter((w) => w.periodNumber === p)
            .map((w) => (
              <option key={w.weekNumber} value={w.weekNumber}>
                M.{w.weekNumber} · {short(w.startDate)} – {short(w.endDate)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
