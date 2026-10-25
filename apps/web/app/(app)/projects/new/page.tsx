import Link from 'next/link';
import { Alert, PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server-api';
import { ProjectWizard } from './project-wizard';

export default async function NewProjectPage() {
  const me = await requireMe();
  return (
    <>
      <Link href="/" className="mb-4 inline-block text-sm text-slate-600 hover:text-slate-900">
        ← Proyek saya
      </Link>
      <PageTitle subtitle="Identitas, kontrak, dan SPMK. Minggu proyek dan periode 4 minggu dibentuk otomatis saat disimpan; Anda menjadi MANAGER proyek ini.">
        Proyek baru
      </PageTitle>
      {can(me, 'projects.create') ? <ProjectWizard /> : <Alert>Anda tidak memiliki izin untuk membuat proyek.</Alert>}
    </>
  );
}
