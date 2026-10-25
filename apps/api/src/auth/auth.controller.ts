import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput, type MeResponse } from '@laporan-proyek/shared';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { AccessService } from './access.service';
import { CurrentAuth, type AppRequest, type AuthContext, type AuthUser } from './auth-context';
import { AuthService } from './auth.service';
import { Public } from './guards';
import { SESSION_COOKIE } from './session-token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const { token, expiresAt, user } = await this.auth.login(body, { ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
    return this.toMe(user);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.toMe(auth.user);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ reloginRequired: true }> {
    await this.auth.changePassword(auth, body);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return { reloginRequired: true };
  }

  private async toMe(user: AuthUser): Promise<MeResponse> {
    return { ...user, permissions: [...(await this.access.globalPermissions(user))].sort() };
  }

  private cookieOptions() {
    return { httpOnly: true, sameSite: 'lax' as const, secure: this.config.secureCookies, path: '/' };
  }
}
