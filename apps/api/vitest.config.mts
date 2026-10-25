import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Tests never touch the development database: they use <database>_test (wiped per test).
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL (see .env.example).');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

const testEnv = {
  DATABASE_URL: testDatabaseUrl(),
  APP_URL: 'http://localhost:3000',
  SESSION_TTL_HOURS: '12',
  NODE_ENV: 'test',
  REPO_ROOT: resolve(import.meta.dirname, '../..'),
};
// test.env only reaches workers; globalSetup runs in this process.
Object.assign(process.env, testEnv);

export default defineConfig({
  plugins: [
    // SWC emits the decorator metadata Nest DI needs; esbuild does not.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    include: ['src/**/*.spec.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    // One shared test database: run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: testEnv,
  },
});
