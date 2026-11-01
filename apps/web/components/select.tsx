'use client';

import {
  Children,
  useCallback,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';

type Opt = { value: string; label: string; disabled: boolean };

/** Lists longer than this get a search box. */
const SEARCH_FROM = 7;

const text = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join('')
      : isValidElement<{ children?: ReactNode }>(node)
        ? text(node.props.children)
        : '';

function readOptions(children: ReactNode): Opt[] {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(c) || c.type !== 'option') return [];
    const label = text(c.props.children);
    return [{ value: c.props.value === undefined ? label : String(c.props.value), label, disabled: Boolean(c.props.disabled) }];
  });
}

const norm = (s: string) => s.toLocaleLowerCase('id').normalize('NFD').replace(/\p{M}/gu, '');

/** Popover pinned under the trigger with position: fixed, so table and panel overflow never clip it. */
function usePopover(open: boolean, close: () => void, anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; maxHeight: number; host: Element }>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const up = r.bottom + 300 > window.innerHeight && r.top > window.innerHeight - r.bottom;
      // Inside a modal <dialog> (top layer) the popover must live in the dialog, or it renders behind it and is inert.
      const host = anchor.current?.closest('dialog[open]') ?? document.body;
      const room = (up ? r.top : window.innerHeight - r.bottom) - 12;
      const width = Math.min(Math.max(r.width, 220), window.innerWidth - 16);
      setRect({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: up ? r.top - 4 : r.bottom + 4, width, up, maxHeight: Math.max(140, Math.min(320, room)), host });
    };
    place();
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, close, anchor, pop]);
  return rect;
}

function OptionList({
  id,
  options,
  active,
  selected,
  onPick,
  onHover,
  empty,
}: {
  id: string;
  options: Opt[];
  active: number;
  selected?: string;
  onPick: (o: Opt) => void;
  onHover: (i: number) => void;
  empty: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <ul ref={list} id={id} role="listbox" className="dropdown-list">
      {options.length === 0 && <li className="dropdown-empty">{empty}</li>}
      {options.map((o, i) => (
        <li
          key={`${o.value}-${i}`}
          id={`${id}-${i}`}
          data-index={i}
          role="option"
          aria-selected={o.value === selected}
          aria-disabled={o.disabled || undefined}
          className={`dropdown-option${i === active ? ' is-active' : ''}`}
          onPointerMove={() => onHover(i)}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => !o.disabled && onPick(o)}
        >
          <span>{o.label || ' '}</span>
          {o.value === selected && <Icon name="check" size={15} />}
        </li>
      ))}
    </ul>
  );
}

const step = (options: Opt[], from: number, dir: 1 | -1) => {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i]!.disabled) return i;
  return from;
};

/**
 * The app's dropdown, a drop-in for <select>: same <option> children, value/defaultValue, name (via a hidden
 * input for forms) and onChange(e => e.target.value). Long lists get a search box.
 */
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  name,
  id,
  disabled,
  required,
  className = '',
  title,
  searchable,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean }) {
  const options = readOptions(children);
  const [inner, setInner] = useState(() => String(defaultValue ?? options.find((o) => !o.disabled)?.value ?? ''));
  // Uncontrolled like <select>: options that arrive later (or a filter that drops the choice) fall back to the first enabled one.
  const current =
    value !== undefined ? String(value) : options.some((o) => o.value === inner) ? inner : (options.find((o) => !o.disabled)?.value ?? '');
  const chosen = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const withSearch = searchable ?? options.length > SEARCH_FROM;
  const shown = query ? options.filter((o) => norm(o.label).includes(norm(query))) : options;
  const close = useCallback(() => setOpen(false), []);
  const rect = usePopover(open, close, trigger, pop);

  const show = (q = '') => {
    if (disabled) return;
    const list = q ? options.filter((o) => norm(o.label).includes(norm(q))) : options;
    setQuery(q);
    setActive(Math.max(0, list.findIndex((o) => o.value === current)));
    setOpen(true);
  };
  const placed = rect !== undefined;
  useEffect(() => {
    // The popover mounts only once it has a position, so focus waits for that.
    if (open && placed && withSearch) search.current?.focus();
  }, [open, placed, withSearch]);

  const pick = (o: Opt) => {
    setOpen(false);
    trigger.current?.focus();
    if (o.value === current) return;
    setInner(o.value);
    // Callers were written against <select>; they read only e.target.value.
    onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  const keys = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      } else if (withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        show(e.key);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => step(shown, a, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = shown[active];
      if (o && !o.disabled) pick(o);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        title={title}
        disabled={disabled}
        className={`field dropdown-trigger ${className}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keys}
      >
        <span className={chosen?.label ? '' : 'dropdown-placeholder'}>{chosen?.label || '–'}</span>
        <Icon name="chevron" size={15} className="dropdown-chevron" />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open &&
        rect &&
        createPortal(
          <div
            ref={pop}
            className="dropdown-pop"
            style={{ left: rect.left, width: rect.width, maxHeight: rect.maxHeight, ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }) }}
            onKeyDown={keys}
          >
            {withSearch && (
              <div className="dropdown-search">
                <Icon name="search" size={15} />
                <input
                  ref={search}
                  aria-label="Cari pilihan"
                  aria-controls={listId}
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                  placeholder="Cari…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                />
              </div>
            )}
            <OptionList id={listId} options={shown} active={active} selected={current} onPick={pick} onHover={setActive} empty="Tidak ada yang cocok." />
          </div>,
          rect.host,
        )}
    </>
  );
}

/** Free text with suggestions (replaces <datalist>): typing filters, arrows + Enter pick, anything typed is kept. */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'> & {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);
  const rect = usePopover(open, close, input, pop);
  const shown = (value ? suggestions.filter((s) => norm(s).includes(norm(value))) : suggestions)
    .filter((s) => s !== value)
    .map((s) => ({ value: s, label: s, disabled: false }));

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, shown.length - 1) : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      onChange(shown[active].value);
      setOpen(false);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        {...props}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && shown.length > 0}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={`field ${className}`}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={keys}
      />
      {open &&
        rect &&
        shown.length > 0 &&
        createPortal(
          <div ref={pop} className="dropdown-pop" style={{ left: rect.left, width: rect.width, maxHeight: rect.maxHeight, ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }) }}>
            <OptionList
              id={listId}
              options={shown}
              active={active}
              onPick={(o) => {
                onChange(o.value);
                setOpen(false);
              }}
              onHover={setActive}
              empty=""
            />
          </div>,
          rect.host,
        )}
    </>
  );
}
