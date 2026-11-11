import { PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server-api';
import { WorkersAdmin } from './workers-admin';

export default async function WorkersPage() {
  const me = await requireMe();
  const canManage = can(me, 'workers.manage');
  return (
    <>
      <PageTitle
        subtitle={
          canManage
            ? 'Daftar pekerja untuk semua proyek. NIK dan foto KTP adalah data pribadi; hanya pemegang izin kelola pekerja yang melihatnya. Pekerja dinonaktifkan, tidak dihapus.'
            : 'Daftar pekerja untuk semua proyek. NIK disamarkan; foto KTP hanya untuk pemegang izin kelola pekerja.'
        }
      >
        Pekerja
      </PageTitle>
      <WorkersAdmin canManage={canManage} />
    </>
  );
}
