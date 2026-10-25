import type { MeResponse } from '@laporan-proyek/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/** Server-side GET to the API, forwarding the browser's session cookie. */
export async function serverGet<T>(path: string): Promise<{ status: number; data?: T }> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}/api${path}`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : undefined };
}

export async function getMe(): Promise<MeResponse | null> {
  const { status, data } = await serverGet<MeResponse>('/auth/me');
  return status === 200 && data ? data : null;
}

/** For pages behind login. UX only: the API enforces authorization on every call. */
export async function requireMe(): Promise<MeResponse> {
  const me = await getMe();
  if (!me) redirect('/login');
  return me;
}
