import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { Icon } from '@/components/icon';
import { getMe } from '@/lib/server-api';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if (await getMe()) redirect('/');
  const { changed } = await searchParams;
  return (
    <main className="login-wrap">
      <section className="login-art" aria-label="Ruang kerja konstruksi">
        <Brand />
        <div>
          <p className="eyebrow">Dari lapangan, jadi laporan.</p>
          <h1>Proyek tertata.<br />Progres tercatat.<br />Kerja lebih terarah.</h1>
          <p className="login-description">Ruang kerja bersama untuk mengelola proyek konstruksi dan menjaga setiap informasi tetap terhubung.</p>
          <div className="relative z-10 mt-7 flex flex-wrap gap-2"><span className="badge badge-blue">Satu ruang kerja</span><span className="badge badge-blue">Akses sesuai peran</span></div>
        </div>
        <div className="login-orbit" aria-hidden="true" />
        <footer>LaporanProyek, ruang kerja konstruksi</footer>
      </section>
      <section className="login-form-area" aria-labelledby="login-title">
        <div className="login-form">
          <div className="mb-10 md:hidden"><Brand /></div>
          <span className="metric-icon"><Icon name="lock" size={22} /></span>
          <h2 id="login-title">Selamat datang kembali</h2>
          <p>Masuk untuk melanjutkan pekerjaan Anda.</p>
          <LoginForm passwordChanged={changed === '1'} />
          <div className="login-help">Belum memiliki akses atau mengalami kendala?<br />Hubungi administrator untuk bantuan akun.</div>
        </div>
      </section>
    </main>
  );
}
