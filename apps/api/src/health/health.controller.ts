import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@laporan-proyek/shared';
import { Public } from '../auth/guards';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
