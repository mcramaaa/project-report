'use client';

import { MC_MAX_NUMBER, rabVersionLabel, type DocumentDto, type RabImportSummaryDto, type RabVersionType } from '@laporan-proyek/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, EmptyState, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { IMPORT_STATUS } from '@/lib/import-ui';
import { formatDate } from '@/lib/project-fields';

type Choice = { role: 'RAB' | 'SUPPORT'; sheet: string };

export function ImportsManager({
  projectId,
  closed,
  documents,
  imports,
  canUpload,
  canReview,
}: {
  projectId: string;
  closed: boolean;
  documents: DocumentDto[] | null;
  imports: RabImportSummaryDto[] | null;
  canUpload: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [selected, setSelected] = useState<Record<string, Choice>>({});
  const [target, setTarget] = useState<RabVersionType>('CONTRACT');
  /** Empty = lowest allowed MC number (D-069). */
  const [mcNumber, setMcNumber] = useState('');

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!form.getAll('files').some((f) => f instanceof File && f.size > 0)) return setNotice({ kind: 'error', text: 'Pilih file .xlsx.' });
    setBusy(true);
    setNotice(undefined);
    try {
      const docs = await api<DocumentDto[]>('POST', `/projects/${projectId}/documents`, form);
      setNotice({ kind: 'success', text: `${docs.length} dokumen diunggah dan disimpan apa adanya.` });
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function createImport() {
    const sources = Object.entries(selected).map(([documentId, c]) => ({ documentId, role: c.role, ...(c.role === 'RAB' && c.sheet ? { rabSheet: c.sheet } : {}) }));
    setBusy(true);
    setNotice(undefined);
    try {
      const run = await api<RabImportSummaryDto>('POST', `/projects/${projectId}/rab-imports`, { targetVersionType: target, ...(target === 'MC' && mcNumber !== '' ? { targetRevisionNumber: Number(mcNumber) } : {}), sources });
      router.push(`/projects/${projectId}/imports/${run.id}`);
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
      setBusy(false);
    }
  }

  async function removeImport(run: RabImportSummaryDto) {
    if (!window.confirm('Hapus run impor ini dari daftar? File asli tetap tersimpan dan dapat dipakai membuat run baru dengan sheet yang benar.')) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await api('DELETE', `/projects/${projectId}/rab-imports/${run.id}`);
      setNotice({ kind: 'success', text: 'Run impor dihapus dari daftar. Pilih file dan sheet yang benar untuk membuat run baru.' });
      router.refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (d: DocumentDto) =>
    setSelected((s) => {
      const next = { ...s };
      if (next[d.id]) delete next[d.id];
      else next[d.id] = { role: d.rabSheetCandidates.length ? 'RAB' : 'SUPPORT', sheet: d.rabSheetCandidates.length === 1 ? d.rabSheetCandidates[0]! : '' };
      return next;
    });

  return (
    <div className="space-y-6">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {closed && <Alert kind="info">Proyek ditutup; dokumen dan impor baru tidak dapat dibuat.</Alert>}

      {documents !== null && (
        <section className="space-y-3" aria-labelledby="docs-title">
          <h2 id="docs-title" className="text-base font-semibold">
            Dokumen proyek
          </h2>
          {canUpload && !closed && (
            <form onSubmit={upload} className="panel form-panel flex flex-wrap items-end gap-3" aria-label="Upload dokumen">
              <div>
                <label htmlFor="files" className="field-label">
                  File Excel (.xlsx, maks. 30 MB per file)
                </label>
                <input id="files" name="files" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple className="field" />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Mengunggah…' : 'Upload'}
              </Button>
              <p className="field-hint w-full">RAB, rekap, analisa, upah, bahan, dan alat boleh dalam satu file atau beberapa file (Struktur/Arsitektur/MEP). File asli disimpan lengkap.</p>
            </form>
          )}
          {documents.length === 0 ? (
            <EmptyState>Belum ada dokumen.</EmptyState>
          ) : (
            <div className="panel data-panel">
              <table role="table" className="data-table">
                <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                  <tr role="row">
                    {canReview && <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Pakai</th>}
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">File</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Sheet RAB</th>
                    {canReview && <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Peran di impor</th>}
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Diunggah</th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="divide-y divide-slate-100">
                  {documents.map((d) => {
                    const choice = selected[d.id];
                    return (
                      <tr role="row" key={d.id}>
                        {canReview && (
                          <td role="cell" data-label="Pakai" className="px-3 py-2">
                            <input type="checkbox" aria-label={`Pakai ${d.originalFilename}`} checked={Boolean(choice)} disabled={closed} onChange={() => toggle(d)} />
                          </td>
                        )}
                        <td role="cell" data-label="File" className="px-3 py-2">
                          <a className="link-button" href={`/api/projects/${projectId}/documents/${d.id}/download`}>
                            {d.originalFilename}
                          </a>
                          <span className="block font-mono text-xs text-slate-500">sha256 {d.sha256.slice(0, 12)}…</span>
                        </td>
                        <td role="cell" data-label="Sheet RAB" className="px-3 py-2">
                          {d.rabSheetCandidates.join(', ') || <span className="text-slate-500">— (dokumen pendukung)</span>}
                        </td>
                        {canReview && (
                          <td role="cell" data-label="Peran di impor" className="px-3 py-2">
                            {choice && (
                              <div className="flex flex-wrap gap-2">
                                <Select aria-label="Peran dokumen" value={choice.role} onChange={(e) => setSelected((s) => ({ ...s, [d.id]: { ...choice, role: e.target.value as Choice['role'] } }))}>
                                  <option value="RAB" disabled={!d.rabSheetCandidates.length}>
                                    RAB/rekap utama
                                  </option>
                                  <option value="SUPPORT">Pendukung (analisa/harga)</option>
                                </Select>
                                {choice.role === 'RAB' && d.rabSheetCandidates.length > 1 && (
                                  <Select aria-label="Sheet RAB" value={choice.sheet} onChange={(e) => setSelected((s) => ({ ...s, [d.id]: { ...choice, sheet: e.target.value } }))}>
                                    <option value="">— pilih sheet —</option>
                                    {d.rabSheetCandidates.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </Select>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                        <td role="cell" data-label="Diunggah" className="px-3 py-2 text-sm">
                          {formatDate(d.uploadedAt.slice(0, 10))}
                          <span className="block text-xs text-slate-500">{d.uploadedBy.name}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canReview && !closed && Object.keys(selected).length > 0 && (
            <div className="panel form-panel flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="target" className="field-label">
                  Versi RAB tujuan
                </label>
                <Select id="target" value={target} onChange={(e) => setTarget(e.target.value as RabVersionType)}>
                  <option value="CONTRACT">Kontrak</option>
                  <option value="MC">MC</option>
                </Select>
              </div>
              {target === 'MC' && (
                <div className="w-44">
                  <label htmlFor="mc-number" className="field-label">
                    Nomor MC (0–{MC_MAX_NUMBER})
                  </label>
                  <input
                    id="mc-number"
                    className="field"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MC_MAX_NUMBER}
                    step={1}
                    placeholder="Otomatis"
                    value={mcNumber}
                    onChange={(e) => setMcNumber(e.target.value)}
                  />
                </div>
              )}
              <Button disabled={busy} onClick={createImport}>
                Buat run impor ({Object.keys(selected).length} dokumen)
              </Button>
              <p className="field-hint w-full">Nomor MC memilih blok &ldquo;MC - n&rdquo; di sheet RAB; boleh meloncat asal lebih besar dari MC terakhir, kosong = nomor terkecil yang diizinkan. Hasil impor hanya draft untuk direview. Data resmi dibuat saat impor di-approve; RAB hasilnya tetap DRAFT sampai di-approve di tab RAB.</p>
            </div>
          )}
        </section>
      )}

      {imports !== null && (
        <section className="space-y-3" aria-labelledby="runs-title">
          <h2 id="runs-title" className="text-base font-semibold">
            Run impor
          </h2>
          {imports.length === 0 ? (
            <EmptyState>Belum ada run impor.</EmptyState>
          ) : (
            <div className="panel data-panel">
              <table role="table" className="data-table">
                <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                  <tr role="row">
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Versi</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Status</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Dokumen</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Dibuat</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="divide-y divide-slate-100">
                  {imports.map((r) => (
                    <tr role="row" key={r.id}>
                      <td role="cell" data-label="Versi" className="px-3 py-2 font-medium">
                        {rabVersionLabel({ versionType: r.targetVersionType, revisionNumber: r.targetRevisionNumber })}
                        {r.attemptNumber > 1 && <span className="block text-xs text-slate-500">percobaan {r.attemptNumber}</span>}
                      </td>
                      <td role="cell" data-label="Status" className="px-3 py-2">
                        <Badge tone={IMPORT_STATUS[r.status].tone}>{IMPORT_STATUS[r.status].label}</Badge>
                        {r.status === 'NEEDS_REVIEW' && <span className="block text-xs text-slate-500">{r.blockingIssues} masalah perlu keputusan</span>}
                        {r.errorMessage && <span className="block text-xs text-slate-500">{r.errorMessage}</span>}
                      </td>
                      <td role="cell" data-label="Dokumen" className="px-3 py-2 text-sm">
                        {r.documents.map((d) => d.originalFilename).join(', ')}
                      </td>
                      <td role="cell" data-label="Dibuat" className="px-3 py-2 text-sm">
                        {formatDate(r.createdAt.slice(0, 10))}
                        <span className="block text-xs text-slate-500">{r.createdBy.name}</span>
                      </td>
                      <td role="cell" data-label="Aksi">
                        <div className="row-actions">
                          <Link className="btn btn-secondary" href={`/projects/${projectId}/imports/${r.id}`}>
                            {r.status === 'NEEDS_REVIEW' ? 'Review' : 'Lihat'}
                          </Link>
                          {canReview && !closed && !r.rabVersionId && ['FAILED', 'REJECTED', 'NEEDS_REVIEW'].includes(r.status) && (
                            <Button variant="secondary" disabled={busy} onClick={() => removeImport(r)} aria-label={`Hapus run impor ${r.documents.map((d) => d.originalFilename).join(', ')}`}>
                              Hapus
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
