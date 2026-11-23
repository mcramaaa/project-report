'use client';

import type {
  RabChatEdit,
  RabChatProposals,
  RabImportChatMessageDto,
  RabImportChatTurnDto,
  RabVersionStatus,
} from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/project-fields';

/**
 * D-096: a floating assistant on the RAB pages. Ask about the import behind this RAB; a proven change to an item can be
 * applied with one click (an approved RAB must be reopened first, as for any correction).
 */
export function RabAssistant({
  projectId,
  importId,
  versionStatus,
}: {
  projectId: string;
  importId: string;
  versionStatus: RabVersionStatus;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<RabImportChatMessageDto[] | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const log = useRef<HTMLDivElement>(null);
  const base = `/projects/${projectId}/rab-imports/${importId}`;
  /** Items can change only while the RAB is a draft or being corrected (RAB_CORRECTIONS.md). */
  const editable = versionStatus === 'DRAFT' || versionStatus === 'REOPENED';

  useEffect(() => {
    if (!open || messages !== null) return;
    let cancelled = false;
    api<RabImportChatMessageDto[]>('GET', `${base}/chat`)
      .then((list) => !cancelled && setMessages(list))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [open, messages, base]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, open]);

  async function send() {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setError(undefined);
    try {
      const turn = await api<RabImportChatTurnDto>('POST', `${base}/chat`, { message: text });
      setMessages((list) => [...(list ?? []), turn.user, turn.assistant]);
      setQuestion('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Marks one proposal as applied on the client; the server marks it too, so a reload shows the same. */
  function markApplied(messageId: string, index: number) {
    setMessages((list) =>
      list?.map((m) =>
        m.id === messageId && m.proposals
          ? { ...m, proposals: { ...m.proposals, edits: m.proposals.edits.map((e, n) => (n === index ? { ...e, applied: true } : e)) } }
          : m,
      ) ?? list,
    );
  }

  async function applyEdit(messageId: string, index: number) {
    setBusy(true);
    setError(undefined);
    try {
      await api('POST', `${base}/chat/${messageId}/edits/${index}/apply`, {});
      markApplied(messageId, index);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Asisten RAB"
          className="fixed bottom-24 right-4 z-40 flex max-h-[70vh] w-[min(440px,calc(100vw-2rem))] flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Asisten RAB</h2>
              <p className="text-xs text-slate-500">Tanya tentang item, analisa, atau masalah impor ini.</p>
            </div>
            <Button variant="secondary" onClick={() => setOpen(false)} aria-label="Tutup asisten">
              Tutup
            </Button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4" ref={log} aria-live="polite" aria-label="Riwayat chat">
            {error && <Alert>{error}</Alert>}
            {messages === null && !error && <p className="text-sm text-slate-500">Memuat riwayat…</p>}
            {messages?.length === 0 && (
              <p className="text-sm text-slate-600">
                Contoh: &ldquo;kenapa item 1.2 belum tertaut?&rdquo; atau &ldquo;volume 1.3 seharusnya 2&rdquo;.
              </p>
            )}
            {messages?.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                editable={editable}
                busy={busy}
                onApply={(index) => applyEdit(m.id, index)}
              />
            ))}
          </div>
          <footer className="space-y-2 border-t border-slate-100 p-3">
            <label htmlFor="rab-assistant-question" className="sr-only">
              Pertanyaan
            </label>
            <textarea
              id="rab-assistant-question"
              className="field"
              rows={2}
              maxLength={2000}
              value={question}
              disabled={busy}
              placeholder="Tulis pertanyaan atau koreksi…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Ctrl+Enter untuk kirim. Pertanyaan dikirim ke AI; workbook utuh tidak.</p>
              <Button disabled={busy || question.trim() === ''} onClick={send}>
                {busy ? 'Menunggu…' : 'Kirim'}
              </Button>
            </div>
          </footer>
        </section>
      )}
      <Button
        className="fixed bottom-4 right-4 z-40 shadow-lg"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Tutup asisten' : 'Tanya asisten'}
      </Button>
    </>
  );
}

function Bubble({
  message,
  editable,
  busy,
  onApply,
}: {
  message: RabImportChatMessageDto;
  editable: boolean;
  busy: boolean;
  onApply: (index: number) => void;
}) {
  const isUser = message.role === 'USER';
  return (
    <div className={`rounded-lg p-3 text-sm ${isUser ? 'bg-slate-100' : 'border border-slate-200'}`}>
      <p className="mb-1 text-xs text-slate-500">
        {isUser ? `Anda${message.createdBy ? ` · ${message.createdBy.name}` : ''}` : 'Asisten'} · {formatDate(message.createdAt.slice(0, 10))}
      </p>
      <p className="whitespace-pre-wrap">{message.content}</p>
      {!isUser && message.proposals && (
        <Proposals proposals={message.proposals} editable={editable} busy={busy} onApply={onApply} />
      )}
    </div>
  );
}

function Proposals({
  proposals,
  editable,
  busy,
  onApply,
}: {
  proposals: RabChatProposals;
  editable: boolean;
  busy: boolean;
  onApply: (index: number) => void;
}) {
  const hasAny = proposals.edits.length > 0 || proposals.rejectedEdits.length > 0 || proposals.accepted.length > 0 || proposals.rejected.length > 0;
  if (!hasAny) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {proposals.edits.length > 0 && (
        <>
          <p className="font-medium">Perubahan item yang terbukti</p>
          <ul className="space-y-2">
            {proposals.edits.map((e, i) => (
              <EditRow key={`${e.itemCode}-${e.field}-${i}`} edit={e} editable={editable} busy={busy} onApply={() => onApply(i)} />
            ))}
          </ul>
          {!editable && (
            <p className="text-xs text-slate-600">
              RAB ini sudah disetujui. Buka kembali RAB (tombol Buka kembali di halaman RAB) untuk menerapkan perubahan.
            </p>
          )}
        </>
      )}
      {proposals.rejectedEdits.length > 0 && (
        <>
          <p className="font-medium">Tidak diterapkan</p>
          <ul className="list-disc pl-5 text-slate-600">
            {proposals.rejectedEdits.map((r, n) => (
              <li key={n}>
                {r.itemCode} {r.field}: {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {proposals.accepted.length > 0 && (
        <>
          <p className="font-medium">Kata judul yang terbukti</p>
          <ul className="list-disc pl-5">
            {proposals.accepted.map((a) => (
              <li key={`${a.role}-${a.words.join()}`}>
                {a.label}: {a.words.join(', ')} · sel {a.cells.join(', ')}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Berlaku untuk impor berikutnya setelah disimpan sebagai profil (Impor RAB → Profil pemetaan).
          </p>
        </>
      )}
    </div>
  );
}

function EditRow({ edit, editable, busy, onApply }: { edit: RabChatEdit; editable: boolean; busy: boolean; onApply: () => void }) {
  return (
    <li className="rounded-md border border-slate-200 p-2">
      <p>
        Item <strong>{edit.itemCode}</strong> · {fieldLabel(edit.field)} → <strong>{edit.value}</strong>
      </p>
      <p className="text-xs text-slate-500">
        Sel {edit.cell} · {edit.reason}
      </p>
      {edit.applied ? (
        <p className="mt-1 text-xs text-green-700">Sudah diterapkan</p>
      ) : (
        <Button variant="secondary" className="mt-2" disabled={busy || !editable} onClick={onApply}>
          Terapkan
        </Button>
      )}
    </li>
  );
}

const fieldLabel = (f: RabChatEdit['field']) => ({ volume: 'volume', unit: 'satuan', taxPercent: 'PPN', description: 'uraian' })[f];
