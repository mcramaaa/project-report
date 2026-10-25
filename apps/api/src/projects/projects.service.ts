import { Injectable, NotFoundException } from '@nestjs/common';
import type { MyProjectDto, ProjectDto } from '@laporan-proyek/shared';
import type { AuthUser } from '../auth/auth-context';
import { PrismaService } from '../prisma/prisma.service';

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Projects the user may open: same rule as ProjectPermissionGuard for project.read
   * (active membership, active role holding project.read); a super admin sees every project (D-035).
   */
  async listMine(user: AuthUser): Promise<MyProjectDto[]> {
    const readable = { userId: user.id, revokedAt: null, role: { isActive: true, permissions: { some: { permissionCode: 'project.read' } } } };
    const projects = await this.prisma.project.findMany({
      where: user.isSystemAdmin ? {} : { members: { some: readable } },
      select: {
        id: true,
        code: true,
        projectName: true,
        members: { where: { userId: user.id, revokedAt: null }, select: { role: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { code: 'asc' },
    });
    return projects.map(({ members, ...project }) => ({ ...project, role: members[0]?.role ?? null }));
  }

  /** Caller must already be authorized for the project (ProjectPermissionGuard). */
  async get(projectId: string): Promise<ProjectDto> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    return {
      id: project.id,
      code: project.code,
      activityName: project.activityName,
      subActivityName: project.subActivityName,
      projectName: project.projectName,
      location: project.location,
      fiscalYear: project.fiscalYear,
      contractorName: project.contractorName,
      consultantName: project.consultantName,
      contractNumber: project.contractNumber,
      contractDate: isoDate(project.contractDate),
      spmkNumber: project.spmkNumber,
      spmkDate: isoDate(project.spmkDate),
      startDate: isoDate(project.startDate),
      durationDays: project.durationDays,
    };
  }
}
