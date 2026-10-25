import { API_PREFIX, type HealthResponse } from '@laporan-proyek/shared';
import { connection } from 'next/server';

async function getApiStatus(): Promise<string> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiUrl}/${API_PREFIX}/health`, { cache: 'no-store' });
    if (!res.ok) return `error (HTTP ${res.status})`;
    const body = (await res.json()) as HealthResponse;
    return body.status;
  } catch {
    return 'tidak terjangkau';
  }
}

export default async function HomePage() {
  await connection(); // render per request so the status is live, not frozen at build
  const apiStatus = await getApiStatus();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Laporan Proyek</h1>
      <p className="mt-2 text-slate-600">Fondasi aplikasi (Milestone 0).</p>
      <p className="mt-6">
        Status API: <span className="font-mono">{apiStatus}</span>
      </p>
    </main>
  );
}
