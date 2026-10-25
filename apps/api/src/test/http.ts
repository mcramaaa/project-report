import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';

export const APP_ORIGIN = 'http://localhost:3000';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
}

export async function startApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: process.env.TEST_LOG ? ['error'] : false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: `${await app.getUrl()}/api`, prisma: app.get(PrismaService) };
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertions read arbitrary JSON
  body: any;
  setCookie: string[];
}

/** Minimal cookie-keeping HTTP client that behaves like the browser behind apps/web. */
export class Client {
  cookie?: string;

  constructor(private readonly baseUrl: string) {}

  async request(method: string, path: string, body?: unknown, options: { origin?: string | null } = {}): Promise<ApiResponse> {
    const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (origin) headers.origin = origin;
    if (this.cookie) headers.cookie = this.cookie;

    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie();
    const session = setCookie.find((c) => c.startsWith('lp_session='));
    if (session) {
      const value = session.split(';')[0] ?? '';
      this.cookie = value === 'lp_session=' ? undefined : value;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, setCookie };
  }

  get(path: string) {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }

  patch(path: string, body?: unknown) {
    return this.request('PATCH', path, body);
  }

  delete(path: string, body?: unknown) {
    return this.request('DELETE', path, body);
  }

  async login(email: string, password: string): Promise<ApiResponse> {
    return this.post('/auth/login', { email, password });
  }
}
