import { Badge, PageTitle } from '@/components/ui';
import { requireMe } from '@/lib/server-api';
import { ChangePasswordForm } from './change-password-form';

export default async function ProfilePage() {
  const me = await requireMe();
  return (
    <>
      <PageTitle subtitle="Kelola informasi akun dan jaga keamanan akses Anda.">Profil & keamanan</PageTitle>
      <div className="profile-grid">
        <section className="panel profile-card" aria-labelledby="profile-name">
          <span className="avatar">{me.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()}</span>
          <h2 id="profile-name">{me.name}</h2>
          <p className="profile-email">{me.email}</p>
          <Badge tone="blue">{me.isSystemAdmin ? 'Super admin' : me.permissions.length ? 'Admin akses' : 'Anggota proyek'}</Badge>
          <p className="mt-6 border-t border-slate-100 pt-5 text-xs leading-6 text-slate-500">Untuk perubahan informasi akun, hubungi administrator. Akses proyek mengikuti keanggotaan dan role yang diberikan.</p>
        </section>
        <section className="panel security-card" aria-labelledby="security-title">
          <h2 id="security-title">Ganti password</h2>
          <p>Gunakan password yang kuat dan berbeda dari akun lain.</p>
          <ChangePasswordForm />
        </section>
      </div>
    </>
  );
}
