import type { GlobalPermission, MeResponse } from '@laporan-proyek/shared';

/** UX only: hides navigation and buttons. The API checks every request (docs/PERMISSIONS.md). */
export function can(me: Pick<MeResponse, 'isSystemAdmin' | 'permissions'>, permission: GlobalPermission): boolean {
  return me.isSystemAdmin || me.permissions.includes(permission);
}

export const ADMIN_PERMISSIONS: GlobalPermission[] = ['users.read', 'roles.read', 'assignments.read'];
