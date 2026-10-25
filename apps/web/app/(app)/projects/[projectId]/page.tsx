import type { ProjectDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { Alert, PageTitle } from '@/components/ui';
import { serverGet } from '@/lib/server-api';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { status, data: p } = await serverGet<ProjectDto>(`/projects/${encodeURIComponent(projectId)}`);
  if (status === 404) notFound();
  if (!p) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  const rows: [string, string | number][] = [
    ['Kegiatan', p.activityName],
    ['Sub kegiatan', p.subActivityName],
    ['Lokasi', p.location],
    ['Tahun anggaran', p.fiscalYear],
    ['Kontraktor', p.contractorName],
    ['Konsultan', p.consultantName],
    ['Kontrak', `${p.contractNumber} (${p.contractDate})`],
    ['SPMK', `${p.spmkNumber} (${p.spmkDate})`],
    ['Tanggal mulai', p.startDate],
    ['Masa pelaksanaan', `${p.durationDays} hari kalender`],
  ];

  return (
    <>
      <PageTitle subtitle={p.code}>{p.projectName}</PageTitle>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-[12rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="text-sm text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
