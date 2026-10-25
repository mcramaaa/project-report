import type { ProjectDto, ProjectTeamMemberDto, ProjectWeekDto, ReportPeriodDto } from '@laporan-proyek/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, EmptyState, PageTitle } from '@/components/ui';
import { can } from '@/lib/permissions';
import { formatDate, formatRupiah } from '@/lib/project-fields';
import { requireMe, serverGet } from '@/lib/server-api';
import { ProjectActions } from './project-actions';

type Tab = 'info' | 'calendar' | 'team';
const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Informasi' },
  { key: 'calendar', label: 'Minggu & Periode' },
  { key: 'team', label: 'Tim' },
];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ projectId }, { tab: rawTab }, me] = await Promise.all([params, searchParams, requireMe()]);
  const tab: Tab = TABS.some((t) => t.key === rawTab) ? (rawTab as Tab) : 'info';
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const { status, data: p } = await serverGet<ProjectDto>(base);
  if (status === 404) notFound();
  if (status === 403) return <Alert>Role Anda di proyek ini tidak memiliki izin untuk melihat data proyek.</Alert>;
  if (!p) return <Alert>Proyek tidak dapat dimuat.</Alert>;

  return (
    <>
      <PageTitle
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.code}</span>
            {p.status === 'CLOSED' ? <Badge tone="red">Ditutup</Badge> : <Badge tone="green">Aktif</Badge>}
          </span>
        }
      >
        {p.projectName}
      </PageTitle>
      <nav className="access-tabs" aria-label="Bagian proyek">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === 'info' ? base : `${base}?tab=${t.key}`} aria-current={t.key === tab ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'info' && <InfoTab project={p} />}
      {tab === 'calendar' && <CalendarTab base={base} />}
      {tab === 'team' && <TeamTab base={base} projectId={p.id} canSeeAccess={can(me, 'assignments.read')} />}
    </>
  );
}

function InfoTab({ project: p }: { project: ProjectDto }) {
  const groups: [string, [string, string | number][]][] = [
    [
      'Identitas',
      [
        ['Kegiatan', p.activityName],
        ['Sub kegiatan', p.subActivityName],
        ['Nama pekerjaan', p.projectName],
        ['Lokasi', p.location],
        ['Tahun anggaran', p.fiscalYear],
      ],
    ],
    [
      'Kontrak',
      [
        ['Kontraktor', p.contractorName],
        ['Konsultan', p.consultantName],
        ['Nomor kontrak', p.contractNumber],
        ['Tanggal kontrak', formatDate(p.contractDate)],
        ['Nilai kontrak', formatRupiah(p.contractValue)],
      ],
    ],
    [
      'SPMK & jadwal',
      [
        ['Nomor SPMK', p.spmkNumber],
        ['Tanggal SPMK', formatDate(p.spmkDate)],
        ['Tanggal mulai', formatDate(p.startDate)],
        ['Masa pelaksanaan', `${p.durationDays} hari kalender`],
        ['Tanggal selesai rencana', formatDate(p.plannedFinishDate)],
      ],
    ],
  ];
  return (
    <div className="space-y-6">
      {groups.map(([title, rows]) => (
        <section key={title} aria-labelledby={`info-${title}`} className="space-y-2">
          <h2 id={`info-${title}`} className="text-base font-semibold">
            {title}
          </h2>
          <dl className="panel detail-list">
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {p.permissions.includes('project.update') && <ProjectActions project={p} />}
    </div>
  );
}

async function CalendarTab({ base }: { base: string }) {
  const [weeks, periods] = await Promise.all([serverGet<ProjectWeekDto[]>(`${base}/weeks`), serverGet<ReportPeriodDto[]>(`${base}/report-periods`)]);
  if (!weeks.data || !periods.data) return <Alert>Minggu dan periode tidak dapat dimuat.</Alert>;
  if (weeks.data.length === 0) return <EmptyState>Belum ada minggu proyek.</EmptyState>;
  return (
    <div className="space-y-6">
      {periods.data.map((period) => (
        <section key={period.id} className="space-y-2" aria-labelledby={`period-${period.periodNumber}`}>
          <h2 id={`period-${period.periodNumber}`} className="flex flex-wrap items-center gap-2 text-base font-semibold">
            B{period.periodNumber} · {formatDate(period.startDate)} – {formatDate(period.endDate)}
            <span className="text-sm font-normal text-slate-500">
              M{period.firstWeekNumber}–M{period.lastWeekNumber}, {period.days} hari
            </span>
            {period.days < 28 && <Badge>Periode pendek</Badge>}
          </h2>
          <div className="panel data-panel">
            <table role="table" className="data-table">
              <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
                <tr role="row">
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Minggu</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Mulai</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Selesai</th>
                  <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Hari</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="divide-y divide-slate-100">
                {weeks.data!
                  .filter((w) => w.periodNumber === period.periodNumber)
                  .map((w) => (
                    <tr role="row" key={w.id}>
                      <td role="cell" data-label="Minggu" className="px-3 py-2 font-medium">M{w.weekNumber}</td>
                      <td role="cell" data-label="Mulai" className="px-3 py-2">{formatDate(w.startDate)}</td>
                      <td role="cell" data-label="Selesai" className="px-3 py-2">{formatDate(w.endDate)}</td>
                      <td role="cell" data-label="Hari" className="px-3 py-2">
                        {w.days}
                        {w.days < 7 && <span className="ml-2"><Badge>Minggu pendek</Badge></span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

async function TeamTab({ base, projectId, canSeeAccess }: { base: string; projectId: string; canSeeAccess: boolean }) {
  const { data: team } = await serverGet<ProjectTeamMemberDto[]>(`${base}/team`);
  if (!team) return <Alert>Tim proyek tidak dapat dimuat.</Alert>;
  return (
    <div className="space-y-3">
      {canSeeAccess && (
        <Link href={`/admin/projects/${projectId}/members`} className="btn btn-secondary">
          Kelola akses proyek
        </Link>
      )}
      {team.length === 0 ? (
        <EmptyState>Belum ada anggota aktif.</EmptyState>
      ) : (
        <div className="panel data-panel">
          <table role="table" className="data-table">
            <thead role="rowgroup" className="bg-slate-50 text-left text-slate-600">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Nama</th>
                <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {team.map((m) => (
                <tr role="row" key={m.userId}>
                  <td role="cell" data-label="Nama" className="px-3 py-2">{m.name}</td>
                  <td role="cell" data-label="Role" className="px-3 py-2"><Badge tone="blue">{m.role.name}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
