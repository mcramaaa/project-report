'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Button } from './ui';

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
};

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
    const menu = menuRef.current;
    if (event.key === 'Escape') {
      if (!menu) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  return (
    <details ref={menuRef} className="rab-row-menu" onKeyDown={closeOnEscape}>
      <summary className="rab-row-menu-trigger" aria-label={label} title="Tindakan lainnya" aria-haspopup="menu">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="rab-row-menu-list" role="menu" aria-label={label}>
        <span className="rab-row-menu-label" role="presentation">Aksi</span>
        {items.map((item) => (
          <div key={item.label} role="none">
            {item.separatorBefore && <span className="rab-row-menu-separator" role="separator" />}
            <Button
              type="button"
              role="menuitem"
              variant={item.destructive ? 'danger' : 'secondary'}
              className="btn-compact"
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                item.onSelect();
              }}
            >
              {item.label}
            </Button>
          </div>
        ))}
      </div>
    </details>
  );
}
