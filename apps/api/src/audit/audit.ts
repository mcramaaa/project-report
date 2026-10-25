import type { AuditAction } from '@laporan-proyek/shared';
import type { Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  /** Acting user; null for seed/system actions. */
  actorId: string | null;
  action: AuditAction;
  entityType: 'USER' | 'PROJECT' | 'PROJECT_MEMBER' | 'ROLE';
  entityId?: string;
  projectId?: string;
  /** Safe-to-display fields only. Never passwords, hashes, tokens, or secrets (D-034). */
  oldValue?: Prisma.InputJsonObject;
  newValue?: Prisma.InputJsonObject;
  reason?: string;
}

export function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      userId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      projectId: entry.projectId,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason || null,
    },
  });
}
