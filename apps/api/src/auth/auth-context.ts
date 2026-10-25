import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isSystemAdmin: boolean;
}

export interface AuthContext {
  sessionId: string;
  user: AuthUser;
}

/** Populated per request from the database by the guards; never trusted from the client. */
export interface AppRequest extends Request {
  auth?: AuthContext;
}

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw new Error('CurrentAuth used on a route without SessionGuard.');
  return auth;
});
