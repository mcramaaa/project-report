/** Audit actions (docs/PERMISSIONS.md §4). Stored as strings in audit_logs.action. */
export const AUDIT_ACTIONS = [
  'CREATE_USER',
  'UPDATE_USER',
  'ACTIVATE_USER',
  'DEACTIVATE_USER',
  'GRANT_SYSTEM_ADMIN',
  'REVOKE_SYSTEM_ADMIN',
  'ADD_PROJECT_MEMBER',
  'CHANGE_PROJECT_MEMBER_ROLE',
  'REVOKE_PROJECT_MEMBER',
  'CHANGE_PASSWORD',
  'REVOKE_SESSIONS',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
