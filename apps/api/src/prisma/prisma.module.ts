import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, readConfig, type AppConfig } from '../config/env';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => readConfig() },
    { provide: PrismaService, useFactory: (config: AppConfig) => new PrismaService(config.databaseUrl), inject: [APP_CONFIG] },
  ],
  exports: [APP_CONFIG, PrismaService],
})
export class PrismaModule {}
