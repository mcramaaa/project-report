'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { Icon } from './icon';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

/** One file in the list. The parent owns the array and updates `status`/`progress` while uploading. */
export type UploadItem = {
  key: string;
  file: File;
  status: UploadStatus;
  /** 0 to 1. */
  progress: number;
  error?: string;
};

export function newUploadItem(file: File): UploadItem {
  return {
    key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    status: 'pending',
    progress: 0,
  };
}

/** Client-side check only (type and size). The API validates again and is the real boundary. */
export function checkFile(
  file: File,
  { accept, maxBytes }: { accept?: string; maxBytes?: number },
): string | undefined {
  if (maxBytes !== undefined && file.size > maxBytes)
    return `${file.name}: ukuran melebihi batas ${formatBytes(maxBytes)}.`;
  if (accept) {
    const rules = accept
      .split(',')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    const ok = rules.some((rule) =>
      rule.startsWith('.')
        ? name.endsWith(rule)
        : rule.endsWith('/*')
          ? type.startsWith(rule.slice(0, -1))
          : type === rule,
    );
    if (!ok) return `${file.name}: jenis file tidak didukung.`;
  }
  return undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1).replace('.', ',')} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Upload queue for one dropzone: each file is sent alone (own request, own progress bar), one after another.
 * Finished and failed rows are replaced when the next batch starts.
 */
export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);

  const patch = (key: string, change: Partial<UploadItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...change } : i)));

  async function upload<T>(
    files: File[],
    send: (file: File, onProgress: (fraction: number) => void) => Promise<T>,
  ): Promise<{ results: T[]; failed: number }> {
    const fresh = files.map(newUploadItem);
    setItems((prev) => [
      ...prev.filter((i) => i.status === 'pending' || i.status === 'uploading'),
      ...fresh,
    ]);
    const results: T[] = [];
    let failed = 0;
    for (const item of fresh) {
      patch(item.key, { status: 'uploading', progress: 0, error: undefined });
      try {
        results.push(await send(item.file, (progress) => patch(item.key, { progress })));
        patch(item.key, { status: 'done', progress: 1 });
      } catch (err) {
        failed += 1;
        patch(item.key, { status: 'error', error: errorMessage(err) });
      }
    }
    return { results, failed };
  }

  return {
    items,
    busy: items.some((i) => i.status === 'uploading'),
    upload,
    remove: (key: string) => setItems((prev) => prev.filter((i) => i.key !== key)),
  };
}

/**
 * Reusable drag-and-drop file picker with a per-file progress list.
 * Controlled: the parent keeps `items`, receives new files through `onFiles`, and runs the upload itself.
 */
export function FileDropzone({
  label,
  hint,
  accept,
  maxBytes,
  multiple = false,
  disabled = false,
  items,
  onFiles,
  onRemove,
}: {
  label: string;
  hint?: string;
  accept?: string;
  maxBytes?: number;
  multiple?: boolean;
  disabled?: boolean;
  items: UploadItem[];
  onFiles: (files: File[]) => void;
  onRemove?: (key: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const busy = items.some((i) => i.status === 'uploading');

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = multiple ? Array.from(list) : [list[0]];
    const errors: string[] = [];
    const valid: File[] = [];
    for (const file of picked) {
      const problem = checkFile(file, { accept, maxBytes });
      if (problem) errors.push(problem);
      else valid.push(file);
    }
    setRejected(errors);
    if (valid.length > 0) onFiles(valid);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(event.dataTransfer.files);
  }

  const inactive = disabled || busy;

  return (
    <div className="dropzone-wrap">
      <div
        className="dropzone"
        data-dragging={dragging || undefined}
        data-disabled={inactive || undefined}
        onDragOver={(event) => {
          if (inactive) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Icon name="folder" size={24} />
        <div className="dropzone-text">
          <span id={`${id}-label`} className="dropzone-label">
            {label}
          </span>
          <span className="dropzone-hint">
            {hint ?? 'Seret file ke sini, atau pilih dari komputer.'}
            {maxBytes !== undefined && ` Maks. ${formatBytes(maxBytes)}.`}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={inactive}
          aria-labelledby={`${id}-label`}
          onClick={() => input.current?.click()}
        >
          Pilih file
        </button>
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept={accept}
          multiple={multiple}
          disabled={inactive}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul className="dropzone-errors" role="alert">
          {rejected.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="upload-list" aria-label="Daftar file">
          {items.map((item) => {
            const percent = Math.round(item.progress * 100);
            return (
              <li key={item.key} className="upload-item" data-status={item.status}>
                <div className="upload-item-head">
                  <span className="upload-name" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className="upload-meta">
                    {formatBytes(item.file.size)} ·{' '}
                    {item.status === 'done' ? (
                      <span className="upload-ok">
                        <Icon name="check" size={14} /> Selesai
                      </span>
                    ) : item.status === 'error' ? (
                      <span className="upload-fail">Gagal</span>
                    ) : item.status === 'uploading' ? (
                      `${percent}%`
                    ) : (
                      'Menunggu'
                    )}
                  </span>
                  {onRemove && item.status !== 'uploading' && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Hapus ${item.file.name}`}
                      onClick={() => onRemove(item.key)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
                <div
                  className="upload-bar"
                  role="progressbar"
                  aria-label={`Progres ${item.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <span style={{ width: `${item.status === 'done' ? 100 : percent}%` }} />
                </div>
                {item.status === 'error' && item.error && (
                  <p className="field-error">{item.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
