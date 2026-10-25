import Link from 'next/link';

/** Server-rendered pagination with links (same look as the client pagination in users-admin). */
export function Pager({ page, pageSize, total, noun, href }: { page: number; pageSize: number; total: number; noun: string; href: (page: number) => string }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav aria-label="Halaman" className="pagination">
      {page > 1 ? <Link className="btn btn-secondary" href={href(page - 1)}>Sebelumnya</Link> : <span className="btn btn-secondary" aria-disabled="true">Sebelumnya</span>}
      <span>
        Halaman {page} dari {totalPages} ({total} {noun})
      </span>
      {page < totalPages ? <Link className="btn btn-secondary" href={href(page + 1)}>Berikutnya</Link> : <span className="btn btn-secondary" aria-disabled="true">Berikutnya</span>}
    </nav>
  );
}

/** Query string for list pages; drops empty values and page 1. */
export function listHref(path: string, params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && !(k === 'page' && v === 1)) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
