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
import { AhspController } from './ahsp/ahsp.controller';
import { AhspService } from './ahsp/ahsp.service';
import { AiClient, readAiConfig } from './ai/ai.client';
import { BaselinesController } from './baselines/baselines.controller';
import { BaselinesService } from './baselines/baselines.service';
import { SchedulesController } from './schedules/schedules.controller';
import { ProgressController } from './progress/progress.controller';
import { ProgressService } from './progress/progress.service';
import { SchedulesService } from './schedules/schedules.service';
import { ScenariosController } from './schedules/scenarios.controller';
import { ScenariosService } from './schedules/scenarios.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { RabImportsController } from './imports/rab-imports.controller';
import { AI_CLIENT, RabImportsService } from './imports/rab-imports.service';
import { RabController } from './rab/rab.controller';
import { RabCorrectionsService } from './rab/corrections.service';
import { RabService } from './rab/rab.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, AuthController, ProjectsController, RabController, BaselinesController, SchedulesController, ScenariosController, ProgressController, DocumentsController, RabImportsController, AhspController, AdminUsersController, AdminProjectsController, AdminAccessController],
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
    RabCorrectionsService,
    BaselinesService,
    SchedulesService,
    ScenariosService,
    ProgressService,
    DocumentsService,
    RabImportsService,
    AhspService,
    // 9router is optional (D-052): without configuration imports go straight to manual review.
    { provide: AI_CLIENT, useFactory: () => { const config = readAiConfig(); return config ? new AiClient(config) : null; } },
    AdminUsersService,
    AdminProjectsService,
  ],
})
export class AppModule {}
