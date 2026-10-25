import { isValidIsoDate } from '@laporan-proyek/calc';
import { z } from 'zod';
import type { RoleSummary } from './access.js';

export const PROJECT_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_DURATION_MAX_DAYS = 3650;

const text = (label: string, max: number) =>
  z
    .string({ message: `${label} wajib diisi.` })
    .trim()
    .min(1, { message: `${label} wajib diisi.` })
    .max(max, { message: `${label} maksimal ${max} karakter.` });
const isoDate = (label: string) =>
  z.string({ message: `${label} wajib diisi.` }).refine(isValidIsoDate, { message: `${label} harus tanggal valid (YYYY-MM-DD).` });
const requiredReason = z
  .string({ message: 'Alasan wajib diisi.' })
  .trim()
  .min(3, { message: 'Alasan minimal 3 karakter.' })
  .max(1000);

/** Identity, contract, and SPMK fields (PRD §3). DECIMAL(20,2) contract value travels as a decimal string (D-039). */
const projectIdentityShape = {
  code: text('Kode proyek', 50),
  activityName: text('Kegiatan', 255),
  subActivityName: text('Sub kegiatan', 255),
  projectName: text('Nama pekerjaan', 500),
  location: text('Lokasi', 255),
  fiscalYear: z
    .number({ message: 'Tahun anggaran wajib diisi.' })
    .int({ message: 'Tahun anggaran harus bilangan bulat.' })
    .min(2000, { message: 'Tahun anggaran 2000–2100.' })
    .max(2100, { message: 'Tahun anggaran 2000–2100.' }),
  contractorName: text('Kontraktor', 255),
  consultantName: text('Konsultan', 255),
  contractNumber: text('Nomor kontrak', 100),
  contractDate: isoDate('Tanggal kontrak'),
  contractValue: z
    .string({ message: 'Nilai kontrak wajib diisi.' })
    .trim()
    .regex(/^\d{1,18}(\.\d{1,2})?$/, { message: 'Nilai kontrak berupa angka ≥ 0 dengan maksimal 2 desimal, tanpa pemisah ribuan.' }),
  spmkNumber: text('Nomor SPMK', 100),
  spmkDate: isoDate('Tanggal SPMK'),
};

const scheduleShape = {
  startDate: isoDate('Tanggal mulai'),
  durationDays: z
    .number({ message: 'Masa pelaksanaan wajib diisi.' })
    .int({ message: 'Masa pelaksanaan harus bilangan bulat.' })
    .min(1, { message: `Masa pelaksanaan 1–${PROJECT_DURATION_MAX_DAYS} hari.` })
    .max(PROJECT_DURATION_MAX_DAYS, { message: `Masa pelaksanaan 1–${PROJECT_DURATION_MAX_DAYS} hari.` }),
};

export const createProjectSchema = z.object({ ...projectIdentityShape, ...scheduleShape });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({ ...z.object(projectIdentityShape).partial().shape, reason: z.string().trim().max(1000).optional() })
  .refine((v) => Object.keys(v).some((key) => key !== 'reason'), { message: 'Tidak ada perubahan.' });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const changeScheduleSchema = z.object({ ...scheduleShape, reason: requiredReason });
export type ChangeScheduleInput = z.infer<typeof changeScheduleSchema>;

export const requiredReasonSchema = z.object({ reason: requiredReason });
export type RequiredReasonInput = z.infer<typeof requiredReasonSchema>;

export const listProjectsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const listAdminProjectsQuerySchema = listProjectsQuerySchema.omit({ status: true });
export type ListAdminProjectsQuery = z.infer<typeof listAdminProjectsQuerySchema>;

export const addMemberSchema = z.object({
  userId: z.uuid(),
  roleId: z.uuid(),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const changeMemberRoleSchema = z.object({ roleId: z.uuid() });
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export interface MyProjectDto {
  id: string;
  code: string;
  projectName: string;
  fiscalYear: number;
  status: ProjectStatus;
  startDate: string;
  plannedFinishDate: string;
  /** null = access through super admin without a membership. */
  role: RoleSummary | null;
}

export interface ProjectDto {
  id: string;
  code: string;
  activityName: string;
  subActivityName: string;
  projectName: string;
  location: string;
  fiscalYear: number;
  contractorName: string;
  consultantName: string;
  contractNumber: string;
  contractDate: string;
  /** Decimal string; null only for projects created before Milestone 3. */
  contractValue: string | null;
  spmkNumber: string;
  spmkDate: string;
  startDate: string;
  durationDays: number;
  /** Derived: startDate + durationDays − 1 (D-036). */
  plannedFinishDate: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  /** Caller's project permissions, for UI hints only; the backend checks every request. */
  permissions: string[];
}

export interface ProjectWeekDto {
  id: string;
  weekNumber: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  days: number;
}

export interface ReportPeriodDto {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  firstWeekNumber: number;
  lastWeekNumber: number;
  days: number;
}

/** Read-only team view for project.read: no email (D-039). */
export interface ProjectTeamMemberDto {
  userId: string;
  name: string;
  role: RoleSummary;
}

/** Minimum metadata exposed to system admins (D-026). */
export interface AdminProjectDto {
  id: string;
  code: string;
  projectName: string;
}

/** Active user that can be added to a project; minimum metadata for assignments.manage. */
export interface MemberCandidateDto {
  id: string;
  name: string;
  email: string;
}

export interface ProjectMemberDto {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  role: RoleSummary & { isActive: boolean };
  createdAt: string;
}

export interface ProjectMembersResponse {
  project: AdminProjectDto;
  members: ProjectMemberDto[];
}
