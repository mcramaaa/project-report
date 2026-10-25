import { z } from 'zod';

export const PROJECT_ROLES = ['FILLER', 'REVIEWER', 'MANAGER', 'ADMIN'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  FILLER: 'Filler',
  REVIEWER: 'Reviewer',
  MANAGER: 'Manager',
  ADMIN: 'Admin Proyek',
};

/**
 * Explicit role -> permission matrix (docs/PERMISSIONS.md §2). Roles are not ordered levels.
 * Only permissions enforced by implemented features are listed; add rows per milestone.
 */
export const PROJECT_ROLE_PERMISSIONS = {
  FILLER: ['project.read'],
  REVIEWER: ['project.read'],
  MANAGER: ['project.read'],
  ADMIN: ['project.read'],
} as const satisfies Record<ProjectRole, readonly string[]>;

export type ProjectPermission = (typeof PROJECT_ROLE_PERMISSIONS)[ProjectRole][number];

export function roleHasPermission(role: ProjectRole, permission: ProjectPermission): boolean {
  return (PROJECT_ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
}

export const addMemberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(PROJECT_ROLES),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const changeMemberRoleSchema = z.object({ role: z.enum(PROJECT_ROLES) });
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export interface MyProjectDto {
  id: string;
  code: string;
  projectName: string;
  role: ProjectRole;
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
  spmkNumber: string;
  spmkDate: string;
  startDate: string;
  durationDays: number;
}

/** Minimum metadata exposed to system admins (D-026). */
export interface AdminProjectDto {
  id: string;
  code: string;
  projectName: string;
}

export interface ProjectMemberDto {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  role: ProjectRole;
  createdAt: string;
}

export interface ProjectMembersResponse {
  project: AdminProjectDto;
  members: ProjectMemberDto[];
}
