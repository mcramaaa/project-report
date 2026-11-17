'use client';

import type { RabChatProposals, RabImportChatMessageDto, RabImportChatTurnDto, RabProfileAssistDto } from '@laporan-proyek/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Section } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/project-fields';

/**
 * D-096: ask the assistant about this run's draft. An answer may propose profile words; the reviewer applies one and the
 * system makes a new run with a saved profile. Nothing here writes to the RAB itself.
 */
export function ImportChat({ projectId, importId, enabled }: { projectId: string; importId: string; enabled: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState<RabImportChatMessageDto[] | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [applyName, setApplyName] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const base = `/projects/${projectId}/rab-imports/${importId}`;

  useEffect(() => {
    let cancelled = false;
    api<RabImportChatMessageDto[]>('GET', `${base}/chat`)
      .then((list) => !cancelled && setMessages(list))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

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

  async function apply(message: RabImportChatMessageDto) {
    setBusy(true);
    setError(undefined);
    try {
      const run = await api<{ id: string }>('POST', `${base}/chat/${message.id}/apply`, applyName.trim() ? { name: applyName.trim() } : {});
      router.push(`/projects/${projectId}/imports/${run.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Section
      title="Tanya asisten tentang hasil impor"
      description="Asisten membaca hasil impor run ini dan bisa menjawab atau mengusulkan kata judul yang belum dikenali. Setiap usulan dibuktikan dengan sel Excel."
      id="import-chat"
    >
      <div className="space-y-4">
        <Alert kind="warning">
          Pertanyaan dikirim ke model AI lewat 9router (penyedia eksternal): daftar masalah, baris yang belum tertaut, sel di
          sekitarnya, dan riwayat chat ini. Workbook utuh tidak dikirim; setiap kiriman dicatat.
        </Alert>
        {error && <Alert>{error}</Alert>}
        <div ref={log} className="max-h-[28rem] space-y-3 overflow-y-auto" aria-live="polite" aria-label="Riwayat chat">
          {messages === null && !error && <p className="text-sm text-slate-500">Memuat riwayat…</p>}
          {messages?.length === 0 && <EmptyState>Belum ada pertanyaan. Tanyakan misalnya “kenapa item 1.2 belum tertaut?”.</EmptyState>}
          {messages?.map((m) => (
            <ChatBubble key={m.id} message={m} onApply={enabled ? () => apply(m) : undefined} busy={busy} />
          ))}
        </div>
        {enabled ? (
          <div className="space-y-3">
            <label htmlFor="chat-question" className="field-label">
              Pertanyaan atau laporan kekurangan
            </label>
            <textarea
              id="chat-question"
              className="field"
              rows={3}
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
            />
            <div className="flex flex-wrap items-end gap-3">
              <Button disabled={busy || question.trim() === ''} onClick={send}>
                {busy ? 'Menunggu asisten…' : 'Kirim'}
              </Button>
              <div>
                <label htmlFor="chat-apply-name" className="field-label">
                  Nama profil bila dipakai
                </label>
                <input
                  id="chat-apply-name"
                  className="field"
                  maxLength={120}
                  placeholder="mis. BOQ dinas PU"
                  value={applyName}
                  onChange={(e) => setApplyName(e.target.value)}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Chat hanya untuk impor yang sudah dibaca dan belum disetujui.</p>
        )}
      </div>
    </Section>
  );
}

function ChatBubble({ message, onApply, busy }: { message: RabImportChatMessageDto; onApply?: () => void; busy: boolean }) {
  const isUser = message.role === 'USER';
  const proposals = message.proposals;
  return (
    <div className={`rounded-lg p-3 text-sm ${isUser ? 'bg-slate-100' : 'border border-slate-200 bg-white'}`}>
      <p className="mb-1 text-xs text-slate-500">
        {isUser ? `Reviewer${message.createdBy ? ` · ${message.createdBy.name}` : ''}` : 'Asisten'} · {formatDate(message.createdAt.slice(0, 10))}
      </p>
      <p className="whitespace-pre-wrap">{message.content}</p>
      {!isUser && proposals && <ProposalBlock proposals={proposals} onApply={onApply} busy={busy} />}
    </div>
  );
}

function ProposalBlock({ proposals, onApply, busy }: { proposals: RabChatProposals; onApply?: () => void; busy: boolean }) {
  const accepted: RabProfileAssistDto['accepted'] = proposals.accepted;
  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {accepted.length > 0 ? (
        <>
          <p className="font-medium">Usulan terbukti</p>
          <ul className="list-disc pl-5">
            {accepted.map((a) => (
              <li key={`${a.role}-${a.words.join()}`}>
                {a.label}: {a.words.join(', ')} · sel {a.cells.join(', ')}
              </li>
            ))}
          </ul>
          {onApply && (
            <Button variant="secondary" disabled={busy} onClick={onApply}>
              Buat run dengan usulan ini
            </Button>
          )}
          <p className="text-xs text-slate-500">
            Membuat profil baru dan impor ulang dengan profil itu; run ini keluar dari daftar. Profil bisa dijadikan default
            proyek di halaman profil pemetaan.
          </p>
        </>
      ) : (
        <p className="text-slate-600">Tidak ada usulan yang terbukti.</p>
      )}
      {proposals.rejected.length > 0 && (
        <>
          <p className="font-medium">Usulan ditolak sistem</p>
          <ul className="list-disc pl-5 text-slate-600">
            {proposals.rejected.map((r, n) => (
              <li key={n}>
                {r.words.join(', ')} · {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {proposals.model && <Badge tone="slate">{proposals.model}</Badge>}
    </div>
  );
}
