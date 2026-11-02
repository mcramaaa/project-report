import type {
  DailyReportDto,
  MyProjectDto,
  Paginated,
  ProjectDto,
  ReportTemplatesDto,
  ReportType,
  WeeklyReportDto,
  WeeklyReportSummaryDto,
} from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { dailyDoc, type ReportDoc } from '@/components/report-document';
import { Alert } from '@/components/ui';
import { identityOf } from '@/lib/report-print';
import { serverGet } from '@/lib/server-api';
import { TemplateEditor } from './template-editor';

/** D-082: per-project report templates, previewed on the latest finished week and its last day. */
export default async function ReportTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ projectId }, { type }] = await Promise.all([params, searchParams]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, templates, weeks, projects] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<ReportTemplatesDto>(`${base}/report-templates`),
    serverGet<WeeklyReportSummaryDto[]>(`${base}/weekly-reports`),
    serverGet<Paginated<MyProjectDto>>('/projects?pageSize=100'),
  ]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  if (!templates.data) return <Alert>Template laporan tidak dapat dimuat.</Alert>;

  const last = weeks.data?.filter((w) => w.ended).at(-1);
  const [weekly, daily] = last
    ? await Promise.all([
        serverGet<WeeklyReportDto>(`${base}/weekly-reports/${last.weekNumber}`),
        serverGet<DailyReportDto>(`${base}/daily-reports/${last.endDate}`),
      ])
    : [undefined, undefined];
  const samples: Partial<Record<ReportType, ReportDoc>> = {};
  if (daily?.data) samples.DAILY = dailyDoc(identityOf(project), daily.data);
  if (weekly?.data) {
    samples.WEEKLY = {
      kind: 'WEEKLY',
      label: String(weekly.data.summary.weekNumber),
      content: weekly.data.content,
    };
    // Monthly reports come with M13; until then the preview shows the latest week in the monthly layout.
    samples.MONTHLY = {
      kind: 'MONTHLY',
      label: String(Math.ceil(weekly.data.summary.weekNumber / 4)),
      content: weekly.data.content,
    };
  }

  return (
    <>
      <ProjectHeader project={project} active="info" />
      <TemplateEditor
        projectId={project.id}
        initial={templates.data}
        samples={samples}
        initialType={type === 'WEEKLY' || type === 'MONTHLY' ? type : 'DAILY'}
        canEdit={project.permissions.includes('project.update') && project.status === 'ACTIVE'}
        otherProjects={(projects.data?.items ?? [])
          .filter((p) => p.id !== project.id)
          .map((p) => ({ id: p.id, label: `${p.code} · ${p.projectName}` }))}
      />
    </>
  );
}
