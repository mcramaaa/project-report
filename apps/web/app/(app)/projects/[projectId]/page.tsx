import type {
  ProjectDto,
  ProjectTeamMemberDto,
  ProjectWeekDto,
  ReportPeriodDto,
} from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/project-tabs';
import { Alert, Badge, EmptyState, Section } from '@/components/ui';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/project-fields';
import { requireMe, serverGet } from '@/lib/server-api';
import { ProjectData } from './project-actions';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const [{ projectId }, me] = await Promise.all([params, requireMe()]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const { status, data: p } = await serverGet<ProjectDto>(base);
  if (status === 404) notFound();
  if (status === 403)
    return <Alert>Role Anda di proyek ini tidak memiliki izin untuk melihat data proyek.</Alert>;
  if (!p) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <ProjectHeader project={p} active="info" />
      <div className="info-layout">
        <InfoTab project={p} />
        <aside className="stack" aria-label="Tim dan kalender proyek">
          <TeamTab base={base} projectId={p.id} canSeeAccess={can(me, 'assignments.read')} />
          <Section
            id="report-templates"
            title="Template laporan"
            description="Kop, logo, bagian, kolom, dan tanda tangan untuk cetak/PDF laporan harian, mingguan, dan bulanan."
            action={
              <Link className="btn btn-secondary" href={`${base}/report-templates`}>
                Atur template
              </Link>
            }
            body={false}
          >
            {null}
          </Section>
        </aside>
      </div>
      <Section
        className="mt-4"
        id="calendar"
        title="Minggu & periode laporan"
        description="Minggu M.n (7 hari) dan periode B.n (4 minggu) dihitung dari tanggal mulai dan masa pelaksanaan."
      >
        <details>
          <summary className="link-button cursor-pointer">Tampilkan daftar minggu</summary>
          <div className="mt-3">
            <CalendarTab base={base} />
          </div>
        </details>
      </Section>
    </>
  );
}

function InfoTab({ project: p }: { project: ProjectDto }) {
  return <ProjectData project={p} canEdit={p.permissions.includes('project.update')} />;
}

async function CalendarTab({ base }: { base: string }) {
  const [weeks, periods] = await Promise.all([
    serverGet<ProjectWeekDto[]>(`${base}/weeks`),
    serverGet<ReportPeriodDto[]>(`${base}/report-periods`),
  ]);
  if (!weeks.data || !periods.data) return <Alert>Minggu dan periode tidak dapat dimuat.</Alert>;
  if (weeks.data.length === 0) return <EmptyState>Belum ada minggu proyek.</EmptyState>;
  const short = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <div className="period-grid">
      {periods.data.map((period) => (
        <article
          key={period.id}
          id={`period-${period.periodNumber}`}
          className="period-card"
          aria-labelledby={`period-${period.periodNumber}-title`}
        >
          <header>
            <h3 id={`period-${period.periodNumber}-title`}>B{period.periodNumber}</h3>
            <span>
              {formatDate(period.startDate)} – {formatDate(period.endDate)} · {period.days} hari
            </span>
            {period.days < 28 && <Badge tone="amber">Periode pendek</Badge>}
          </header>
          <ol>
            {weeks
              .data!.filter((w) => w.periodNumber === period.periodNumber)
              .map((w) => (
                <li key={w.id}>
                  <b>M{w.weekNumber}</b>
                  <span>
                    {short(w.startDate)} – {short(w.endDate)}
                  </span>
                  <span className="tabular-nums">{w.days} hari</span>
                  {w.days < 7 && <Badge tone="amber">pendek</Badge>}
                </li>
              ))}
          </ol>
        </article>
      ))}
    </div>
  );
}

async function TeamTab({
  base,
  projectId,
  canSeeAccess,
}: {
  base: string;
  projectId: string;
  canSeeAccess: boolean;
}) {
  const { data: team } = await serverGet<ProjectTeamMemberDto[]>(`${base}/team`);
  if (!team) return <Alert>Tim proyek tidak dapat dimuat.</Alert>;
  return (
    <Section
      id="team"
      title="Tim proyek"
      body={team.length === 0}
      action={
        canSeeAccess && (
          <Link href={`/admin/projects/${projectId}/members`} className="btn btn-secondary">
            Kelola akses proyek
          </Link>
        )
      }
    >
      {team.length === 0 ? (
        <EmptyState>Belum ada anggota aktif.</EmptyState>
      ) : (
        <div className="data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                  Nama
                </th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                  Role
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {team.map((m) => (
                <tr role="row" key={m.userId}>
                  <td role="cell" data-label="Nama" className="px-3 py-2">
                    {m.name}
                  </td>
                  <td role="cell" data-label="Role" className="px-3 py-2">
                    <Badge tone="blue">{m.role.name}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
