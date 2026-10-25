import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { LOGIN_FAILED_MESSAGE, type ChangePasswordInput, type LoginInput } from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext, AuthUser } from './auth-context';
import { LoginRateLimiter } from './login-rate-limiter';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password';
import { hashSessionToken, newSessionToken } from './session-token';

export interface ClientInfo {
  ip: string;
  userAgent?: string;
}

/** Revokes every live session of a user inside the caller's transaction and audits the count. */
export async function revokeAllSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  actorId: string | null,
  cause: 'CHANGE_PASSWORD' | 'DEACTIVATE_USER',
): Promise<number> {
  const { count } = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit(tx, { actorId, action: 'REVOKE_SESSIONS', entityType: 'USER', entityId: userId, newValue: { revokedCount: count, cause } });
  return count;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: LoginRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, client: ClientInfo): Promise<{ token: string; expiresAt: Date; user: AuthUser }> {
    if (this.limiter.isBlocked(input.email)) {
      throw new HttpException('Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Always run scrypt so unknown emails take as long as wrong passwords.
    const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyPasswordHash()));
    if (!user || !passwordOk || !user.isActive) {
      this.limiter.recordFailure(input.email);
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }
    this.limiter.reset(input.email);

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs);
    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
        ipAddress: client.ip.slice(0, 45),
        userAgent: client.userAgent?.slice(0, 512),
      },
    });
    return { token, expiresAt, user: { id: user.id, name: user.name, email: user.email, isSystemAdmin: user.isSystemAdmin } };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Verifies the current password, stores the new hash, and revokes all sessions (re-login required). */
  async changePassword(auth: AuthContext, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Password lama salah.');
    }
    const passwordHash = await hashPassword(input.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: auth.user.id }, data: { passwordHash } });
      await writeAudit(tx, { actorId: auth.user.id, action: 'CHANGE_PASSWORD', entityType: 'USER', entityId: auth.user.id });
      await revokeAllSessions(tx, auth.user.id, auth.user.id, 'CHANGE_PASSWORD');
    });
  }
}
