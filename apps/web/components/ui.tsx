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

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`alert alert-${kind}`}>
      <Icon name={kind === 'success' ? 'check' : 'info'} size={18} />
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
  return <div className="empty-state"><span className="metric-icon"><Icon name="folder" size={24} /></span><span>{children}</span></div>;
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="page-heading">
      <span className="eyebrow">Laporan Proyek / Workspace</span>
      <h1>{children}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}
