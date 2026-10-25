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
import { SystemAdminOnly } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import { AdminUsersService } from './admin-users.service';

const userId = new ParseUUIDPipe();

@Controller('admin/users')
@SystemAdminOnly()
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query(new ZodPipe(listUsersQuerySchema)) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createUserSchema)) body: CreateUserInput) {
    return this.users.create(auth.user.id, body);
  }

  @Get(':userId')
  get(@Param('userId', userId) id: string) {
    return this.users.get(id);
  }

  @Patch(':userId')
  update(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput) {
    return this.users.update(auth.user.id, id, body);
  }

  @Post(':userId/activate')
  @HttpCode(200)
  activate(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setActive(auth.user.id, id, true, body.reason);
  }

  @Post(':userId/deactivate')
  @HttpCode(200)
  deactivate(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setActive(auth.user.id, id, false, body.reason);
  }

  @Post(':userId/grant-system-admin')
  @HttpCode(200)
  grant(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setSystemAdmin(auth.user.id, id, true, body.reason);
  }

  @Post(':userId/revoke-system-admin')
  @HttpCode(200)
  revoke(@CurrentAuth() auth: AuthContext, @Param('userId', userId) id: string, @Body(new ZodPipe(reasonBodySchema)) body: ReasonInput) {
    return this.users.setSystemAdmin(auth.user.id, id, false, body.reason);
  }
}
