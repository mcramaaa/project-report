import { z } from 'zod';
import type { RoleSummary } from './access.js';

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
  role: RoleSummary & { isActive: boolean };
  createdAt: string;
}

export interface ProjectMembersResponse {
  project: AdminProjectDto;
  members: ProjectMemberDto[];
}
