import type { LogoKind, ProjectDto, ReportTemplatesDto, ReportType } from '@laporan-proyek/shared';
import type { ReportIdentity } from '@/components/report-document';

/** Logo URL through the same-origin API, versioned so a replaced logo is not served from cache. */
export function logoUrls(projectId: string, data: ReportTemplatesDto): (kind: LogoKind) => string | null {
  return (kind) => {
    const logo = data.logos.find((l) => l.kind === kind);
    return logo ? `/api/projects/${projectId}/report-templates/logos/${kind}?v=${encodeURIComponent(logo.updatedAt)}` : null;
  };
}

export const templateOf = (data: ReportTemplatesDto, type: ReportType) => data.templates.find((t) => t.reportType === type)!.config;

export const identityOf = (p: ProjectDto): ReportIdentity => ({
  activityName: p.activityName,
  subActivityName: p.subActivityName,
  projectName: p.projectName,
  contractNumber: p.contractNumber,
  contractDate: p.contractDate,
  spmkNumber: p.spmkNumber,
  spmkDate: p.spmkDate,
  contractorName: p.contractorName,
  consultantName: p.consultantName,
  location: p.location,
  fiscalYear: p.fiscalYear,
});
