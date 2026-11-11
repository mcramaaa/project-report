'use client';

import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'grid-zoom';
const STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4];

const CHANGED = 'grid-zoom-change';
/** Last zoom set on this page; keeps working when storage is blocked. */
let current: number | null = null;

/** Remembered zoom (1 when unset or storage is blocked). */
function snapshot(): number {
  if (current !== null) return current;
  try {
    const z = Number(localStorage.getItem(KEY));
    return STEPS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function apply(zoom: number) {
  document.documentElement.style.setProperty('--grid-zoom', String(zoom));
}

/**
 * Zoom for the wide grids (`.rab-grid`), remembered per browser, and Excel-like keys in grid inputs
 * (`.grid-input`): Enter/↓ to the same column one row down, ↑ one row up.
 */
export function GridTools() {
  // Server and hydration render 100%; the stored value follows right after (no mismatch).
  const zoom = useSyncExternalStore(subscribe, snapshot, () => 1);

  useEffect(() => apply(zoom), [zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = e.target as HTMLElement;
      if (
        !input.classList?.contains('grid-input') ||
        e.shiftKey ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      const down = e.key === 'Enter' || e.key === 'ArrowDown';
      if (!down && e.key !== 'ArrowUp') return;
      const cell = input.closest('td');
      let row = cell?.parentElement as HTMLTableRowElement | null;
      if (!cell || !row) return;
      e.preventDefault();
      const column = cell.cellIndex;
      // Skip heading rows (no input in that column) until a row that has one.
      while (
        (row = (
          down ? row.nextElementSibling : row.previousElementSibling
        ) as HTMLTableRowElement | null)
      ) {
        const target = row.cells[column]?.querySelector<HTMLInputElement>('input.grid-input');
        if (target) {
          target.focus();
          target.select();
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function set(next: number) {
    current = next;
    window.dispatchEvent(new Event(CHANGED));
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Not remembered; still applied for this page.
    }
  }

  const i = STEPS.indexOf(zoom);
  return (
    <div className="grid-tools" role="group" aria-label="Ukuran tabel">
      <button
        type="button"
        className="grid-tools-btn"
        aria-label="Perkecil tabel"
        disabled={i <= 0}
        onClick={() => set(STEPS[i - 1]!)}
      >
        −
      </button>
      <button
        type="button"
        className="grid-tools-btn grid-tools-value"
        title="Kembalikan ke 100%"
        onClick={() => set(1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="grid-tools-btn"
        aria-label="Perbesar tabel"
        disabled={i >= STEPS.length - 1}
        onClick={() => set(STEPS[i + 1]!)}
      >
        +
      </button>
    </div>
  );
}

/** Browser warning before closing or reloading the page while grid input is not saved. */
export function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
