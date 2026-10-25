import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
// Upper bound keeps scrypt cost predictable (D-030).
export const PASSWORD_MAX_LENGTH = 128;

/** Login email policy (D-029): trim + lowercase. Uniqueness is enforced by the database. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email({ message: 'Format email tidak valid.' }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: `Password minimal ${PASSWORD_MIN_LENGTH} karakter.` })
  .max(PASSWORD_MAX_LENGTH, { message: `Password maksimal ${PASSWORD_MAX_LENGTH} karakter.` });

export const loginSchema = z.object({
  email: z.string().max(254).transform(normalizeEmail),
  // No policy check on login: it would reveal nothing useful and must not block legacy passwords.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  isSystemAdmin: boolean;
  /** Effective global permissions (all of them for a super admin). UX only; the API checks every call. */
  permissions: string[];
}

export const LOGIN_FAILED_MESSAGE = 'Email atau password salah.';
