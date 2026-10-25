import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'lp_session';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 is fine for a 256-bit random token; it is never used for passwords (D-030). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
