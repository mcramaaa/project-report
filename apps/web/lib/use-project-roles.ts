'use client';

import type { RoleDto } from '@laporan-proyek/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

/** Active PROJECT-scoped roles for assignment pickers. */
export function useProjectRoles(): RoleDto[] | undefined {
  const [roles, setRoles] = useState<RoleDto[]>();
  useEffect(() => {
    let cancelled = false;
    api<RoleDto[]>('GET', '/admin/roles?scope=PROJECT').then(
      (all) => !cancelled && setRoles(all.filter((r) => r.isActive)),
      () => !cancelled && setRoles([]),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return roles;
}
