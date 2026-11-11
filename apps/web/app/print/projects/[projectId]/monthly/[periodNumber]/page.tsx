import type { MonthlyReportDto, ReportTemplatesDto } from '@laporan-proyek/shared';
import { notFound } from 'next/navigation';
import { PrintBar } from '@/components/print-bar';
import { pageSize, ReportDocument } from '@/components/report-document';
import { Alert } from '@/components/ui';
import { logoUrls, templateOf } from '@/lib/report-print';
import { requireMe, serverGet } from '@/lib/server-api';

/** D-087: monthly report B.n printed with the MONTHLY template. */
export default async function PrintMonthlyReport({
  params,
}: {
  params: Promise<{ projectId: string; periodNumber: string }>;
}) {
  await requireMe();
  const { projectId, periodNumber } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [report, templates] = await Promise.all([
    serverGet<MonthlyReportDto>(`${base}/monthly-reports/${encodeURIComponent(periodNumber)}`),
    serverGet<ReportTemplatesDto>(`${base}/report-templates`),
  ]);
  if (report.status === 404) notFound();
  if (!report.data || !templates.data) return <Alert>Laporan tidak dapat dimuat.</Alert>;
  const template = templateOf(templates.data, 'MONTHLY');
  const lastWeek = report.data.weeks.at(-1)!.weekNumber;
  return (
    <main className="print-shell">
      <style>{`@page { size: ${pageSize(template).css}; margin: 0; } @page cover { size: ${pageSize(template, 'portrait').css}; margin: 0; }`}</style>
      <PrintBar
        back={`${base}/progress/${lastWeek}/monthly`}
        title={`Laporan bulanan B.${periodNumber}`}
        templateHref={`${base}/report-templates?type=MONTHLY`}
        excelHref={`/api${base}/exports/monthly/${periodNumber}`}
      />
      <ReportDocument
        template={template}
        doc={{
          kind: 'MONTHLY',
          label: String(report.data.periodNumber),
          content: report.data.content,
        }}
        logoUrl={logoUrls(projectId, templates.data)}
      />
    </main>
  );
}
