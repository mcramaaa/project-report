import type { ProjectDto, WorkbookPreviewDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle, Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
  searchParams: Promise<{ sheet?: string; cell?: string }>;
}) {
  const [{ projectId, documentId }, query] = await Promise.all([params, searchParams]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const path = `${base}/documents/${encodeURIComponent(documentId)}`;
  const qs = new URLSearchParams({
    ...(query.sheet ? { sheet: query.sheet } : {}),
    cell: query.cell ?? 'A1',
  });
  const [project, preview] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<WorkbookPreviewDto>(`${path}/preview?${qs}`),
  ]);
  if (project.status === 404 || preview.status === 404) notFound();
  const d = preview.data;
  const href = (sheet: string, cell: string) => `${path}?${new URLSearchParams({ sheet, cell })}`;
  return (
    <>
      <PageTitle subtitle={project.data?.projectName}>Sumber dokumen</PageTitle>
      <Link href={`${base}/imports`} className="btn btn-secondary mb-5">
        ← Dokumen &amp; impor
      </Link>
      {!d ? (
        <Alert>
          {preview.status === 403
            ? 'Anda memerlukan izin melihat dokumen untuk membuka sumber Excel ini. Data RAB tetap dapat dilihat sesuai akses Anda.'
            : preview.status === 400
              ? 'Alamat sel tidak valid. Gunakan format A1.'
              : 'Dokumen sumber tidak dapat dimuat.'}
        </Alert>
      ) : (
        <div className="space-y-5">
          <section className="panel form-panel space-y-4">
            <div className="section-caption">
              <div>
                <h2>{d.filename}</h2>
                <p className="text-sm text-slate-500">
                  {d.sheet}!{d.selected.cell}
                </p>
              </div>
              <a href={`/api${path}/download`} className="btn btn-secondary">
                Unduh Excel asli
              </a>
            </div>
            <form className="toolbar" action={path}>
              <div>
                <label htmlFor="sheet" className="field-label">
                  Sheet
                </label>
                <select className="field" id="sheet" name="sheet" defaultValue={d.sheet}>
                  {d.sheets.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cell" className="field-label">
                  Sel
                </label>
                <input
                  id="cell"
                  className="field"
                  name="cell"
                  defaultValue={d.selected.cell}
                  pattern="[A-Za-z]{1,3}[1-9][0-9]*"
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit">
                Buka sel
              </button>
            </form>
            <dl className="source-exact">
              <dt>Nilai tersimpan di Excel</dt>
              <dd>{d.selected.value ?? '(sel kosong)'}</dd>
            </dl>
            <div className="source-formula">
              <span>Rumus asli</span>
              <p>
                {d.selected.formula
                  ? `=${d.selected.formula}`
                  : 'Nilai langsung; tidak ada rumus pada sel ini.'}
              </p>
            </div>
            {d.selected.references.length > 0 && (
              <div>
                <h3 className="mb-2 font-semibold">Referensi dalam rumus</h3>
                <div className="flex flex-wrap gap-2">
                  {d.selected.references.map((r, i) => (
                    <Link key={i} className="btn btn-secondary" href={href(r.sheet, r.cell)}>
                      {r.sheet}!{r.range ?? r.cell}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <p className="text-sm text-slate-500">
              Pratinjau memakai nilai yang tersimpan dalam file asli. Rumus tidak dijalankan ulang.
              Referensi menunjukkan alamat tertulis, termasuk rentang pencarian dan cabang rumus.
            </p>
          </section>
          <div
            className="panel workbook-wrap"
            role="region"
            aria-label="Pratinjau sheet sumber"
            tabIndex={0}
          >
            <table className="workbook-grid">
              <thead>
                <tr>
                  <th scope="col">Baris</th>
                  {d.columns.map((c) => (
                    <th scope="col" key={c}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.number}>
                    <th scope="row">{r.number}</th>
                    {r.cells.map((c) => (
                      <td
                        key={c.cell}
                        className={c.cell === d.selected.cell ? 'workbook-selected' : ''}
                      >
                        <Link
                          href={href(d.sheet, c.cell)}
                          title={c.formula ? `=${c.formula}` : (c.value ?? 'Sel kosong')}
                        >
                          {c.value ?? '–'}
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
