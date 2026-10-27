import Link from 'next/link';
import { Icon } from './icon';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`btn ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

const CONTROL = 'field';

export function Field({ label, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className={CONTROL} {...props} />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL} ${className}`} {...props} />;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`alert alert-${kind}`}>
      <Icon name={kind === 'success' ? 'check' : 'info'} size={17} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return (
    <p role="status" className="loading">
      <span className="spinner" aria-hidden="true" />{label}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="folder" size={22} /></span><span>{children}</span></div>;
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'red' | 'blue' | 'amber'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Page header: title on the left, the page's primary actions on the right (olmat page-head). */
export function PageTitle({
  children,
  subtitle,
  eyebrow,
  actions,
  back,
}: {
  children: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="page-head">
      <div className="page-head-copy">
        {back && (
          <Link href={back.href} className="page-back">
            <Icon name="arrow-left" size={14} />
            {back.label}
          </Link>
        )}
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="page-title">{children}</h1>
        {subtitle && <div className="page-description">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Card with its title inside, so a section's heading and content read as one unit. */
export function Section({
  title,
  description,
  action,
  children,
  body = true,
  className = '',
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  body?: boolean;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} className={`surface ${className}`} aria-labelledby={headingId}>
      {title && (
        <div className="surface-header">
          <div className="min-w-0">
            <h2 id={headingId} className="surface-title">{title}</h2>
            {description && <p className="surface-subtitle">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={body ? 'surface-body' : ''}>{children}</div>
    </section>
  );
}
