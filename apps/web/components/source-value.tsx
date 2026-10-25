'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';

export interface ValueSource {
  label: string;
  value?: string | null;
  href?: string;
}

/** A deliberate, keyboard-accessible trace. Missing provenance is stated, never guessed. */
export function SourceValue({
  children,
  title,
  value,
  formula,
  sources = [],
  note,
}: {
  children: ReactNode;
  title: string;
  value?: string | null;
  formula?: string;
  sources?: ValueSource[];
  note?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="source-value"
        aria-label={`Asal nilai: ${title}${value != null ? `, ${value}` : ''}`}
        aria-haspopup="dialog"
        title={`Lihat asal nilai: ${title}`}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <dialog
            className="source-dialog"
            ref={dialog}
            aria-labelledby={id}
            onClose={() => setOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                const b = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientX < b.left ||
                  event.clientX > b.right ||
                  event.clientY < b.top ||
                  event.clientY > b.bottom
                )
                  dialog.current?.close();
              }
            }}
          >
            {open && (
              <>
                <header className="source-dialog-header">
                  <div>
                    <p className="eyebrow">Asal nilai</p>
                    <h2 id={id}>{title}</h2>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Tutup asal nilai"
                    onClick={() => dialog.current?.close()}
                  >
                    <Icon name="close" />
                  </button>
                </header>
                <div className="source-dialog-body">
                  {value != null && (
                    <div className="source-exact">
                      <span>Nilai lengkap</span>
                      <strong>{value}</strong>
                    </div>
                  )}
                  {formula && (
                    <div className="source-formula">
                      <span>Perhitungan</span>
                      <p>{formula}</p>
                    </div>
                  )}
                  {note && <p className="text-sm text-slate-600">{note}</p>}
                  {sources.length > 0 ? (
                    <ol className="source-list">
                      {sources.map((source, index) => (
                        <li key={`${source.label}-${index}`}>
                          <span className="source-step">{index + 1}</span>
                          <div>
                            {source.href ? (
                              <Link href={source.href} onClick={() => dialog.current?.close()}>
                                {source.label}
                                <span aria-hidden="true"> ↗</span>
                              </Link>
                            ) : (
                              <span>{source.label}</span>
                            )}
                            {source.value != null && (
                              <span className="source-operand">{source.value}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    !note && (
                      <p className="text-sm text-slate-600">
                        Sumber rinci belum tercatat untuk nilai ini.
                      </p>
                    )
                  )}
                </div>
                <footer>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => dialog.current?.close()}
                  >
                    Kembali
                  </button>
                </footer>
              </>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
