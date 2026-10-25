'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

const FALLBACK: Record<number, string> = {
  403: 'Anda tidak memiliki izin untuk aksi ini.',
  404: 'Data tidak ditemukan.',
  429: 'Terlalu banyak percobaan. Coba lagi nanti.',
};

/** Same-origin call to the API through the /api rewrite. The browser sends Origin + session cookie. */
export async function api<T = void>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server.');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (res.ok) return data as T;

  if (res.status === 401 && path !== '/auth/login') {
    // Session ended (expired, revoked, user deactivated). Outside React, so a full navigation is the simplest reset.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }
  const fieldErrors: Record<string, string> = {};
  for (const e of (data?.errors ?? []) as { path: string; message: string }[]) fieldErrors[e.path] ??= e.message;
  const message = typeof data?.message === 'string' ? data.message : (FALLBACK[res.status] ?? 'Terjadi kesalahan. Coba lagi.');
  throw new ApiError(res.status, message, fieldErrors);
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.';
}
