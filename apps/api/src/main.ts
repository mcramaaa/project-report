import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@laporan-proyek/shared';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
