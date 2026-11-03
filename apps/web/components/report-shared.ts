import { Decimal } from '@laporan-proyek/calc';
import type { ReportTemplateConfig } from '@laporan-proyek/shared';

const PAGE_MM: Record<ReportTemplateConfig['page']['size'], [number, number]> = {
  A4: [210, 297],
  F4: [215, 330],
  LEGAL: [216, 356],
};
export function pageSize(
  t: ReportTemplateConfig,
  orientation = t.page.orientation,
): { width: number; height: number; css: string } {
  const [w, h] = PAGE_MM[t.page.size];
  const landscape = orientation === 'landscape';
  return {
    width: landscape ? h : w,
    height: landscape ? w : h,
    css: `${landscape ? h : w}mm ${landscape ? w : h}mm`,
  };
}

/** Indonesian number display (thousand dots, decimal comma), rounded half up for display only (D-083). */
export function num(v: string | null | undefined, dp: number): string {
  if (v === null || v === undefined || v === '') return '';
  const [i, f] = new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp).split('.');
  return `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${f ? `,${f}` : ''}`;
}
