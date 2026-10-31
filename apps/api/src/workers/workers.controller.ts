import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  KTP_MAX_BYTES,
  listWorkersQuerySchema,
  updateWorkerSchema,
  workerInputSchema,
  type ListWorkersQuery,
  type UpdateWorkerInput,
  type WorkerInput,
} from '@laporan-proyek/shared';
import { AccessService } from '../auth/access.service';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermission } from '../auth/guards';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedPart } from '../documents/documents.service';
import { WorkersService } from './workers.service';

const workerId = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** D-080: any signed-in user reads the list (NIK masked); workers.manage sees and changes everything. */
@Controller('workers')
export class WorkersController {
  constructor(
    private readonly workers: WorkersService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listWorkersQuerySchema)) query: ListWorkersQuery) {
    const full = (await this.access.globalPermissions(auth.user)).has('workers.manage');
    return this.workers.list(query, full);
  }

  @Get('positions')
  positions() {
    return this.workers.positions();
  }

  @Get('template')
  @RequirePermission('workers.manage')
  async template() {
    return new StreamableFile(await this.workers.template(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="template-pekerja.xlsx"',
    });
  }

  @Post('import')
  @RequirePermission('workers.manage')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', 1, { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(@CurrentAuth() auth: AuthContext, @UploadedFiles() files: UploadedPart[]) {
    return this.workers.import(auth.user, files?.[0]);
  }

  @Post()
  @RequirePermission('workers.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(workerInputSchema)) body: WorkerInput) {
    return this.workers.create(auth.user, body);
  }

  @Patch(':workerId')
  @RequirePermission('workers.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('workerId', workerId) id: string, @Body(new ZodPipe(updateWorkerSchema)) body: UpdateWorkerInput) {
    return this.workers.update(auth.user, id, body);
  }

  @Post(':workerId/ktp')
  @RequirePermission('workers.manage')
  @UseInterceptors(FilesInterceptor('files', 1, { limits: { fileSize: KTP_MAX_BYTES } }))
  uploadKtp(@CurrentAuth() auth: AuthContext, @Param('workerId', workerId) id: string, @UploadedFiles() files: UploadedPart[]) {
    return this.workers.uploadKtp(auth.user, id, files?.[0]);
  }

  @Delete(':workerId/ktp')
  @RequirePermission('workers.manage')
  removeKtp(@CurrentAuth() auth: AuthContext, @Param('workerId', workerId) id: string) {
    return this.workers.removeKtp(auth.user, id);
  }

  @Get(':workerId/ktp')
  @RequirePermission('workers.manage')
  async ktp(@Param('workerId', workerId) id: string) {
    const file = await this.workers.readKtp(id);
    return new StreamableFile(file.data, { type: file.mimeType, disposition: `inline; filename="ktp-${id}.${file.ext}"` });
  }
}
