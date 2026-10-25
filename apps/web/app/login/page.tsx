import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if (await getMe()) redirect('/');
  const { changed } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Laporan Proyek</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Masuk dengan akun yang dibuat oleh administrator.</p>
        <LoginForm passwordChanged={changed === '1'} />
      </div>
    </main>
  );
}
