import { z } from 'zod';

export const PERMISSION_SCOPES = ['GLOBAL', 'PROJECT'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/**
 * Permission catalog (D-035). Defined in code because the backend enforces each one;
 * the database stores only codes per role. Lists only permissions that are enforced today.
 */
export const PERMISSIONS = [
  { code: 'users.read', scope: 'GLOBAL', module: 'Pengguna', name: 'Lihat user', description: 'Melihat daftar dan detail akun user.' },
  {
    code: 'users.manage',
    scope: 'GLOBAL',
    module: 'Pengguna',
    name: 'Kelola user',
    description: 'Membuat, mengubah, mengaktifkan, dan menonaktifkan akun selain super admin.',
  },
  { code: 'roles.read', scope: 'GLOBAL', module: 'Role & permission', name: 'Lihat role', description: 'Melihat role dan permission-nya.' },
  {
    code: 'roles.manage',
    scope: 'GLOBAL',
    module: 'Role & permission',
    name: 'Kelola role proyek',
    description: 'Membuat role proyek dan mengatur permission-nya. Role administrasi hanya diatur super admin.',
  },
  {
    code: 'assignments.read',
    scope: 'GLOBAL',
    module: 'Akses proyek',
    name: 'Lihat akses proyek',
    description: 'Melihat daftar proyek (metadata minimum), anggota, dan akses tiap user.',
  },
  {
    code: 'assignments.manage',
    scope: 'GLOBAL',
    module: 'Akses proyek',
    name: 'Kelola akses proyek',
    description: 'Menambah, mengubah role, dan mencabut anggota proyek. Tidak berlaku untuk akses diri sendiri.',
  },
  { code: 'project.read', scope: 'PROJECT', module: 'Proyek', name: 'Lihat proyek', description: 'Membaca identitas proyek.' },
] as const satisfies readonly { code: string; scope: PermissionScope; module: string; name: string; description: string }[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
export type GlobalPermission = Extract<(typeof PERMISSIONS)[number], { scope: 'GLOBAL' }>['code'];
export type ProjectPermission = Extract<(typeof PERMISSIONS)[number], { scope: 'PROJECT' }>['code'];

export function permissionsForScope(scope: PermissionScope): PermissionCode[] {
  return PERMISSIONS.filter((p) => p.scope === scope).map((p) => p.code);
}

/** Built-in project roles from PRD §2. Code, scope, and active flag are locked; permissions are editable. */
export const SYSTEM_PROJECT_ROLES = [
  { code: 'FILLER', name: 'Filler', description: 'Input progres dan laporan harian.' },
  { code: 'REVIEWER', name: 'Reviewer', description: 'Memeriksa dan memfinalisasi laporan (bukan input sendiri).' },
  { code: 'MANAGER', name: 'Manager', description: 'Fungsi reviewer, aktivasi baseline, reopen laporan, Addendum.' },
  { code: 'ADMIN', name: 'Admin Proyek', description: 'Upload dokumen dan review ekstraksi AI.' },
] as const;
export const SYSTEM_ROLE_DEFAULT_PERMISSIONS: ProjectPermission[] = ['project.read'];

const roleCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'Kode role 2–50 karakter: huruf, angka, garis bawah; diawali huruf.' }));
const roleName = z.string().trim().min(2, { message: 'Nama role minimal 2 karakter.' }).max(120);
const roleDescription = z.string().trim().max(255).optional();

export const createRoleSchema = z.object({
  code: roleCode,
  name: roleName,
  description: roleDescription,
  scope: z.enum(PERMISSION_SCOPES),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  code: roleCode.optional(),
  name: roleName.optional(),
  description: roleDescription,
  isActive: z.boolean().optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().max(80)).max(200),
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

export const assignGlobalRoleSchema = z.object({ roleId: z.uuid() });
export type AssignGlobalRoleInput = z.infer<typeof assignGlobalRoleSchema>;

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
}

export interface RoleDto extends RoleSummary {
  description: string | null;
  scope: PermissionScope;
  isSystem: boolean;
  isActive: boolean;
  permissionCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserAccessDto {
  user: { id: string; name: string; email: string; isActive: boolean; isSystemAdmin: boolean };
  globalRoles: (RoleSummary & { isActive: boolean; assignedAt: string })[];
  projects: { project: { id: string; code: string; projectName: string }; role: RoleSummary & { isActive: boolean }; assignedAt: string }[];
}
