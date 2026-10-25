import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateUserInput, ListUsersQuery, Paginated, UpdateUserInput, UserDto } from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import { revokeAllSessions } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation, retryOnWriteConflict } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';

/** Never select password_hash for API responses. */
const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  isSystemAdmin: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

type PublicUser = Prisma.UserGetPayload<{ select: typeof USER_PUBLIC_SELECT }>;

function toDto(user: PublicUser): UserDto {
  return { ...user, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() };
}

const EMAIL_TAKEN = 'Email sudah terdaftar.';
const LAST_ADMIN = 'Tidak dapat menonaktifkan atau mencabut system admin aktif terakhir.';

/**
 * Locks every active system admin row, so concurrent deactivate/revoke requests serialize here
 * and the last active system admin can never be removed (D-029). InnoDB may resolve the contention
 * as a deadlock on the index gap; callers wrap the transaction in retryOnWriteConflict.
 */
async function assertNotLastActiveSystemAdmin(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const admins = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE is_system_admin = TRUE AND is_active = TRUE ORDER BY id FOR UPDATE`;
  if (admins.length <= 1 && admins.some((admin) => admin.id === userId)) throw new ConflictException(LAST_ADMIN);
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersQuery): Promise<Paginated<UserDto>> {
    const where: Prisma.UserWhereInput = {
      ...(query.search ? { OR: [{ name: { contains: query.search } }, { email: { contains: query.search } }] } : {}),
      ...(query.active ? { isActive: query.active === 'true' } : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: users.map(toDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_PUBLIC_SELECT });
    if (!user) throw new NotFoundException('User tidak ditemukan.');
    return toDto(user);
  }

  async create(actorId: string, input: CreateUserInput): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { name: input.name, email: input.email, passwordHash, isSystemAdmin: input.isSystemAdmin },
          select: USER_PUBLIC_SELECT,
        });
        await writeAudit(tx, {
          actorId,
          action: 'CREATE_USER',
          entityType: 'USER',
          entityId: created.id,
          newValue: { name: created.name, email: created.email, isActive: created.isActive, isSystemAdmin: created.isSystemAdmin },
        });
        return created;
      });
      return toDto(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(EMAIL_TAKEN);
      throw err;
    }
  }

  async update(actorId: string, userId: string, input: UpdateUserInput): Promise<UserDto> {
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({ where: { id: userId }, select: USER_PUBLIC_SELECT });
        if (!current) throw new NotFoundException('User tidak ditemukan.');

        const oldValue: Record<string, string> = {};
        const newValue: Record<string, string> = {};
        for (const field of ['name', 'email'] as const) {
          const next = input[field];
          if (next !== undefined && next !== current[field]) {
            oldValue[field] = current[field];
            newValue[field] = next;
          }
        }
        if (Object.keys(newValue).length === 0) return current;

        const updated = await tx.user.update({ where: { id: userId }, data: newValue, select: USER_PUBLIC_SELECT });
        await writeAudit(tx, { actorId, action: 'UPDATE_USER', entityType: 'USER', entityId: userId, oldValue, newValue, reason: input.reason });
        return updated;
      });
      return toDto(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(EMAIL_TAKEN);
      throw err;
    }
  }

  /** Deactivation also revokes every session of the user (D-030). */
  async setActive(actorId: string, userId: string, isActive: boolean, reason?: string): Promise<UserDto> {
    const user = await retryOnWriteConflict(() => this.prisma.$transaction(async (tx) => {
      if (!isActive) await assertNotLastActiveSystemAdmin(tx, userId);
      const current = await tx.user.findUnique({ where: { id: userId }, select: USER_PUBLIC_SELECT });
      if (!current) throw new NotFoundException('User tidak ditemukan.');
      if (current.isActive === isActive) return current;

      const updated = await tx.user.update({ where: { id: userId }, data: { isActive }, select: USER_PUBLIC_SELECT });
      await writeAudit(tx, {
        actorId,
        action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        entityType: 'USER',
        entityId: userId,
        oldValue: { isActive: current.isActive },
        newValue: { isActive },
        reason,
      });
      if (!isActive) await revokeAllSessions(tx, userId, actorId, 'DEACTIVATE_USER');
      return updated;
    }));
    return toDto(user);
  }

  async setSystemAdmin(actorId: string, userId: string, isSystemAdmin: boolean, reason?: string): Promise<UserDto> {
    const user = await retryOnWriteConflict(() => this.prisma.$transaction(async (tx) => {
      if (!isSystemAdmin) await assertNotLastActiveSystemAdmin(tx, userId);
      const current = await tx.user.findUnique({ where: { id: userId }, select: USER_PUBLIC_SELECT });
      if (!current) throw new NotFoundException('User tidak ditemukan.');
      if (current.isSystemAdmin === isSystemAdmin) return current;

      const updated = await tx.user.update({ where: { id: userId }, data: { isSystemAdmin }, select: USER_PUBLIC_SELECT });
      await writeAudit(tx, {
        actorId,
        action: isSystemAdmin ? 'GRANT_SYSTEM_ADMIN' : 'REVOKE_SYSTEM_ADMIN',
        entityType: 'USER',
        entityId: userId,
        oldValue: { isSystemAdmin: current.isSystemAdmin },
        newValue: { isSystemAdmin },
        reason,
      });
      return updated;
    }));
    return toDto(user);
  }
}
