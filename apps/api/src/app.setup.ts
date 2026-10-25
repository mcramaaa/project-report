import type { INestApplication } from '@nestjs/common';
import { API_PREFIX } from '@laporan-proyek/shared';

/** Shared by main.ts and tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  // 'trust proxy' stays off: the apps/web rewrite forwards X-Forwarded-For unchanged from the client,
  // so it is spoofable. req.ip is the socket peer (the web proxy) until deployment adds a trusted hop.
}
