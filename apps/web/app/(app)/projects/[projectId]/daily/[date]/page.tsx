import type { DailyReportDto, ProjectDto, ReportTemplatesDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/icon';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { DailyReportEditor } from './daily-report-editor';

export default async function DailyReportPage({
  params,
}: {
  params: Promise<{ projectId: string; date: string }>;
}) {
  const { projectId, date } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, report, templates] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<DailyReportDto>(`${base}/daily-reports/${encodeURIComponent(date)}`),
    serverGet<ReportTemplatesDto>(`${base}/report-templates`),
  ]);
  if (status === 404 || report.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="progress" />
      {report.data && (
        <Link
          className="page-back mt-4"
          href={`${base}/progress/${report.data.week.weekNumber}/daily`}
        >
          <Icon name="arrow-left" size={14} />
          Laporan harian M.{report.data.week.weekNumber}
        </Link>
      )}
      {report.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat laporan.</Alert>
      ) : !report.data ? (
        <Alert>Laporan harian tidak dapat dimuat.</Alert>
      ) : (
        <DailyReportEditor
          key={report.data.date}
          projectId={project.id}
          initial={report.data}
          canInput={project.permissions.includes('progress.input')}
          canReopen={project.permissions.includes('report.reopen')}
          officePdf={
            !!templates.data?.workbookPdf &&
            templates.data.workbooks.some((w) => w.reportType === 'DAILY')
          }
        />
      )}
    </>
  );
}
