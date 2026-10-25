import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Same depth from src/config and dist/config: <root>/apps/api/{src,dist}/config.
const ROOT_ENV_FILE = resolve(__dirname, '../../../../.env');

/** Loads the repository root .env. Variables already set in the environment win. */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  databaseUrl: string;
  /** Origin of apps/web; mutating requests must carry this Origin (D-031). */
  appOrigin: string;
  secureCookies: boolean;
  sessionTtlMs: number;
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`Environment variable ${name} wajib di-set (lihat .env.example).`);
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appUrl = new URL(requireEnv('APP_URL', env));
  const ttlHours = Number(env.SESSION_TTL_HOURS ?? 12);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) throw new Error('SESSION_TTL_HOURS harus angka positif.');
  return {
    databaseUrl: requireEnv('DATABASE_URL', env),
    appOrigin: appUrl.origin,
    secureCookies: appUrl.protocol === 'https:',
    sessionTtlMs: ttlHours * 60 * 60 * 1000,
  };
}
