'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';

/** Native modal dialog: Esc and the backdrop close it, focus stays inside while open. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => dialog.current?.showModal(), []);
  return createPortal(
    <dialog
      ref={dialog}
      className="source-dialog"
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
    >
      <header className="source-dialog-header">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Tutup"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="source-dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}
