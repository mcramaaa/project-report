import type { ProjectDto, ReportTemplatesDto, WeeklyReportDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { requireMe, serverGet } from '@/lib/server-api';
import { WeekNav } from '../week-nav';
import { WeeklyReport } from './weekly-report';

export default async function WeeklyReportPage({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [me, { status, data: project }, report, templates] = await Promise.all([
    requireMe(),
    serverGet<ProjectDto>(base),
    serverGet<WeeklyReportDto>(`${base}/weekly-reports/${encodeURIComponent(weekNumber)}`),
    serverGet<ReportTemplatesDto>(`${base}/report-templates`),
  ]);
  if (status === 404 || report.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      <WeekNav project={project} weekNumber={weekNumber} active="report" />
      {report.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat laporan.</Alert>
      ) : !report.data ? (
        <Alert>Laporan mingguan tidak dapat dimuat.</Alert>
      ) : (
        <WeeklyReport
          projectId={project.id}
          initial={report.data}
          permissions={project.permissions}
          meId={me.id}
          officeWorkbook={
            !!templates.data?.workbookPdf &&
            templates.data.workbooks.some((w) => w.reportType === 'WEEKLY')
          }
        />
      )}
    </>
  );
}
