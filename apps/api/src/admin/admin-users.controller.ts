import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createUserSchema,
  listUsersQuerySchema,
  reasonBodySchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type ReasonInput,
  type UpdateUserInput,
} from '@laporan-proyek/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermission, SuperAdminOnly } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { AdminUsersService } from './admin-users.service';

const userId = new ParseUUIDPipe();

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @RequirePermission('users.read')
  list(@Query(new ZodPipe(listUsersQuerySchema)) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Post()
  @RequirePermission('users.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createUserSchema)) body: CreateUserInput) {
    return this.users.create(auth.user, body);
  }

  @Get(':userId')
  @RequirePermission('users.read')
  get(@Param('userId', userId) id: string) {
    return this.users.get(id);
  }

  @Patch(':userId')
  @RequirePermission('users.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput) {
    return this.users.update(auth.user, id, body);
  }

  @Post(':userId/activate')
  @RequirePermission('users.manage')
  @HttpCode(200)
  activate(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setActive(auth.user, id, true, body.reason);
  }

  @Post(':userId/deactivate')
  @RequirePermission('users.manage')
  @HttpCode(200)
  deactivate(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setActive(auth.user, id, false, body.reason);
  }

  @Post(':userId/grant-system-admin')
  @SuperAdminOnly()
  @HttpCode(200)
  grant(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setSystemAdmin(auth.user, id, true, body.reason);
  }

  @Post(':userId/revoke-system-admin')
  @SuperAdminOnly()
  @HttpCode(200)
  revoke(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setSystemAdmin(auth.user, id, false, body.reason);
  }
}
