'use client';

import {
  MC_MAX_NUMBER,
  RAB_BUILTIN_PROFILE,
  RAB_PROFILE_ROLES,
  RAB_PROFILE_SECTIONS,
  WORD_MATCHES,
  rabProfileSchema,
  type DocumentDto,
  type RabImportSummaryDto,
  type RabProfile,
  type RabProfileAssistDto,
  type RabProfileDto,
  type RabProfilePreviewDto,
  type RabVersionType,
  type WordMatch,
  type WordMatcher,
  type WorkbookPreviewDto,
} from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, EmptyState, Section, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { SEVERITY_TONE } from '@/lib/import-ui';
import { formatDate, formatRupiah } from '@/lib/project-fields';

/** RAB_PLAYGROUND stage 2: edit a mapping profile, preview what a run would read, save it, import with it. */

type Editable = Omit<RabProfile, 'origin'>;
type Source = { role: 'RAB' | 'SUPPORT'; sheet: string; sheets: string[] | null };

const MATCH_LABEL: Record<WordMatch, string> = {
  EXACT: 'Sama persis',
  PREFIX: 'Diawali',
  WORD: 'Diawali kata utuh',
  CONTAINS: 'Memuat',
};

const editableSchema = rabProfileSchema.omit({ origin: true });

/** A copy to edit; starting from the built-in profile leaves the name empty so a saved copy is never "Bawaan". */
function editable(p: RabProfile): Editable {
  const copy: Partial<RabProfile> = structuredClone(p);
  delete copy.origin;
  if (p.origin === 'BAWAAN') copy.name = '';
  return copy as Editable;
}
const getAt = (o: unknown, path: string[]): unknown => path.reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], o);
function setAt<T>(o: T, path: string[], value: unknown): T {
  const next = structuredClone(o);
  let cur = next as Record<string, unknown>;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[path.at(-1)!] = value;
  return next;
}
/** Words as the readers compare them: uppercase, single-spaced. */
const parseWords = (text: string) =>
  text
    .split(',')
    .map((w) => w.toUpperCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const TOTAL_STATUS = {
  MATCH: { label: 'Sama dengan Excel', tone: 'green' },
  FLOAT_RESIDUE: { label: 'Selisih pembulatan Excel', tone: 'blue' },
  MISMATCH: { label: 'Berbeda dari Excel', tone: 'red' },
} as const;
const ISSUES_SHOWN = 200;

export function ProfilePlayground({
  projectId,
  closed,
  canApprove,
  documents,
  initialProfiles,
}: {
  projectId: string;
  closed: boolean;
  /** D-096: only managers change the project default. */
  canApprove: boolean;
  documents: DocumentDto[];
  initialProfiles: RabProfileDto[];
}) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initialProfiles);
  /** Saved profile the editor started from; null = built-in. */
  const [baseId, setBaseId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Editable>(() => editable(RAB_BUILTIN_PROFILE));
  const [dirty, setDirty] = useState(false);
  /** Remounts the word inputs when a whole profile is loaded. */
  const [revision, setRevision] = useState(0);
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [target, setTarget] = useState<RabVersionType>('CONTRACT');
  const [mcNumber, setMcNumber] = useState('');
  const [preview, setPreview] = useState<RabProfilePreviewDto>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<RabProfileAssistDto>();
  /** Shown in the assistant panel, where the reviewer is looking. */
  const [assistError, setAssistError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();

  // The name only matters for saving; every other problem also stops the preview.
  const check = editableSchema.safeParse(profile);
  const problems = check.success
    ? []
    : check.error.issues
        .filter((i) => i.path[0] !== 'name')
        .map((i) => {
          const r = RAB_PROFILE_ROLES.find((x) => x.path.split('.').every((k, n) => i.path[n] === k));
          return `${r?.label ?? (i.path.join('.') || 'Profil')}: ${i.code === 'too_small' ? 'isi minimal satu kata' : i.message}`;
        });
  const nameMissing = profile.name.trim() === '';
  const selected = profiles.find((p) => p.id === baseId);
  const chosen = Object.entries(sources);
  const savedClean = baseId !== null && !dirty;

  function edit(path: string[], value: unknown) {
    setProfile((p) => setAt(p, path, value));
    setDirty(true);
    setPreview(undefined);
  }

  function loadBase(id: string) {
    if (dirty && !window.confirm('Perubahan profil yang belum disimpan akan hilang. Lanjutkan?')) return;
    const saved = profiles.find((p) => p.id === id);
    setBaseId(saved ? saved.id : null);
    setProfile(editable(saved ? saved.profile : RAB_BUILTIN_PROFILE));
    setDirty(false);
    setPreview(undefined);
    setRevision((n) => n + 1);
  }

  async function toggle(d: DocumentDto) {
    if (sources[d.id]) {
      setSources((s) => {
        const next = { ...s };
        delete next[d.id];
        return next;
      });
      return;
    }
    setSources((s) => ({ ...s, [d.id]: { role: 'RAB', sheet: d.rabSheetCandidates[0] ?? '', sheets: null } }));
    try {
      // Every sheet, not only the built-in candidates: a profile may read a sheet the built-in profile does not know.
      const { sheets } = await api<WorkbookPreviewDto>('GET', `/projects/${projectId}/documents/${d.id}/preview`);
      setSources((s) => (s[d.id] ? { ...s, [d.id]: { ...s[d.id]!, sheets } } : s));
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    }
  }

  const runBody = () => ({
    targetVersionType: target,
    ...(target === 'MC' && mcNumber !== '' ? { targetRevisionNumber: Number(mcNumber) } : {}),
    sources: chosen.map(([documentId, s]) => ({
      documentId,
      role: s.role,
      ...(s.role === 'RAB' && s.sheet ? { rabSheet: s.sheet } : {}),
    })),
  });

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const runPreview = () =>
    act(async () => {
      setPreview(await api<RabProfilePreviewDto>('POST', `/projects/${projectId}/rab-profiles/preview`, { ...runBody(), profile }));
    });

  async function ask() {
    setBusy(true);
    setAssistError(undefined);
    setAnswer(undefined);
    try {
      setAnswer(await api<RabProfileAssistDto>('POST', `/projects/${projectId}/rab-profiles/assist`, { ...runBody(), profile, message: question }));
    } catch (err) {
      setAssistError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Only words the system proved reach the editor; the reviewer still saves the profile. */
  function applyAnswer(a: RabProfileAssistDto) {
    setProfile({ ...a.profile, name: profile.name });
    setDirty(true);
    setPreview(a.after);
    setAnswer(undefined);
    setRevision((n) => n + 1);
  }

  const save = () =>
    act(async () => {
      const saved = await api<RabProfileDto>('POST', `/projects/${projectId}/rab-profiles`, { profile });
      setProfiles((list) => [saved, ...list]);
      setBaseId(saved.id);
      setDirty(false);
      setNotice({ kind: 'success', text: `Profil "${saved.name}" disimpan. Profil tersimpan tidak pernah diubah; simpan lagi untuk versi baru.` });
    });

  /** D-096: new runs read with this profile unless they name another. */
  const setDefault = (isDefault: boolean) =>
    act(async () => {
      if (isDefault) {
        await api('POST', `/projects/${projectId}/rab-profiles/${baseId}/default`, {});
        setProfiles((list) => list.map((p) => ({ ...p, isDefault: p.id === baseId })));
        setNotice({ kind: 'success', text: `"${selected?.name}" menjadi profil default proyek. Run baru memakainya kecuali dipilih lain.` });
      } else {
        await api('DELETE', `/projects/${projectId}/rab-profiles/default`);
        setProfiles((list) => list.map((p) => ({ ...p, isDefault: false })));
        setNotice({ kind: 'success', text: 'Default proyek dihapus. Run baru kembali memakai profil bawaan.' });
      }
    });

  const createImport = () =>
    act(async () => {
      const run = await api<RabImportSummaryDto>('POST', `/projects/${projectId}/rab-imports`, { ...runBody(), mappingProfileId: baseId });
      router.push(`/projects/${projectId}/imports/${run.id}`);
    });

  return (
    <div className="space-y-6">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {closed && <Alert kind="info">Proyek ditutup; profil dan impor baru tidak dapat dibuat.</Alert>}
      <Alert kind="info">
        Profil hanya mengatur kata judul kolom dan label yang dicari. Semua angka tetap dibaca dari sel Excel dan dibuktikan
        dengan rumusnya; pratinjau tidak menyimpan apa pun dan tidak mengirim isi workbook ke luar server.
      </Alert>

      <Section title="Dokumen" description="Pilih dokumen dan sheet yang akan dibaca dengan profil ini." id="pg-docs">
        {documents.length === 0 ? (
          <EmptyState>Belum ada dokumen. Unggah dokumen di halaman Impor RAB.</EmptyState>
        ) : (
          <div className="space-y-4">
            <table role="table" className="data-table">
              <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                <tr role="row">
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Pakai</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">File</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Peran dan sheet</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="divide-y divide-slate-100">
                {documents.map((d) => {
                  const s = sources[d.id];
                  return (
                    <tr role="row" key={d.id}>
                      <td role="cell" data-label="Pakai" className="px-3 py-2">
                        <input type="checkbox" aria-label={`Pakai ${d.originalFilename}`} checked={Boolean(s)} onChange={() => void toggle(d)} />
                      </td>
                      <td role="cell" data-label="File" className="px-3 py-2">{d.originalFilename}</td>
                      <td role="cell" data-label="Peran dan sheet" className="px-3 py-2">
                        {s && (
                          <div className="flex flex-wrap gap-2">
                            <Select
                              aria-label={`Peran ${d.originalFilename}`}
                              value={s.role}
                              onChange={(e) => setSources((all) => ({ ...all, [d.id]: { ...s, role: e.target.value as Source['role'] } }))}
                            >
                              <option value="RAB">RAB/rekap utama</option>
                              <option value="SUPPORT">Pendukung (analisa/harga)</option>
                            </Select>
                            {s.role === 'RAB' && (
                              <Select
                                aria-label={`Sheet RAB ${d.originalFilename}`}
                                value={s.sheet}
                                onChange={(e) => setSources((all) => ({ ...all, [d.id]: { ...s, sheet: e.target.value } }))}
                              >
                                <option value="">Otomatis</option>
                                {(s.sheets ?? d.rabSheetCandidates).map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="pg-target" className="field-label">Versi RAB tujuan</label>
                <Select id="pg-target" value={target} onChange={(e) => setTarget(e.target.value as RabVersionType)}>
                  <option value="CONTRACT">Kontrak</option>
                  <option value="MC">MC</option>
                </Select>
              </div>
              {target === 'MC' && (
                <div className="w-44">
                  <label htmlFor="pg-mc" className="field-label">Nomor MC (0–{MC_MAX_NUMBER})</label>
                  <input id="pg-mc" className="field" type="number" inputMode="numeric" min={0} max={MC_MAX_NUMBER} step={1} placeholder="Otomatis" value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} />
                </div>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Asisten AI"
        description="Tanyakan kenapa kolom tidak terbaca atau beri petunjuk; asisten hanya mengusulkan kata, sistem membuktikannya."
        id="pg-assist"
      >
        <div className="space-y-3">
          <Alert kind="warning">
            Pertanyaan ini mengirim ke model AI lewat 9router (penyedia eksternal): daftar sheet, 40 baris pertama sheet
            terpilih, rumus dan nilai di baris bermasalah, ringkasan masalah, dan aturan profil. Workbook utuh tidak dikirim;
            setiap kiriman dicatat.
          </Alert>
          <div>
            <label htmlFor="pg-question" className="field-label">Pertanyaan atau petunjuk</label>
            <textarea
              id="pg-question"
              className="field"
              rows={3}
              maxLength={2000}
              placeholder="mis. Kolom volume di sheet BOQ berjudul Banyaknya"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <Button disabled={busy || chosen.length === 0 || problems.length > 0 || question.trim() === ''} onClick={ask}>
            Tanya asisten
          </Button>
          {assistError && <Alert>{assistError}</Alert>}
          {answer && <AssistAnswer answer={answer} onApply={() => applyAnswer(answer)} />}
        </div>
      </Section>

      <Section
        title="Profil pemetaan"
        description="Kata judul kolom dan label yang dicari pembaca. Pisahkan beberapa kata dengan koma."
        id="pg-profile"
      >
        <div className="space-y-5">
          <div className="form-grid">
            <div>
              <label htmlFor="pg-base" className="field-label">Mulai dari</label>
              <Select id="pg-base" value={baseId ?? ''} onChange={(e) => loadBase(e.target.value)}>
                <option value="">Profil bawaan</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.isDefault ? ' · default proyek' : ''} · {formatDate(p.createdAt.slice(0, 10))} · {p.createdBy.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="pg-name" className="field-label">Nama profil</label>
              <input
                id="pg-name"
                className="field"
                maxLength={120}
                placeholder="mis. BOQ Dinas PU 2026"
                aria-describedby="pg-name-hint"
                value={profile.name}
                onChange={(e) => edit(['name'], e.target.value)}
              />
              <p id="pg-name-hint" className="field-hint">Wajib diisi untuk menyimpan.</p>
            </div>
          </div>
          {RAB_PROFILE_SECTIONS.map((section) => (
            <fieldset key={section.title} className="profile-section">
              <legend className="font-semibold">{section.title}</legend>
              <p className="field-hint">{section.description}</p>
              {section.roles.map((r) => {
                const path = r.path.split('.');
                const id = path.join('-');
                if (!r.many) {
                  return (
                    <MatcherRow key={`${revision}-${id}`} id={id} label={r.label} matcher={getAt(profile, path) as WordMatcher} onChange={(m) => edit(path, m)} />
                  );
                }
                const list = getAt(profile, path) as WordMatcher[];
                return (
                  <div key={`${revision}-${id}-${list.length}`} className="profile-role">
                    {list.map((m, n) => (
                      <MatcherRow
                        key={n}
                        id={`${id}-${n}`}
                        label={n === 0 ? r.label : `${r.label} (aturan ${n + 1})`}
                        matcher={m}
                        onChange={(next) => edit(path, list.map((x, k) => (k === n ? next : x)))}
                        onRemove={list.length > 1 ? () => edit(path, list.filter((_, k) => k !== n)) : undefined}
                      />
                    ))}
                    <Button type="button" variant="secondary" className="btn-compact" onClick={() => edit(path, [...list, { match: 'PREFIX', words: [] }])}>
                      Tambah aturan {r.label.toLowerCase()}
                    </Button>
                  </div>
                );
              })}
            </fieldset>
          ))}
          {problems.length > 0 && (
            <Alert kind="warning">
              <p>Perbaiki profil sebelum pratinjau atau simpan:</p>
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          {/* Sticky so the actions stay at hand while scrolling the long editor. */}
          <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
            <span>
              {chosen.length === 0
                ? 'Pilih dokumen untuk pratinjau.'
                : dirty
                  ? 'Ada perubahan yang belum disimpan; run impor hanya memakai profil tersimpan.'
                  : savedClean
                    ? 'Profil tersimpan siap dipakai.'
                    : 'Profil bawaan: simpan sebagai profil proyek untuk dipakai run impor.'}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || chosen.length === 0 || problems.length > 0} onClick={runPreview}>
                Pratinjau
              </Button>
              <Button variant="secondary" disabled={busy || closed || problems.length > 0 || nameMissing || !dirty} onClick={save}>
                Simpan profil
              </Button>
              <Button variant="secondary" disabled={busy || closed || chosen.length === 0 || !savedClean} onClick={createImport}>
                Buat run impor dengan profil ini
              </Button>
              {canApprove && savedClean && !selected?.isDefault && (
                <Button variant="secondary" disabled={busy || closed} onClick={() => setDefault(true)}>
                  Jadikan default proyek
                </Button>
              )}
              {canApprove && selected?.isDefault && (
                <Button variant="secondary" disabled={busy || closed} onClick={() => setDefault(false)}>
                  Hapus default proyek
                </Button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {preview && <PreviewResult preview={preview} />}
    </div>
  );
}

function MatcherRow({
  id,
  label,
  matcher,
  onChange,
  onRemove,
}: {
  id: string;
  label: string;
  matcher: WordMatcher;
  onChange: (m: WordMatcher) => void;
  onRemove?: () => void;
}) {
  const [text, setText] = useState(matcher.words.join(', '));
  return (
    <div className="profile-matcher">
      <label htmlFor={`${id}-words`} className="text-sm">{label}</label>
      <Select aria-label={`${label}: cara cocok`} value={matcher.match} onChange={(e) => onChange({ ...matcher, match: e.target.value as WordMatch })}>
        {WORD_MATCHES.map((m) => (
          <option key={m} value={m}>
            {MATCH_LABEL[m]}
          </option>
        ))}
      </Select>
      <input
        id={`${id}-words`}
        className="field"
        value={text}
        placeholder="KATA, KATA LAIN"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const words = parseWords(text);
          setText(words.join(', '));
          if (words.join('|') !== matcher.words.join('|')) onChange({ ...matcher, words });
        }}
      />
      {onRemove ? (
        <Button type="button" variant="secondary" className="btn-compact" aria-label={`Hapus ${label}`} onClick={onRemove}>
          Hapus
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

function AssistAnswer({ answer, onApply }: { answer: RabProfileAssistDto; onApply: () => void }) {
  const { before, after } = answer;
  const summary = (c: RabProfilePreviewDto['counts']) => `${c.items} item, ${c.analysis} tertaut analisa, ${c.direct} harga langsung`;
  return (
    <div className="panel form-panel space-y-3" aria-live="polite">
      <p className="text-sm">{answer.reply}</p>
      {answer.accepted.length > 0 && (
        <div>
          <p className="field-label">Usulan terbukti</p>
          <ul className="list-disc pl-5 text-sm">
            {answer.accepted.map((a) => (
              <li key={`${a.role}-${a.words.join()}`}>
                {a.label}: {a.words.join(', ')} ({MATCH_LABEL[a.match].toLowerCase()}) · sel {a.cells.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {answer.rejected.length > 0 && (
        <div>
          <p className="field-label">Usulan ditolak sistem</p>
          <ul className="list-disc pl-5 text-sm">
            {answer.rejected.map((r, n) => (
              <li key={n}>
                {r.words.join(', ')} · {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm">
        Sebelum: {before ? summary(before) : 'pembaca berhenti'} · Dengan usulan:{' '}
        {after.error ? `pembaca berhenti (${after.error})` : summary(after.counts)}
      </p>
      <p className="field-hint">
        Terkirim {answer.sent.characters.toLocaleString('id-ID')} karakter dari sheet {answer.sent.sheets.join(', ') || '—'} · model {answer.model}
      </p>
      {answer.accepted.length > 0 && (
        <Button variant="secondary" onClick={onApply}>
          Pakai usulan di editor
        </Button>
      )}
    </div>
  );
}

function PreviewResult({ preview }: { preview: RabProfilePreviewDto }) {
  if (preview.error) {
    return (
      <Section title="Hasil pratinjau" id="pg-result">
        <Alert>{preview.error}</Alert>
      </Section>
    );
  }
  const { counts, reconciliation: rec, issues } = preview;
  const status = rec?.totalStatus ? TOTAL_STATUS[rec.totalStatus] : null;
  return (
    <Section title="Hasil pratinjau" description="Yang akan dibaca run impor dengan profil ini." id="pg-result">
      <div className="space-y-5">
        <dl className="analysis-stats">
          <div>
            <dt>Item pekerjaan</dt>
            <dd>{counts.items}</dd>
          </div>
          <div>
            <dt>Tertaut analisa</dt>
            <dd>{counts.analysis}</dd>
            <span>{counts.analyses} analisa terbaca</span>
          </div>
          <div>
            <dt>Harga langsung</dt>
            <dd>{counts.direct}</dd>
          </div>
          <div>
            <dt>Belum tertaut</dt>
            <dd>{counts.unresolved + counts.none}</dd>
          </div>
          {rec && (
            <div>
              <dt>Total RAB</dt>
              <dd>{formatRupiah(rec.realCost)}</dd>
              {rec.workbookRealCost ? (
                <span>
                  Excel {formatRupiah(rec.workbookRealCost)} {status && <Badge tone={status.tone}>{status.label}</Badge>}
                </span>
              ) : (
                <span>Workbook tidak memuat baris total untuk dibandingkan.</span>
              )}
            </div>
          )}
        </dl>
        {preview.sources
          .filter((s) => s.role === 'RAB')
          .map((s) => (
            <p key={s.documentId} className="text-sm">
              {s.filename} · sheet <strong>{s.sheet}</strong> · {s.layout === 'HEADER' ? 'dibaca dari kata header' : 'format kantor'}
              {s.block ? ` · blok ${s.block}` : ''}
            </p>
          ))}
        {issues.length === 0 ? (
          <EmptyState>Tidak ada masalah.</EmptyState>
        ) : (
          <div className="panel data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                <tr role="row">
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Tingkat</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Sel</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Masalah</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="divide-y divide-slate-100">
                {issues.slice(0, ISSUES_SHOWN).map((i, n) => (
                  <tr role="row" key={n}>
                    <td role="cell" data-label="Tingkat" className="px-3 py-2">
                      <Badge tone={SEVERITY_TONE[i.severity]}>{i.code}</Badge>
                    </td>
                    <td role="cell" data-label="Sel" className="px-3 py-2 font-mono text-xs">{i.cell ?? '—'}</td>
                    <td role="cell" data-label="Masalah" className="px-3 py-2 text-sm">{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {issues.length > ISSUES_SHOWN && (
              <p className="field-hint px-3 py-2">
                {ISSUES_SHOWN} dari {issues.length} masalah ditampilkan.
              </p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
