import { PageTitle } from '@/components/ui';
import { requireMe } from '@/lib/server-api';
import { ChangePasswordForm } from './change-password-form';

export default async function ProfilePage() {
  const me = await requireMe();
  return (
    <>
      <PageTitle>Profil</PageTitle>
      <dl className="mb-8 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-slate-500">Nama</dt>
        <dd>{me.name}</dd>
        <dt className="text-slate-500">Email</dt>
        <dd>{me.email}</dd>
        <dt className="text-slate-500">System admin</dt>
        <dd>{me.isSystemAdmin ? 'Ya' : 'Tidak'}</dd>
      </dl>
      <h2 className="mb-3 text-base font-semibold">Ganti password</h2>
      <ChangePasswordForm />
    </>
  );
}
