import type { ProjectDto, ScenarioDetailDto, SCurveDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/icon';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert } from '@/components/ui';
import { serverGet } from '@/lib/server-api';
import { ScenarioEditor } from './scenario-editor';

export default async function ScenarioPage({
  params,
}: {
  params: Promise<{ projectId: string; scenarioId: string }>;
}) {
  const { projectId, scenarioId } = await params;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [{ status, data: project }, scenario, curve] = await Promise.all([
    serverGet<ProjectDto>(base),
    serverGet<ScenarioDetailDto>(`${base}/schedule-scenarios/${encodeURIComponent(scenarioId)}`),
    serverGet<SCurveDto>(`${base}/schedules/s-curve`),
  ]);
  if (status === 404 || scenario.status === 404) notFound();
  if (!project) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={project} active="schedule" />
      <Link className="page-back mt-4" href={`${base}/schedule#scenarios`}>
        <Icon name="arrow-left" size={14} />
        Semua skenario
      </Link>
      {scenario.status === 403 ? (
        <Alert>Role Anda di proyek ini tidak memiliki izin melihat jadwal.</Alert>
      ) : !scenario.data ? (
        <Alert>Skenario tidak dapat dimuat.</Alert>
      ) : (
        <ScenarioEditor
          projectId={project.id}
          initial={scenario.data}
          official={curve.data ?? null}
          canEdit={project.status === 'ACTIVE' && project.permissions.includes('schedule.edit')}
        />
      )}
    </>
  );
}
