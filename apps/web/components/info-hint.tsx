'use client';

import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icon';

/**
 * A small marker whose explanation shows as a tooltip on hover or keyboard focus. The tooltip is drawn in
 * a fixed layer so scrolling tables never clip it; screen readers get the text through aria-describedby.
 */
export function InfoHint({
  text,
  label,
  tone = 'blue',
  icon = 'info',
}: {
  text: string;
  /** Short name read before the text, e.g. "Koreksi manual". */
  label: string;
  tone?: 'blue' | 'red' | 'amber';
  icon?: IconName;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; above: boolean }>();

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 140 > window.innerHeight;
    setAt({
      top: above ? r.top - 6 : r.bottom + 6,
      left: Math.min(Math.max(8, r.left + r.width / 2 - 140), window.innerWidth - 288),
      above,
    });
  }

  return (
    <>
      <span
        ref={ref}
        className={`info-hint info-hint-${tone}`}
        tabIndex={0}
        role="img"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={() => setAt(undefined)}
        onFocus={show}
        onBlur={() => setAt(undefined)}
        onKeyDown={(event) => event.key === 'Escape' && setAt(undefined)}
      >
        <Icon name={icon} size={12} />
      </span>
      <span id={id} className="sr-only">
        {text}
      </span>
      {at &&
        createPortal(
          <span
            className={`info-hint-tip${at.above ? ' info-hint-tip-above' : ''}`}
            style={{ top: at.top, left: at.left }}
            aria-hidden="true"
          >
            <strong>{label}</strong>
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
