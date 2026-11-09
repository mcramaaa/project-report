'use client';

import {
  defaultReportTemplate,
  LOGO_KINDS,
  LOGO_LABELS,
  REPORT_TYPE_LABELS,
  REPORT_TYPES,
  type LogoKind,
  type ReportSignature,
  type ReportTemplateConfig,
  type ReportTemplatesDto,
  type ReportType,
  type ReportWorkbookDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useLeaveWarning } from '@/components/grid-tools';
import { ReportDocument, type ReportDoc } from '@/components/report-document';
import { Alert, Button, Section, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { logoUrls } from '@/lib/report-print';

type Move = (i: number, dir: -1 | 1) => void;
const move = <T,>(xs: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

const clamp = (v: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

function Group({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="tpl-group" open={open}>
      <summary>{title}</summary>
      <div className="tpl-group-body">{children}</div>
    </details>
  );
}

function OrderButtons({
  i,
  n,
  onMove,
  label,
}: {
  i: number;
  n: number;
  onMove: Move;
  label: string;
}) {
  return (
    <span className="tpl-order">
      <button
        type="button"
        aria-label={`Naikkan ${label}`}
        disabled={i === 0}
        onClick={() => onMove(i, -1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Turunkan ${label}`}
        disabled={i === n - 1}
        onClick={() => onMove(i, 1)}
      >
        ↓
      </button>
    </span>
  );
}

const EMPTY_SIGNATURE: ReportSignature = {
  caption: '',
  role: '',
  organization: '',
  name: '',
  detail: '',
};

/** D-082 template editor: structured settings on the left, the printed page on the right. */
export function TemplateEditor({
  projectId,
  initial,
  samples,
  initialType,
  canEdit,
  otherProjects,
}: {
  projectId: string;
  initial: ReportTemplatesDto;
  samples: Partial<Record<ReportType, ReportDoc>>;
  initialType: ReportType;
  canEdit: boolean;
  otherProjects: { id: string; label: string }[];
}) {
  const [data, setData] = useState(initial);
  const [type, setType] = useState<ReportType>(initialType);
  const [drafts, setDrafts] = useState<Partial<Record<ReportType, ReportTemplateConfig>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [source, setSource] = useState(otherProjects[0]?.id ?? '');
  const [withLogos, setWithLogos] = useState(true);
  const saved = data.templates.find((t) => t.reportType === type)!;
  const t = drafts[type] ?? saved.config;
  const dirty = Object.keys(drafts).length > 0;
  useLeaveWarning(dirty);

  const set = (patch: (c: ReportTemplateConfig) => ReportTemplateConfig) =>
    setDrafts((d) => ({ ...d, [type]: patch(structuredClone(t)) }));
  async function run(
    action: () => Promise<ReportTemplatesDto>,
    message: string,
    clear: ReportType[] = [],
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setData(await action());
      setDrafts((d) =>
        Object.fromEntries(Object.entries(d).filter(([k]) => !clear.includes(k as ReportType))),
      );
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(
      () => api<ReportTemplatesDto>('PUT', `/projects/${projectId}/report-templates/${type}`, t),
      `Template ${REPORT_TYPE_LABELS[type].toLowerCase()} disimpan.`,
      [type],
    );
  const uploadLogo = (kind: LogoKind, file: File) => {
    const body = new FormData();
    body.append('files', file);
    return run(
      () =>
        api<ReportTemplatesDto>(
          'POST',
          `/projects/${projectId}/report-templates/logos/${kind}`,
          body,
        ),
      `Logo ${LOGO_LABELS[kind].toLowerCase()} disimpan.`,
    );
  };
  const logoUrl = logoUrls(projectId, data);
  const sample = samples[type];

  return (
    <div className="mt-4 space-y-4">
      <Section
        title="Template laporan"
        description="Atur tampilan cetak dan PDF laporan proyek ini. Pratinjau di kanan sama dengan hasil cetak."
        action={
          <div className="row-actions">
            {REPORT_TYPES.map((r) => (
              <Button
                key={r}
                type="button"
                variant={r === type ? 'primary' : 'secondary'}
                onClick={() => setType(r)}
              >
                {REPORT_TYPE_LABELS[r]}
                {drafts[r] ? ' •' : ''}
              </Button>
            ))}
          </div>
        }
      >
        <div className="space-y-3">
          {notice && <Alert kind="success">{notice}</Alert>}
          {error && <Alert>{error}</Alert>}
          {!canEdit && (
            <Alert kind="info">Hanya pemegang izin ubah proyek yang dapat mengubah template.</Alert>
          )}
          <div className="tpl-logos">
            {LOGO_KINDS.map((kind) => {
              const url = logoUrl(kind);
              return (
                <div key={kind} className="tpl-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private API image */}
                  {url ? <img src={url} alt={LOGO_LABELS[kind]} /> : <span>Belum ada logo</span>}
                  <p>{LOGO_LABELS[kind]}</p>
                  {canEdit && (
                    <div className="row-actions">
                      <label className="btn btn-secondary">
                        {url ? 'Ganti' : 'Unggah'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void uploadLogo(kind, f);
                          }}
                        />
                      </label>
                      {url && (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api<ReportTemplatesDto>(
                                  'DELETE',
                                  `/projects/${projectId}/report-templates/logos/${kind}`,
                                ),
                              'Logo dihapus.',
                            )
                          }
                        >
                          Hapus
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <WorkbookCard
            type={type}
            workbook={data.workbooks.find((w) => w.reportType === type)}
            pdf={data.workbookPdf}
            canEdit={canEdit}
            busy={busy}
            onUpload={(file) => {
              const body = new FormData();
              body.append('files', file);
              void run(
                () =>
                  api<ReportTemplatesDto>(
                    'POST',
                    `/projects/${projectId}/report-templates/workbooks/${type}`,
                    body,
                  ),
                'File Excel kantor disimpan. Ekspor Excel dan PDF memakai file ini.',
              );
            }}
            onRemove={() => {
              if (
                window.confirm('Hapus file Excel kantor? Ekspor kembali memakai layout template.')
              )
                void run(
                  () =>
                    api<ReportTemplatesDto>(
                      'DELETE',
                      `/projects/${projectId}/report-templates/workbooks/${type}`,
                    ),
                  'File Excel kantor dihapus.',
                );
            }}
          />
          {canEdit && otherProjects.length > 0 && (
            <div className="tpl-import">
              <div className="min-w-0 flex-1">
                <label htmlFor="tpl-source" className="field-label">
                  Impor template dari proyek lain
                </label>
                <Select id="tpl-source" value={source} onChange={(e) => setSource(e.target.value)}>
                  {otherProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="tpl-line">
                <input
                  type="checkbox"
                  checked={withLogos}
                  onChange={(e) => setWithLogos(e.target.checked)}
                />{' '}
                ikut logo
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !source}
                onClick={() => {
                  if (
                    window.confirm(
                      'Template harian, mingguan, dan bulanan proyek ini diganti dengan milik proyek sumber. Lanjutkan?',
                    )
                  )
                    void run(
                      () =>
                        api<ReportTemplatesDto>(
                          'POST',
                          `/projects/${projectId}/report-templates/import`,
                          { sourceProjectId: source, includeLogos: withLogos },
                        ),
                      'Template diimpor.',
                      [...REPORT_TYPES],
                    );
                }}
              >
                Impor
              </Button>
            </div>
          )}
        </div>
      </Section>

      <div className="tpl-layout">
        <fieldset className="tpl-form surface" disabled={!canEdit || busy}>
          <div className="tpl-form-head">
            <b>{REPORT_TYPE_LABELS[type]}</b>
            <span>
              {saved.updatedAt
                ? `Disimpan ${saved.updatedBy?.name ?? ''}`
                : 'Masih bawaan (format Excel kantor)'}
            </span>
          </div>

          <Group title="Kertas" open>
            <div className="tpl-row">
              <Select
                aria-label="Ukuran kertas"
                value={t.page.size}
                onChange={(e) =>
                  set((c) => ((c.page.size = e.target.value as typeof c.page.size), c))
                }
              >
                <option value="A4">A4</option>
                <option value="F4">F4 (Folio)</option>
                <option value="LEGAL">Legal</option>
              </Select>
              <Select
                aria-label="Orientasi"
                value={t.page.orientation}
                onChange={(e) =>
                  set(
                    (c) => ((c.page.orientation = e.target.value as typeof c.page.orientation), c),
                  )
                }
              >
                <option value="portrait">Tegak</option>
                <option value="landscape">Mendatar</option>
              </Select>
            </div>
            <div className="tpl-row">
              <label>
                Margin (mm)
                <input
                  className="field"
                  type="number"
                  min={5}
                  max={30}
                  value={t.page.marginMm}
                  onChange={(e) => set((c) => ((c.page.marginMm = Number(e.target.value) || 5), c))}
                />
              </label>
              <label>
                Huruf (pt)
                <input
                  className="field"
                  type="number"
                  min={6}
                  max={14}
                  step={0.5}
                  value={t.page.fontSizePt}
                  onChange={(e) =>
                    set((c) => ((c.page.fontSizePt = Number(e.target.value) || 9), c))
                  }
                />
              </label>
              <label>
                Desimal volume
                <input
                  className="field"
                  type="number"
                  min={0}
                  max={6}
                  value={t.decimals}
                  onChange={(e) => set((c) => ((c.decimals = Number(e.target.value) || 0), c))}
                />
              </label>
            </div>
          </Group>

          {type !== 'DAILY' && (
            <Group title="Layout laporan" open>
              <label>
                Layout halaman
                <Select
                  value={t.layout === 'office' ? 'office' : 'stacked'}
                  onChange={(e) => set((c) => ((c.layout = e.target.value as typeof c.layout), c))}
                >
                  <option value="office">
                    Format kantor: sampul, rekap, progres, time schedule
                  </option>
                  <option value="stacked">Bertumpuk dalam satu dokumen</option>
                </Select>
              </label>
              {t.layout === 'office' && (
                <p className="text-sm text-[var(--muted)]">
                  Setiap bagian yang tampil menjadi satu halaman: Sampul (tegak), Rekap, Progres,
                  dan Time Schedule. Ringkasan dan Rangkuman harian hanya dipakai di layout
                  bertumpuk.
                </p>
              )}
            </Group>
          )}

          {type === 'DAILY' && (
            <Group title="Format laporan harian" open>
              <label>
                Layout halaman
                <Select
                  value={t.layout}
                  onChange={(e) => set((c) => ((c.layout = e.target.value as typeof c.layout), c))}
                >
                  <option value="columns">Kolom berdampingan (format kantor)</option>
                  <option value="stacked">Bertumpuk</option>
                </Select>
              </label>
              {t.layout === 'columns' && (
                <>
                  <label className="tpl-line">
                    <input
                      type="checkbox"
                      checked={t.daily.fitToPage}
                      onChange={(e) => set((c) => ((c.daily.fitToPage = e.target.checked), c))}
                    />{' '}
                    Muat dalam satu halaman (diperkecil otomatis bila isi panjang)
                  </label>
                  <div className="tpl-row">
                    <label>
                      Baris tabel minimal
                      <input
                        className="field"
                        type="number"
                        min={0}
                        max={60}
                        value={t.daily.minRows}
                        onChange={(e) =>
                          set((c) => ((c.daily.minRows = clamp(e.target.value, 0, 60)), c))
                        }
                      />
                    </label>
                    <label>
                      Tinggi logo (mm)
                      <input
                        className="field"
                        type="number"
                        min={8}
                        max={40}
                        value={t.daily.logoHeightMm}
                        onChange={(e) =>
                          set((c) => ((c.daily.logoHeightMm = clamp(e.target.value, 8, 40)), c))
                        }
                      />
                    </label>
                  </div>
                  <div className="tpl-row">
                    {(
                      [
                        ['weekLabel', 'Label minggu'],
                        ['dayLabel', 'Label hari'],
                        ['dateLabel', 'Label tanggal'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k}>
                        {label}
                        <input
                          className="field"
                          maxLength={30}
                          value={t.daily[k]}
                          onChange={(e) => set((c) => ((c.daily[k] = e.target.value), c))}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="tpl-row">
                    <label>
                      Label jumlah tenaga kerja
                      <input
                        className="field"
                        maxLength={30}
                        value={t.daily.totalLabel}
                        onChange={(e) => set((c) => ((c.daily.totalLabel = e.target.value), c))}
                      />
                    </label>
                    <label>
                      Satuan jumlah
                      <input
                        className="field"
                        maxLength={15}
                        value={t.daily.totalUnit}
                        onChange={(e) => set((c) => ((c.daily.totalUnit = e.target.value), c))}
                      />
                    </label>
                  </div>
                  <div className="tpl-row">
                    {(
                      [
                        ['clear', 'Cuaca cerah'],
                        ['cloudy', 'Mendung/gerimis'],
                        ['rain', 'Hujan'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k}>
                        {label}
                        <input
                          className="field"
                          maxLength={30}
                          value={t.daily.weatherLabels[k]}
                          onChange={(e) =>
                            set((c) => ((c.daily.weatherLabels[k] = e.target.value), c))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
              <label>
                Judul kelompok staf
                <input
                  className="field"
                  maxLength={60}
                  value={t.laborGroups.staffTitle}
                  onChange={(e) => set((c) => ((c.laborGroups.staffTitle = e.target.value), c))}
                />
              </label>
              <label>
                Keahlian yang termasuk staf (satu per baris; kosongkan untuk satu daftar)
                <textarea
                  className="field"
                  rows={5}
                  value={t.laborGroups.staffNames.join('\n')}
                  onChange={(e) =>
                    set(
                      (c) => (
                        (c.laborGroups.staffNames = e.target.value.split('\n').slice(0, 40)),
                        c
                      ),
                    )
                  }
                />
              </label>
              <label className="tpl-line">
                <input
                  type="checkbox"
                  checked={t.daily.showAllStaff}
                  onChange={(e) => set((c) => ((c.daily.showAllStaff = e.target.checked), c))}
                />{' '}
                Tampilkan semua staf walau hari itu kosong
              </label>
              <label>
                Judul kelompok tenaga kerja lainnya
                <input
                  className="field"
                  maxLength={60}
                  value={t.laborGroups.workerTitle}
                  onChange={(e) => set((c) => ((c.laborGroups.workerTitle = e.target.value), c))}
                />
              </label>
            </Group>
          )}

          <Group title="Kop dan judul">
            <label className="tpl-line">
              <input
                type="checkbox"
                checked={t.header.showLogos}
                onChange={(e) => set((c) => ((c.header.showLogos = e.target.checked), c))}
              />{' '}
              Tampilkan logo
            </label>
            {LOGO_KINDS.map((k) => (
              <label key={k}>
                Keterangan logo {LOGO_LABELS[k].toLowerCase()} (kosongkan untuk menyembunyikan)
                <input
                  className="field"
                  maxLength={60}
                  value={t.header.logoCaptions[k]}
                  onChange={(e) => set((c) => ((c.header.logoCaptions[k] = e.target.value), c))}
                />
              </label>
            ))}
            <label>
              Baris kop (satu baris per baris)
              <textarea
                className="field"
                rows={4}
                value={t.header.lines.join('\n')}
                placeholder={'PEMERINTAH KOTA …\nDINAS …\nJL. …'}
                onChange={(e) =>
                  set((c) => ((c.header.lines = e.target.value.split('\n').slice(0, 6)), c))
                }
              />
            </label>
            <label>
              Judul laporan
              <input
                className="field"
                maxLength={120}
                value={t.title}
                onChange={(e) => set((c) => ((c.title = e.target.value), c))}
              />
            </label>
          </Group>

          <Group title="Identitas proyek">
            {t.identity.map((f, i) => (
              <div key={f.key} className="tpl-line">
                <input
                  type="checkbox"
                  aria-label={`Tampilkan ${f.label}`}
                  checked={f.visible}
                  onChange={(e) => set((c) => ((c.identity[i]!.visible = e.target.checked), c))}
                />
                <input
                  className="field"
                  aria-label="Label"
                  maxLength={60}
                  value={f.label}
                  onChange={(e) => set((c) => ((c.identity[i]!.label = e.target.value), c))}
                />
                <OrderButtons
                  i={i}
                  n={t.identity.length}
                  label={f.label}
                  onMove={(a, d) => set((c) => ((c.identity = move(c.identity, a, d)), c))}
                />
              </div>
            ))}
          </Group>

          <Group title="Bagian laporan dan kolom">
            {t.sections.map((s, i) => (
              <div key={s.key} className="tpl-section">
                <div className="tpl-line">
                  <input
                    type="checkbox"
                    aria-label={`Tampilkan ${s.title}`}
                    checked={s.visible}
                    onChange={(e) => set((c) => ((c.sections[i]!.visible = e.target.checked), c))}
                  />
                  <input
                    className="field"
                    aria-label="Judul bagian"
                    maxLength={120}
                    value={s.title}
                    onChange={(e) => set((c) => ((c.sections[i]!.title = e.target.value), c))}
                  />
                  <OrderButtons
                    i={i}
                    n={t.sections.length}
                    label={s.title}
                    onMove={(a, d) => set((c) => ((c.sections = move(c.sections, a, d)), c))}
                  />
                </div>
                {s.visible &&
                  type === 'DAILY' &&
                  t.layout === 'columns' &&
                  s.width !== undefined && (
                    <label className="tpl-line tpl-width">
                      Lebar tabel
                      <input
                        type="range"
                        min={30}
                        max={200}
                        value={s.width}
                        aria-label={`Lebar ${s.title}`}
                        onChange={(e) =>
                          set((c) => ((c.sections[i]!.width = clamp(e.target.value, 10, 400)), c))
                        }
                      />
                      <span>{s.width}</span>
                    </label>
                  )}
                {s.visible && s.columns.length > 0 && (
                  <div className="tpl-columns">
                    {s.columns.map((col, j) => (
                      <label key={col.key} className="tpl-line">
                        <input
                          type="checkbox"
                          aria-label={`Tampilkan kolom ${col.label}`}
                          checked={col.visible}
                          onChange={(e) =>
                            set((c) => ((c.sections[i]!.columns[j]!.visible = e.target.checked), c))
                          }
                        />
                        <input
                          className="field"
                          aria-label="Judul kolom"
                          maxLength={80}
                          value={col.label}
                          onChange={(e) =>
                            set((c) => ((c.sections[i]!.columns[j]!.label = e.target.value), c))
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Group>

          <Group title={`Tanda tangan (${t.signatures.length})`}>
            {t.signatures.map((s, i) => (
              <div key={i} className="tpl-signature">
                <div className="tpl-line">
                  <b className="text-sm">Kolom {i + 1}</b>
                  <OrderButtons
                    i={i}
                    n={t.signatures.length}
                    label={`tanda tangan ${i + 1}`}
                    onMove={(a, d) => set((c) => ((c.signatures = move(c.signatures, a, d)), c))}
                  />
                  <button
                    type="button"
                    className="link-button text-sm"
                    onClick={() =>
                      set((c) => ((c.signatures = c.signatures.filter((_, k) => k !== i)), c))
                    }
                  >
                    Hapus
                  </button>
                </div>
                {(
                  [
                    ['caption', 'Keterangan (mis. Diperiksa Oleh :)'],
                    ['role', 'Jabatan'],
                    ['organization', 'Instansi / perusahaan'],
                    ['name', 'Nama'],
                    ['detail', 'Di bawah nama (NIP / jabatan rinci)'],
                  ] as const
                ).map(([k, label]) => (
                  <input
                    key={k}
                    className="field"
                    aria-label={label}
                    placeholder={label}
                    maxLength={160}
                    value={s[k]}
                    onChange={(e) => set((c) => ((c.signatures[i]![k] = e.target.value), c))}
                  />
                ))}
              </div>
            ))}
            {t.signatures.length < 6 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  set((c) => ((c.signatures = [...c.signatures, { ...EMPTY_SIGNATURE }]), c))
                }
              >
                + Tambah kolom tanda tangan
              </Button>
            )}
          </Group>

          <div className="tpl-actions">
            <Button type="button" disabled={!drafts[type] || busy} onClick={() => void save()}>
              {busy ? 'Menyimpan…' : 'Simpan template'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!drafts[type]}
              onClick={() =>
                setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== type)))
              }
            >
              Batal
            </Button>
            <button
              type="button"
              className="link-button text-sm"
              onClick={() => set(() => defaultReportTemplate(type))}
            >
              Kembalikan bawaan
            </button>
          </div>
        </fieldset>

        <div className="tpl-preview" aria-label="Pratinjau cetak">
          {sample ? (
            <>
              <p className="tpl-preview-note">
                Pratinjau dengan data{' '}
                {sample.kind === 'DAILY'
                  ? `laporan harian ${sample.date}`
                  : sample.kind === 'MONTHLY'
                    ? `bulan B.${sample.label}`
                    : `minggu M.${sample.label}`}
                .{' '}
                <Link
                  className="link-button"
                  href={`/print/projects/${projectId}/${
                    sample.kind === 'DAILY'
                      ? `daily/${sample.date}`
                      : `${sample.kind === 'WEEKLY' ? 'weekly' : 'monthly'}/${sample.label}`
                  }`}
                >
                  Buka halaman cetak
                </Link>
              </p>
              <div className="tpl-preview-page">
                <ReportDocument template={t} doc={sample} logoUrl={logoUrl} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Pratinjau tampil setelah ada minggu proyek yang selesai.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

/** D-086: the office's own workbook; when present, exports fill it instead of building the layout. */
function WorkbookCard({
  type,
  workbook,
  pdf,
  canEdit,
  busy,
  onUpload,
  onRemove,
}: {
  type: ReportType;
  workbook: ReportWorkbookDto | undefined;
  pdf: boolean;
  canEdit: boolean;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  // What the app writes into each office workbook (D-086, D-087, D-088).
  const sheets = {
    DAILY: [
      'Cov.n dan Har.n per minggu',
      'Har.n; sheet minggu baru disalin otomatis',
      'laporan harian per hari',
    ],
    WEEKLY: ['C.n, RM.n, M.n, Curva S M.n', 'M.n', 'progres per item'],
    MONTHLY: ['C.n, RB.n, B.n, CS B.n', 'B.n', 'progres per item'],
  }[type];
  return (
    <div className="tpl-workbook">
      <div className="min-w-0">
        <b>File Excel kantor</b>
        {workbook ? (
          <p>
            {workbook.originalName} ·{' '}
            {(workbook.fileSize / 1024 / 1024).toFixed(1).replace('.', ',')} MB · diunggah{' '}
            {workbook.updatedBy.name}, {formatDateTime(workbook.updatedAt)}
            {!pdf &&
              '. Ekspor Excel memakai file ini; PDF dari file ini menunggu LibreOffice terpasang di server, sementara Ekspor PDF memakai layout template.'}
          </p>
        ) : (
          <p>
            Unggah workbook {REPORT_TYPE_LABELS[type].toLowerCase()} kantor (berisi sheet{' '}
            {sheets[0]}). Aplikasi mengisi {sheets[2]} ke sheet {sheets[1]}; tampilan, rumus, logo,
            dan kurva tetap milik file itu, sehingga Excel dan PDF sama persis dengan file kantor.
          </p>
        )}
      </div>
      {canEdit && (
        <div className="row-actions">
          <label className="btn btn-secondary">
            {workbook ? 'Ganti file' : 'Unggah file Excel'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onUpload(f);
              }}
            />
          </label>
          {workbook && (
            <Button type="button" variant="secondary" disabled={busy} onClick={onRemove}>
              Hapus
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
