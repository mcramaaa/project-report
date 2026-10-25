import { Controller, Get, Param } from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  listMine(@CurrentAuth() auth: AuthContext) {
    return this.projects.listMine(auth.user.id);
  }

  @Get(':projectId')
  @RequireProjectPermission('project.read')
  get(@Param('projectId') projectId: string) {
    return this.projects.get(projectId);
  }
}
