import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  KTP_MAX_BYTES,
  maskNik,
  type ListWorkersQuery,
  type Paginated,
  type UpdateWorkerInput,
  type WorkerDto,
  type WorkerInput,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import { storageRoot, type UploadedPart } from '../documents/documents.service';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/errors';
import { PrismaService } from '../prisma/prisma.service';

const ktpPath = (filename: string) => join(storageRoot(), 'workers', filename);

/** Accepted KTP files, recognised by their first bytes rather than the client's name or type. */
const KTP_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', magic: (b: Buffer) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  { ext: 'png', mime: 'image/png', magic: (b: Buffer) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { ext: 'webp', mime: 'image/webp', magic: (b: Buffer) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: 'pdf', mime: 'application/pdf', magic: (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-' },
];

const SELECT = { id: true, name: true, position: true, nik: true, ktpFilename: true, isActive: true, updatedAt: true } as const;

/** D-080: global worker list. NIK in full and KTP files only for workers.manage (checked by the caller). */
@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListWorkersQuery, full: boolean): Promise<Paginated<WorkerDto>> {
    const where: Prisma.WorkerWhereInput = {
      ...(query.active === 'all' ? {} : { isActive: query.active === 'true' }),
      // Searching by NIK would leak it digit by digit to users who only see it masked.
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { position: { contains: query.search } }, ...(full ? [{ nik: { contains: query.search } }] : [])] }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.worker.count({ where }),
      this.prisma.worker.findMany({ where, select: SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return { items: rows.map((r) => toDto(r, full)), total, page: query.page, pageSize: query.pageSize };
  }

  /** Labor names from every AHSP package plus positions already typed (D-080 butir 2). */
  async positions(): Promise<string[]> {
    const [ahsp, typed] = await Promise.all([
      this.prisma.ahspComponent.findMany({ where: { category: 'LABOR', subAnalysisVersionId: null }, select: { description: true }, distinct: ['description'] }),
      this.prisma.worker.findMany({ select: { position: true }, distinct: ['position'] }),
    ]);
    const seen = new Map<string, string>();
    for (const n of [...ahsp.map((a) => a.description), ...typed.map((t) => t.position)]) {
      const k = n.trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, n.trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'id'));
  }

  async create(actor: AuthUser, input: WorkerInput): Promise<WorkerDto> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.worker.create({ data: { ...input, createdBy: actor.id, updatedBy: actor.id }, select: SELECT });
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'CREATE_WORKER',
          entityType: 'WORKER',
          entityId: created.id,
          newValue: { name: input.name, position: input.position, nik: maskNik(input.nik) },
        });
        return created;
      });
      return toDto(row, true);
    } catch (err) {
      throw nikTaken(err);
    }
  }

  async update(actor: AuthUser, id: string, input: UpdateWorkerInput): Promise<WorkerDto> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const old = await findWorker(tx, id);
        const updated = await tx.worker.update({ where: { id }, data: { ...input, updatedBy: actor.id }, select: SELECT });
        const pick = (w: typeof old) => ({ name: w.name, position: w.position, nik: maskNik(w.nik), isActive: w.isActive });
        await writeAudit(tx, { actorId: actor.id, action: 'UPDATE_WORKER', entityType: 'WORKER', entityId: id, oldValue: pick(old), newValue: pick(updated) });
        return updated;
      });
      return toDto(row, true);
    } catch (err) {
      throw nikTaken(err);
    }
  }

  /** Writes the new file first; the old one is removed only after the database points at the new one. */
  async uploadKtp(actor: AuthUser, id: string, file: UploadedPart | undefined): Promise<WorkerDto> {
    if (!file) throw new BadRequestException('Pilih file foto KTP.');
    if (file.size > KTP_MAX_BYTES) throw new BadRequestException('Foto KTP maksimal 5 MB.');
    const type = KTP_TYPES.find((t) => t.magic(file.buffer));
    if (!type) throw new BadRequestException('Foto KTP harus JPG, PNG, WEBP, atau PDF.');
    await findWorker(this.prisma, id);

    const filename = `${randomUUID()}.${type.ext}`;
    await mkdir(join(storageRoot(), 'workers'), { recursive: true });
    await writeFile(ktpPath(filename), file.buffer, { flag: 'wx' });
    let old: string | null;
    let row;
    try {
      ({ old, row } = await this.prisma.$transaction(async (tx) => {
        const before = await findWorker(tx, id);
        const updated = await tx.worker.update({
          where: { id },
          data: { ktpFilename: filename, ktpMimeType: type.mime, ktpFileSize: file.size, updatedBy: actor.id },
          select: SELECT,
        });
        await writeAudit(tx, { actorId: actor.id, action: 'UPLOAD_WORKER_KTP', entityType: 'WORKER', entityId: id, newValue: { mimeType: type.mime, fileSize: file.size, replaced: !!before.ktpFilename } });
        return { old: before.ktpFilename, row: updated };
      }));
    } catch (err) {
      await rm(ktpPath(filename), { force: true });
      throw err;
    }
    if (old) await rm(ktpPath(old), { force: true });
    return toDto(row, true);
  }

  async removeKtp(actor: AuthUser, id: string): Promise<WorkerDto> {
    const { old, row } = await this.prisma.$transaction(async (tx) => {
      const before = await findWorker(tx, id);
      if (!before.ktpFilename) throw new NotFoundException('Pekerja ini belum punya foto KTP.');
      const updated = await tx.worker.update({ where: { id }, data: { ktpFilename: null, ktpMimeType: null, ktpFileSize: null, updatedBy: actor.id }, select: SELECT });
      await writeAudit(tx, { actorId: actor.id, action: 'REMOVE_WORKER_KTP', entityType: 'WORKER', entityId: id });
      return { old: before.ktpFilename, row: updated };
    });
    await rm(ktpPath(old), { force: true });
    return toDto(row, true);
  }

  async readKtp(id: string): Promise<{ mimeType: string; data: Buffer; ext: string }> {
    const w = await this.prisma.worker.findUnique({ where: { id }, select: { ktpFilename: true, ktpMimeType: true } });
    if (!w) throw new NotFoundException('Pekerja tidak ditemukan.');
    if (!w.ktpFilename || !w.ktpMimeType) throw new NotFoundException('Pekerja ini belum punya foto KTP.');
    return { mimeType: w.ktpMimeType, data: await readFile(ktpPath(w.ktpFilename)), ext: w.ktpFilename.split('.').pop()! };
  }
}

async function findWorker(db: Prisma.TransactionClient | PrismaService, id: string) {
  const w = await db.worker.findUnique({ where: { id }, select: { ...SELECT, ktpFilename: true } });
  if (!w) throw new NotFoundException('Pekerja tidak ditemukan.');
  return w;
}

function nikTaken(err: unknown) {
  return isUniqueViolation(err) ? new ConflictException({ message: 'NIK sudah terdaftar untuk pekerja lain.', errors: [{ path: 'nik', message: 'NIK sudah terdaftar.' }] }) : err;
}

function toDto(w: { id: string; name: string; position: string; nik: string; ktpFilename: string | null; isActive: boolean; updatedAt: Date }, full: boolean): WorkerDto {
  return { id: w.id, name: w.name, position: w.position, nik: full ? w.nik : maskNik(w.nik), hasKtp: !!w.ktpFilename, isActive: w.isActive, updatedAt: w.updatedAt.toISOString() };
}
