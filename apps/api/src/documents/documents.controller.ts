import { Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequireProjectPermission } from '../auth/guards';
import { DocumentsService, MAX_UPLOAD_BYTES, type UploadedPart } from './documents.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequireProjectPermission('document.read')
  list(@Param('projectId') projectId: string) {
    return this.documents.list(projectId);
  }

  @Post()
  @RequireProjectPermission('document.upload')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@CurrentAuth() auth: AuthContext, @Param('projectId') projectId: string, @UploadedFiles() files: UploadedPart[]) {
    return this.documents.upload(auth.user, projectId, files);
  }

  @Get(':documentId/download')
  @RequireProjectPermission('document.read')
  async download(@Param('projectId') projectId: string, @Param('documentId', uuid) documentId: string) {
    const file = await this.documents.read(projectId, documentId);
    return new StreamableFile(file.data, { type: file.mimeType, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` });
  }
}
