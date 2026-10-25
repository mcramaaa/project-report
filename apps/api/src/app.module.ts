import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAccessController } from './admin/admin-access.controller';
import { AdminAccessService } from './admin/admin-access.service';
import { AdminProjectsController } from './admin/admin-projects.controller';
import { AdminProjectsService } from './admin/admin-projects.service';
import { AdminUsersController } from './admin/admin-users.controller';
import { AdminUsersService } from './admin/admin-users.service';
import { AccessService } from './auth/access.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CsrfGuard, SessionGuard } from './auth/guards';
import { LoginRateLimiter } from './auth/login-rate-limiter';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { RabController } from './rab/rab.controller';
import { RabService } from './rab/rab.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, AuthController, ProjectsController, RabController, AdminUsersController, AdminProjectsController, AdminAccessController],
  providers: [
    // Order matters: CSRF first (also covers public login), then session.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: LoginRateLimiter, useFactory: () => new LoginRateLimiter() },
    AccessService,
    AuthService,
    AdminAccessService,
    ProjectsService,
    RabService,
    AdminUsersService,
    AdminProjectsService,
  ],
})
export class AppModule {}
