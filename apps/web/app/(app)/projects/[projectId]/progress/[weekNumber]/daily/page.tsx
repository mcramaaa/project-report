import type { DailyAllocationDto, DailyReportDayDto, ProjectDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert, Section } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { DayStrip } from '../day-strip';
import { WeekNav } from '../week-nav';
import { DailyEditor } from './daily-editor';

export default async function DailyAllocationPage({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, daily, days] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<DailyAllocationDto>(`${base}/progress/weeks/${encodeURIComponent(weekNumber)}/daily`),
    serverGet<DailyReportDayDto[]>(`${base}/daily-reports/weeks/${encodeURIComponent(weekNumber)}`),
  ]);
  if (status === 404 || daily.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      <WeekNav project={project} weekNumber={weekNumber} active="daily" />
      {days.data && (
        <Section
          className="mt-3"
          title={`Laporan harian minggu ${weekNumber}`}
          description="Pilih hari untuk mengisi atau melihat laporan hariannya. Hari yang belum tiba belum bisa dibuka."
        >
          <DayStrip projectId={project.id} days={days.data} />
        </Section>
      )}
      {daily.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat progres.</Alert>
      ) : !daily.data ? (
        <Alert>Alokasi harian minggu ini tidak dapat dimuat.</Alert>
      ) : (
        <DailyEditor
          projectId={project.id}
          initial={daily.data}
          canInput={project.permissions.includes('progress.input')}
        />
      )}
    </>
  );
}
