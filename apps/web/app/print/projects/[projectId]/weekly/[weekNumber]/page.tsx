import type { ReportTemplatesDto, WeeklyReportDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { PrintBar } from '@/components/print-bar';
import { pageSize, ReportDocument } from '@/components/report-document';
import { Alert } from '@/components/ui';
import { logoUrls, templateOf } from '@/lib/report-print';
import { requireMe, serverGet } from '@/lib/server-api';

export default async function PrintWeeklyReport({
  params,
}: {
  params: Promise<{ projectId: string; weekNumber: string }>;
}) {
  await requireMe();
  const { projectId, weekNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [report, templates] = await Promise.all([
    serverGet<WeeklyReportDto>(`${base}/weekly-reports/${encodeURIComponent(weekNumber)}`),
    serverGet<ReportTemplatesDto>(`${base}/report-templates`),
  ]);
  if (report.status === 404) notFound();
  if (!report.data || !templates.data) return <Alert>Laporan tidak dapat dimuat.</Alert>;
  const template = templateOf(templates.data, 'WEEKLY');
  return (
    <main className="print-shell">
      <style>{`@page { size: ${pageSize(template).css}; margin: 0; }`}</style>
      <PrintBar
        back={`${base}/progress/${weekNumber}/report`}
        title={`Laporan mingguan M.${weekNumber}`}
        templateHref={`${base}/report-templates?type=WEEKLY`}
      />
      <ReportDocument
        template={template}
        doc={{
          kind: 'WEEKLY',
          label: String(report.data.summary.weekNumber),
          content: report.data.content,
        }}
        logoUrl={logoUrls(projectId, templates.data)}
      />
    </main>
  );
}
