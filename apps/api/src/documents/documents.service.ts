import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentDto } from '@laporan-proyek/shared';
import ExcelJS from 'exceljs';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import { rabSheetCandidates } from '../imports/workbook/rab-sheet';
import { WorkbookModel } from '../imports/workbook/workbook-model';
import { PrismaService } from '../prisma/prisma.service';

/** Uploaded part as produced by the multipart interceptor (memory storage). */
export interface UploadedPart {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** <root>/storage, same depth from src/documents and dist/documents; STORAGE_DIR overrides (tests). */
export const storageRoot = () => process.env.STORAGE_DIR ?? resolve(__dirname, '../../../../storage');
export const documentPath = (projectId: string, storedFilename: string) => join(storageRoot(), 'projects', projectId, 'documents', storedFilename);

const USER_REF = { select: { id: true, name: true } } as const;

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores originals on disk first, then metadata + audit in one transaction; if the database step fails
   * the written files are removed, so metadata never claims a file that is not there (ARCHITECTURE §10).
   */
  async upload(actor: AuthUser, projectId: string, files: UploadedPart[]): Promise<DocumentDto[]> {
    if (!files?.length) throw new BadRequestException('Pilih minimal satu file.');
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    if (project.status === 'CLOSED') throw new ConflictException('Proyek sudah ditutup; dokumen tidak dapat ditambahkan.');

    const prepared: { name: string; buffer: Buffer; size: number; sha256: string; storedFilename: string; inventory: { rabSheets: string[] } }[] = [];
    for (const f of files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 255);
      if (!/\.xlsx$/i.test(name) || f.buffer.subarray(0, 4).toString('hex') !== '504b0304') {
        throw new BadRequestException(`${name}: hanya file Excel .xlsx yang didukung (v1).`);
      }
      if (f.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`${name}: maksimal 30 MB.`);
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(f.buffer as unknown as ArrayBuffer);
      } catch {
        throw new BadRequestException(`${name}: file Excel tidak dapat dibaca.`);
      }
      prepared.push({
        name,
        buffer: f.buffer,
        size: f.size,
        sha256: createHash('sha256').update(f.buffer).digest('hex'),
        storedFilename: `${randomUUID()}.xlsx`,
        inventory: { rabSheets: rabSheetCandidates(new WorkbookModel('upload', name, workbook)) },
      });
    }

    const dir = join(storageRoot(), 'projects', projectId, 'documents');
    await mkdir(dir, { recursive: true });
    const written: string[] = [];
    try {
      for (const p of prepared) {
        const path = join(dir, p.storedFilename);
        await writeFile(path, p.buffer, { flag: 'wx' });
        written.push(path);
      }
      const ids = await this.prisma.$transaction(async (tx) => {
        const out: string[] = [];
        for (const p of prepared) {
          const doc = await tx.projectDocument.create({
            data: {
              projectId,
              originalFilename: p.name,
              storedFilename: p.storedFilename,
              mimeType: XLSX_MIME,
              fileSize: p.size,
              sha256: p.sha256,
              sheetInventory: p.inventory,
              uploadedBy: actor.id,
            },
          });
          await writeAudit(tx, {
            actorId: actor.id,
            action: 'UPLOAD_DOCUMENT',
            entityType: 'DOCUMENT',
            entityId: doc.id,
            projectId,
            newValue: { originalFilename: p.name, fileSize: p.size, sha256: p.sha256 },
          });
          out.push(doc.id);
        }
        return out;
      });
      const docs = await this.prisma.projectDocument.findMany({ where: { id: { in: ids } }, include: { uploader: USER_REF }, orderBy: { uploadedAt: 'asc' } });
      return docs.map(toDto);
    } catch (err) {
      await Promise.all(written.map((path) => rm(path, { force: true })));
      throw err;
    }
  }

  async list(projectId: string): Promise<DocumentDto[]> {
    const docs = await this.prisma.projectDocument.findMany({ where: { projectId }, include: { uploader: USER_REF }, orderBy: { uploadedAt: 'desc' } });
    return docs.map(toDto);
  }

  async read(projectId: string, documentId: string): Promise<{ filename: string; mimeType: string; data: Buffer }> {
    const doc = await this.prisma.projectDocument.findFirst({ where: { id: documentId, projectId } });
    if (!doc) throw new NotFoundException('Dokumen tidak ditemukan.');
    return { filename: doc.originalFilename, mimeType: doc.mimeType, data: await readFile(documentPath(projectId, doc.storedFilename)) };
  }
}

function toDto(d: {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  sheetInventory: unknown;
  uploadedAt: Date;
  uploader: { id: string; name: string };
}): DocumentDto {
  const inventory = (d.sheetInventory ?? {}) as { rabSheets?: string[] };
  return {
    id: d.id,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    sha256: d.sha256,
    uploadedBy: d.uploader,
    uploadedAt: d.uploadedAt.toISOString(),
    rabSheetCandidates: inventory.rabSheets ?? [],
  };
}
