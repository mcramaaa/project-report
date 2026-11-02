'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

const PX_PER_MM = 96 / 25.4;

/**
 * D-084: shrinks its content to fit one printed page (like Excel's "fit to 1 page"), keeping the full page width.
 * Re-measures when content or images change size.
 */
export function FitToPage({
  heightMm,
  enabled,
  children,
}: {
  heightMm: number;
  enabled: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.zoom = '1';
      el.style.width = '';
      if (!enabled) return;
      const width = el.getBoundingClientRect().width;
      // 1 mm spare so rounding never pushes a blank second page.
      const target = (heightMm - 1) * PX_PER_MM;
      // A smaller scale makes the box wider, so text wraps less and the height drops: refine a few times.
      let scale = 1;
      for (let i = 0; i < 4; i++) {
        const height = el.getBoundingClientRect().height;
        const next = Math.min(1, scale * (target / height));
        if (Math.abs(next - scale) < 0.005) break;
        scale = next;
        // Absolute width: zoom scales px lengths but not percentages, so this keeps the full page width.
        el.style.zoom = String(scale);
        el.style.width = `${width / scale}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(() => {
      // Ignore the resize our own zoom causes; only content growth matters.
      if (
        Math.abs(el.scrollHeight * Number(el.style.zoom || 1) - heightMm * PX_PER_MM) > 2 ||
        !enabled
      )
        fit();
    });
    observer.observe(el);
    el.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
    return () => observer.disconnect();
  }, [heightMm, enabled]);
  return (
    <div ref={ref} className="rd-fit">
      {children}
    </div>
  );
}
