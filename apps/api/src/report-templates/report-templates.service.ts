import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  defaultReportTemplate,
  LOGO_KINDS,
  LOGO_MAX_BYTES,
  normalizeReportTemplate,
  REPORT_TYPES,
  type ImportReportTemplatesInput,
  type LogoKind,
  type ReportTemplateConfig,
  type ReportTemplatesDto,
  type ReportType,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../auth/auth-context';
import { storageRoot, type UploadedPart } from '../documents/documents.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const logoPath = (projectId: string, filename: string) => join(storageRoot(), 'projects', projectId, 'logos', filename);

/** Logos recognised by their first bytes, not by the client's name or type. */
const IMAGE_TYPES = [
  { ext: 'png', mime: 'image/png', magic: (b: Buffer) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { ext: 'jpg', mime: 'image/jpeg', magic: (b: Buffer) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  { ext: 'webp', mime: 'image/webp', magic: (b: Buffer) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

/** D-082: report layout per project and report type, plus the logos the layouts print. */
@Injectable()
export class ReportTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(projectId: string): Promise<ReportTemplatesDto> {
    const [rows, logos] = await Promise.all([
      this.prisma.reportTemplate.findMany({ where: { projectId }, select: { reportType: true, config: true, updatedAt: true, updatedByUser: { select: { id: true, name: true } } } }),
      this.prisma.projectLogo.findMany({ where: { projectId }, select: { kind: true, mimeType: true, fileSize: true, updatedAt: true } }),
    ]);
    return {
      templates: REPORT_TYPES.map((type) => {
        const row = rows.find((r) => r.reportType === type);
        return {
          reportType: type,
          config: row ? normalizeReportTemplate(type, row.config as ReportTemplateConfig) : defaultReportTemplate(type),
          updatedAt: row?.updatedAt.toISOString() ?? null,
          updatedBy: row?.updatedByUser ?? null,
        };
      }),
      logos: logos.map((l) => ({ kind: l.kind, mimeType: l.mimeType, fileSize: l.fileSize, updatedAt: l.updatedAt.toISOString() })),
    };
  }

  async save(actor: AuthUser, projectId: string, type: ReportType, config: ReportTemplateConfig): Promise<ReportTemplatesDto> {
    const normalized = normalizeReportTemplate(type, config);
    await this.prisma.$transaction(async (tx) => {
      await lockActive(tx, projectId);
      const old = await tx.reportTemplate.findUnique({ where: { projectId_reportType: { projectId, reportType: type } }, select: { config: true } });
      const json = normalized as unknown as Prisma.InputJsonObject;
      await tx.reportTemplate.upsert({
        where: { projectId_reportType: { projectId, reportType: type } },
        create: { projectId, reportType: type, config: json, updatedBy: actor.id },
        update: { config: json, updatedBy: actor.id },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'UPDATE_REPORT_TEMPLATE',
        entityType: 'REPORT_TEMPLATE',
        projectId,
        oldValue: old ? { reportType: type, config: old.config as Prisma.InputJsonObject } : { reportType: type, config: 'default' },
        newValue: { reportType: type, config: json },
      });
    });
    return this.list(projectId);
  }

  /** D-082 butir 1: copy every template (and optionally the logos) from a project the actor can read. */
  async importFrom(actor: AuthUser, projectId: string, input: ImportReportTemplatesInput): Promise<ReportTemplatesDto> {
    if (input.sourceProjectId === projectId) throw new BadRequestException('Pilih proyek lain sebagai sumber.');
    // Non-members get the same answer as a missing project, so its existence is not revealed (D-033).
    if (!(await this.access.hasProjectPermission(actor, input.sourceProjectId, 'rab.read'))) throw new NotFoundException('Proyek sumber tidak ditemukan.');
    const [templates, logos] = await Promise.all([
      this.prisma.reportTemplate.findMany({ where: { projectId: input.sourceProjectId }, select: { reportType: true, config: true } }),
      input.includeLogos ? this.prisma.projectLogo.findMany({ where: { projectId: input.sourceProjectId } }) : Promise.resolve([]),
    ]);
    if (!templates.length && !logos.length) throw new ConflictException('Proyek sumber belum punya template atau logo yang disimpan.');

    // Files first; the database only points at them once the copy succeeded.
    const copied: { kind: LogoKind; filename: string; mimeType: string; fileSize: number }[] = [];
    await mkdir(join(storageRoot(), 'projects', projectId, 'logos'), { recursive: true });
    try {
      for (const l of logos) {
        const filename = `${randomUUID()}.${l.filename.split('.').pop()}`;
        await copyFile(logoPath(input.sourceProjectId, l.filename), logoPath(projectId, filename));
        copied.push({ kind: l.kind, filename, mimeType: l.mimeType, fileSize: l.fileSize });
      }
    } catch (err) {
      await Promise.all(copied.map((c) => rm(logoPath(projectId, c.filename), { force: true })));
      throw err;
    }
    let replaced: string[] = [];
    try {
      replaced = await this.prisma.$transaction(async (tx) => {
        await lockActive(tx, projectId);
        for (const t of templates)
          await tx.reportTemplate.upsert({
            where: { projectId_reportType: { projectId, reportType: t.reportType } },
            create: { projectId, reportType: t.reportType, config: t.config as Prisma.InputJsonObject, updatedBy: actor.id },
            update: { config: t.config as Prisma.InputJsonObject, updatedBy: actor.id },
          });
        const old = await tx.projectLogo.findMany({ where: { projectId, kind: { in: copied.map((c) => c.kind) } }, select: { filename: true } });
        for (const c of copied)
          await tx.projectLogo.upsert({
            where: { projectId_kind: { projectId, kind: c.kind } },
            create: { projectId, ...c, updatedBy: actor.id },
            update: { filename: c.filename, mimeType: c.mimeType, fileSize: c.fileSize, updatedBy: actor.id },
          });
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'IMPORT_REPORT_TEMPLATES',
          entityType: 'REPORT_TEMPLATE',
          projectId,
          newValue: { sourceProjectId: input.sourceProjectId, reportTypes: templates.map((t) => t.reportType), logos: copied.map((c) => c.kind) },
        });
        return old.map((o) => o.filename);
      });
    } catch (err) {
      await Promise.all(copied.map((c) => rm(logoPath(projectId, c.filename), { force: true })));
      throw err;
    }
    await Promise.all(replaced.map((f) => rm(logoPath(projectId, f), { force: true })));
    return this.list(projectId);
  }

  async uploadLogo(actor: AuthUser, projectId: string, kind: LogoKind, file: UploadedPart | undefined): Promise<ReportTemplatesDto> {
    if (!file) throw new BadRequestException('Pilih file gambar logo.');
    if (file.size > LOGO_MAX_BYTES) throw new BadRequestException('Logo maksimal 2 MB.');
    const type = IMAGE_TYPES.find((t) => t.magic(file.buffer));
    if (!type) throw new BadRequestException('Logo harus PNG, JPG, atau WEBP.');
    const filename = `${randomUUID()}.${type.ext}`;
    await mkdir(join(storageRoot(), 'projects', projectId, 'logos'), { recursive: true });
    await writeFile(logoPath(projectId, filename), file.buffer, { flag: 'wx' });
    let old: string | null = null;
    try {
      old = await this.prisma.$transaction(async (tx) => {
        await lockActive(tx, projectId);
        const before = await tx.projectLogo.findUnique({ where: { projectId_kind: { projectId, kind } }, select: { filename: true } });
        await tx.projectLogo.upsert({
          where: { projectId_kind: { projectId, kind } },
          create: { projectId, kind, filename, mimeType: type.mime, fileSize: file.size, updatedBy: actor.id },
          update: { filename, mimeType: type.mime, fileSize: file.size, updatedBy: actor.id },
        });
        await writeAudit(tx, { actorId: actor.id, action: 'UPLOAD_REPORT_LOGO', entityType: 'REPORT_TEMPLATE', projectId, newValue: { kind, mimeType: type.mime, fileSize: file.size, replaced: !!before } });
        return before?.filename ?? null;
      });
    } catch (err) {
      await rm(logoPath(projectId, filename), { force: true });
      throw err;
    }
    if (old) await rm(logoPath(projectId, old), { force: true });
    return this.list(projectId);
  }

  async removeLogo(actor: AuthUser, projectId: string, kind: LogoKind): Promise<ReportTemplatesDto> {
    const old = await this.prisma.$transaction(async (tx) => {
      await lockActive(tx, projectId);
      const logo = await tx.projectLogo.findUnique({ where: { projectId_kind: { projectId, kind } }, select: { id: true, filename: true } });
      if (!logo) throw new NotFoundException('Logo belum diunggah.');
      await tx.projectLogo.delete({ where: { id: logo.id } });
      await writeAudit(tx, { actorId: actor.id, action: 'REMOVE_REPORT_LOGO', entityType: 'REPORT_TEMPLATE', projectId, oldValue: { kind } });
      return logo.filename;
    });
    await rm(logoPath(projectId, old), { force: true });
    return this.list(projectId);
  }

  async readLogo(projectId: string, kind: LogoKind): Promise<{ mimeType: string; data: Buffer }> {
    const logo = await this.prisma.projectLogo.findUnique({ where: { projectId_kind: { projectId, kind } }, select: { filename: true, mimeType: true } });
    if (!logo) throw new NotFoundException('Logo belum diunggah.');
    return { mimeType: logo.mimeType, data: await readFile(logoPath(projectId, logo.filename)) };
  }
}

export const isLogoKind = (v: string): v is LogoKind => (LOGO_KINDS as readonly string[]).includes(v);
export const isReportType = (v: string): v is ReportType => (REPORT_TYPES as readonly string[]).includes(v);

async function lockActive(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
  if (project.status !== 'ACTIVE') throw new ConflictException('Proyek sudah ditutup; template tidak dapat diubah.');
}
