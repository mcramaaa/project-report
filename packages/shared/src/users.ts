import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth.js';

const nameSchema = z.string().trim().min(1, { message: 'Nama wajib diisi.' }).max(150);
const reasonSchema = z.string().trim().max(1000).optional();

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  isSystemAdmin: z.boolean().default(false),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ name: nameSchema.optional(), email: emailSchema.optional(), reason: reasonSchema })
  .refine((v) => v.name !== undefined || v.email !== undefined, { message: 'Tidak ada perubahan.' });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const reasonBodySchema = z.object({ reason: reasonSchema }).default({});
export type ReasonInput = z.infer<typeof reasonBodySchema>;

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  active: z.enum(['true', 'false']).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Safe user representation: never includes password hash or session data. */
export interface UserDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isSystemAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
