import { Injectable, NotFoundException } from '@nestjs/common';
import type { MyProjectDto, ProjectDto } from '@laporan-proyek/shared';
import { PrismaService } from '../prisma/prisma.service';

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only projects where the user has an active membership. */
  async listMine(userId: string): Promise<MyProjectDto[]> {
    const rows = await this.prisma.projectUser.findMany({
      where: { userId, revokedAt: null },
      select: { role: true, project: { select: { id: true, code: true, projectName: true } } },
      orderBy: { project: { code: 'asc' } },
    });
    return rows.map((row) => ({ ...row.project, role: row.role }));
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
