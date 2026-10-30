import type { ProjectDto, SCurveDto, ScheduleSummaryDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert, Badge, EmptyState, Section } from '@/components/ui';
import { SCHEDULE_STATUS_BADGE } from '@/lib/rab-ui';
import { serverGet } from '@/lib/server-api';
import { CreateSchedule } from './create-schedule';
import { SCurveLegend, SCurveSheet } from './s-curve-chart';
import { ScheduleAnalysis } from './schedule-analysis';

export default async function SchedulesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, schedules, curve] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<ScheduleSummaryDto[]>(`${base}/schedules`),
    serverGet<SCurveDto>(`${base}/schedules/s-curve`),
  ]);
  if (status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;
  const canEdit = project.permissions.includes('schedule.edit') && project.status === 'ACTIVE';

  return (
    <>
      <ProjectHeader project={project} active="schedule" />
      {curve.data && <SCurveSection curve={curve.data} />}
      {curve.data?.baseline && <ScheduleAnalysis data={curve.data} />}
      {schedules.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat jadwal.</Alert>
      ) : !schedules.data ? (
        <Alert>Jadwal tidak dapat dimuat.</Alert>
      ) : schedules.data.length === 0 ? (
        <div className="mt-4">
          <EmptyState>
            Belum ada versi RAB approved. Jadwal disusun per versi RAB approved.
          </EmptyState>
        </div>
      ) : (
        <Section
          className="mt-4"
          title="Jadwal per versi RAB"
          description="Rencana bobot per kelompok pekerjaan per minggu. Kurva S rencana memakai jadwal dari baseline yang berlaku."
          body={false}
        >
          <div className="data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Versi RAB
                  </th>
                  <th role="columnheader" scope="col">
                    Jadwal
                  </th>
                  <th role="columnheader" scope="col">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {schedules.data.map(({ rabVersion, schedule }) => (
                  <tr role="row" key={rabVersion.id}>
                    <td role="cell" data-label="Versi RAB" className="font-medium">
                      {rabVersion.label}
                    </td>
                    <td role="cell" data-label="Jadwal">
                      {schedule ? (
                        <Badge tone={SCHEDULE_STATUS_BADGE[schedule.status].tone}>
                          {SCHEDULE_STATUS_BADGE[schedule.status].label}
                        </Badge>
                      ) : (
                        'Belum dibuat'
                      )}
                    </td>
                    <td role="cell" data-label="Aksi">
                      {schedule ? (
                        <Link
                          className="btn btn-secondary"
                          href={`${base}/schedule/${schedule.id}`}
                        >
                          Buka
                        </Link>
                      ) : canEdit ? (
                        <CreateSchedule
                          projectId={project.id}
                          rabVersionId={rabVersion.id}
                          label={rabVersion.label}
                        />
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

function SCurveSection({ curve }: { curve: SCurveDto }) {
  return (
    <Section
      className="mt-4"
      id="s-curve"
      title="Kurva S"
      description={
        curve.baseline
          ? `% bobot proyek kumulatif per minggu dengan bobot dan jadwal ${curve.baseline.label} (baseline yang berlaku). Garis tegak putus-putus: minggu berjalan; arahkan kursor ke kolom minggu untuk angkanya.`
          : 'Aktifkan baseline di halaman RAB untuk menghitung Kurva S.'
      }
      action={curve.baseline && <SCurveLegend />}
      body={false}
    >
      {curve.baseline && (
        <>
          {curve.schedule?.status !== 'APPROVED' && (
            <div className="surface-body">
              <Alert kind="info">
                Jadwal {curve.baseline.label} belum approved; rencana belum ditampilkan.
              </Alert>
            </div>
          )}
          <SCurveSheet data={curve} />
        </>
      )}
    </Section>
  );
}
