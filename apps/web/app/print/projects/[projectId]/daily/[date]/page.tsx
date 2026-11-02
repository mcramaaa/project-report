import type { DailyReportDto, ProjectDto, ReportTemplatesDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { PrintBar } from '@/components/print-bar';
import { dailyDoc, pageSize, ReportDocument } from '@/components/report-document';
import { Alert } from '@/components/ui';
import { identityOf, logoUrls, templateOf } from '@/lib/report-print';
import { requireMe, serverGet } from '@/lib/server-api';

export default async function PrintDailyReport({
  params,
}: {
  params: Promise<{ projectId: string; date: string }>;
}) {
  await requireMe();
  const { projectId, date } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [project, report, templates] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<DailyReportDto>(`${base}/daily-reports/${encodeURIComponent(date)}`),
    serverGet<ReportTemplatesDto>(`${base}/report-templates`),
  ]);
  if (project.status === 404 || report.status === 404) notFound();
  if (!project.data || !report.data || !templates.data)
    return <Alert>Laporan tidak dapat dimuat.</Alert>;
  const template = templateOf(templates.data, 'DAILY');
  return (
    <main className="print-shell">
      <style>{`@page { size: ${pageSize(template).css}; margin: 0; }`}</style>
      <PrintBar
        back={`${base}/daily/${date}`}
        title={`Laporan harian ${date}`}
        templateHref={`${base}/report-templates?type=DAILY`}
        excelHref={`/api${base}/exports/daily/${date}`}
      />
      <ReportDocument
        template={template}
        doc={dailyDoc(identityOf(project.data), report.data)}
        logoUrl={logoUrls(project.data.id, templates.data)}
      />
    </main>
  );
}
