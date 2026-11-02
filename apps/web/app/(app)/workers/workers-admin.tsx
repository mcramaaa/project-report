'use client';

import type { Paginated, WorkerDto, WorkerImportResult } from '@laporan-proyek/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, Button, EmptyState, Field, Loading, Select, SuggestInput } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

const PAGE_SIZE = 50;
type Active = 'true' | 'false' | 'all';

export function WorkersAdmin({ canManage }: { canManage: boolean }) {
  const [query, setQuery] = useState<{ search: string; active: Active; page: number }>({ search: '', active: 'true', page: 1 });
  const [data, setData] = useState<Paginated<WorkerDto>>();
  const [positions, setPositions] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [modal, setModal] = useState<WorkerDto | 'new' | 'import'>();
  const [busyId, setBusyId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(PAGE_SIZE), active: query.active });
    if (query.search) params.set('search', query.search);
    api<Paginated<WorkerDto>>('GET', `/workers?${params}`).then(
      (page) => {
        if (cancelled) return;
        setData(page);
        setLoadError(undefined);
      },
      (err) => !cancelled && setLoadError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  useEffect(() => {
    if (canManage) api<string[]>('GET', '/workers/positions').then(setPositions, () => setPositions([]));
  }, [canManage, reloadKey]);

  async function run(worker: WorkerDto, method: string, path: string, body: unknown, confirmText: string | null, success: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(worker.id);
    setNotice(undefined);
    try {
      await api(method, `/workers/${worker.id}${path}`, body);
      setNotice({ kind: 'success', text: success });
      reload();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusyId(undefined);
    }
  }

  const saved = (text: string) => {
    setModal(undefined);
    setNotice({ kind: 'success', text });
    reload();
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="toolbar">
        <form
          className="flex min-w-0 flex-1 flex-wrap items-end gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setQuery({ search: String(f.get('search') ?? '').trim(), active: f.get('active') as Active, page: 1 });
          }}
        >
          <div className="w-full max-w-xs">
            <Field id="search" name="search" label={canManage ? 'Cari nama, posisi, atau NIK' : 'Cari nama atau posisi'} defaultValue={query.search} />
          </div>
          <div>
            <label htmlFor="active" className="field-label">
              Status
            </label>
            <Select id="active" name="active" defaultValue={query.active}>
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
              <option value="all">Semua</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Cari
          </Button>
        </form>
        {canManage && (
          <div className="row-actions">
            <Button variant="secondary" onClick={() => setModal('import')}>
              Impor Excel
            </Button>
            <Button onClick={() => setModal('new')}>Tambah pekerja</Button>
          </div>
        )}
      </div>

      {modal && (
        <Modal title={modal === 'import' ? 'Impor pekerja dari Excel' : modal === 'new' ? 'Tambah pekerja' : `Ubah ${modal.name}`} onClose={() => setModal(undefined)}>
          {modal === 'import' ? (
            <ImportForm onDone={(r) => saved(`Impor selesai: ${r.created} pekerja baru, ${r.updated} diperbarui.`)} />
          ) : (
            <WorkerForm
              worker={modal === 'new' ? undefined : modal}
              positions={positions}
              onCancel={() => setModal(undefined)}
              onSaved={(w) => saved(modal === 'new' ? `${w.name} ditambahkan.` : `Data ${w.name} disimpan.`)}
            />
          )}
        </Modal>
      )}

      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {loadError && <Alert>{loadError}</Alert>}

      {!data && !loadError ? (
        <Loading />
      ) : data && data.items.length === 0 ? (
        <EmptyState>
          {query.search ? 'Tidak ada pekerja yang cocok dengan pencarian.' : canManage ? 'Belum ada pekerja. Klik "Tambah pekerja" untuk mulai.' : 'Belum ada pekerja.'}
        </EmptyState>
      ) : data ? (
        <div className="panel data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Posisi</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">NIK</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">KTP</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Status</th>
                {canManage && <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Aksi</th>}
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {data.items.map((w) => (
                  <tr role="row" key={w.id}>
                    <td role="cell" data-label="Nama" className="px-3 py-2 font-medium">{w.name}</td>
                    <td role="cell" data-label="Posisi" className="px-3 py-2">{w.position}</td>
                    <td role="cell" data-label="NIK" className="px-3 py-2 tabular-nums">{w.nik}</td>
                    <td role="cell" data-label="KTP" className="px-3 py-2">
                      {!w.hasKtp ? (
                        <span className="text-slate-500">Belum ada</span>
                      ) : canManage ? (
                        <a className="link-button" href={`/api/workers/${w.id}/ktp`} target="_blank" rel="noreferrer">
                          Lihat
                        </a>
                      ) : (
                        <span>Ada</span>
                      )}
                    </td>
                    <td role="cell" data-label="Status" className="px-3 py-2">
                      {w.isActive ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                    </td>
                    {canManage && (
                      <td role="cell" data-label="Aksi">
                        <div className="row-actions">
                          <Button variant="secondary" disabled={busyId === w.id} onClick={() => setModal(w)}>
                            Ubah
                          </Button>
                          {w.isActive ? (
                            <Button
                              variant="secondary"
                              disabled={busyId === w.id}
                              onClick={() => void run(w, 'PATCH', '', { isActive: false }, `Nonaktifkan ${w.name}?`, `${w.name} dinonaktifkan.`)}
                            >
                              Nonaktifkan
                            </Button>
                          ) : (
                            <Button variant="secondary" disabled={busyId === w.id} onClick={() => void run(w, 'PATCH', '', { isActive: true }, null, `${w.name} diaktifkan.`)}>
                              Aktifkan
                            </Button>
                          )}
                          {w.hasKtp && (
                            <Button
                              variant="secondary"
                              disabled={busyId === w.id}
                              onClick={() => void run(w, 'DELETE', '/ktp', undefined, `Hapus foto KTP ${w.name}? File dihapus permanen.`, `Foto KTP ${w.name} dihapus.`)}
                            >
                              Hapus KTP
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.total > data.pageSize && (
        <nav aria-label="Halaman" className="pagination">
          <Button variant="secondary" disabled={query.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>
            Sebelumnya
          </Button>
          <span>
            Halaman {data.page} dari {totalPages} ({data.total} pekerja)
          </span>
          <Button variant="secondary" disabled={query.page >= totalPages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
            Berikutnya
          </Button>
        </nav>
      )}
    </div>
  );
}

/** Create or edit; a chosen KTP file is uploaded right after the data is saved. */
function WorkerForm({ worker, positions, onCancel, onSaved }: { worker?: WorkerDto; positions: string[]; onCancel: () => void; onSaved: (w: WorkerDto) => void }) {
  const [position, setPosition] = useState(worker?.position ?? '');
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const key = worker?.id ?? 'new';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    let saved = worker;
    try {
      const body = { name: form.get('name'), position: form.get('position'), nik: form.get('nik') };
      saved = await api<WorkerDto>(worker ? 'PATCH' : 'POST', worker ? `/workers/${worker.id}` : '/workers', body);
      const file = form.get('ktp');
      if (file instanceof File && file.size > 0) {
        const upload = new FormData();
        upload.append('files', file);
        saved = await api<WorkerDto>('POST', `/workers/${saved.id}/ktp`, upload);
      }
      onSaved(saved);
    } catch (err) {
      // Data saved but the photo failed: say so, so the user retries only the photo.
      setError(saved && saved !== worker ? `Data tersimpan, tetapi foto KTP gagal diunggah: ${errorMessage(err)}` : errorMessage(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`w-name-${key}`} name="name" label="Nama" defaultValue={worker?.name} required error={fieldErrors.name} />
        <div>
          <label htmlFor={`w-position-${key}`} className="field-label">
            Posisi
          </label>
          <SuggestInput
            id={`w-position-${key}`}
            name="position"
            required
            maxLength={150}
            placeholder="mis. Mandor, Tukang Batu"
            aria-invalid={Boolean(fieldErrors.position)}
            value={position}
            suggestions={positions}
            onChange={setPosition}
          />
          {fieldErrors.position && <p className="field-error">{fieldErrors.position}</p>}
        </div>
        <Field
          id={`w-nik-${key}`}
          name="nik"
          label="NIK (16 digit)"
          inputMode="numeric"
          maxLength={19}
          autoComplete="off"
          defaultValue={worker?.nik}
          required
          error={fieldErrors.nik}
        />
        <Field
          id={`w-ktp-${key}`}
          name="ktp"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          label={worker?.hasKtp ? 'Ganti foto KTP (opsional)' : 'Foto KTP (opsional, maks. 5 MB)'}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Menyimpan…' : worker ? 'Simpan' : 'Tambah pekerja'}
        </Button>
      </div>
    </form>
  );
}

function ImportForm({ onDone }: { onDone: (r: WorkerImportResult) => void }) {
  const [error, setError] = useState<{ message: string; rows: string[] }>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('file');
    if (!(file instanceof File) || !file.size) return setError({ message: 'Pilih file Excel (.xlsx).', rows: [] });
    const body = new FormData();
    body.append('files', file);
    setSubmitting(true);
    setError(undefined);
    try {
      onDone(await api<WorkerImportResult>('POST', '/workers/import', body));
    } catch (err) {
      const rows = err instanceof ApiError ? ((err.details as { errors?: unknown[] })?.errors ?? []).filter((e): e is string => typeof e === 'string') : [];
      setError({ message: errorMessage(err), rows });
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>
          Unduh{' '}
          <a className="link-button" href="/api/workers/template">
            template Excel
          </a>
          , lalu isi Nama, Posisi, dan NIK (16 digit) satu pekerja per baris.
        </li>
        <li>NIK yang sudah terdaftar akan memperbarui nama dan posisinya.</li>
        <li>Kalau ada baris yang salah, tidak ada yang disimpan; perbaiki baris yang disebut lalu unggah lagi.</li>
      </ol>
      {error && (
        <Alert>
          {error.message}
          {error.rows.length > 0 && (
            <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5">
              {error.rows.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <Field id="import-file" name="file" type="file" label="File Excel (.xlsx)" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Mengimpor…' : 'Impor'}
        </Button>
      </div>
    </form>
  );
}
