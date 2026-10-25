import { execFileSync } from 'node:child_process';
import { assertTestDatabase } from './test-database';

/** Applies committed migrations to the disposable test database before the suite. */
export default function setup(): void {
  const url = process.env.DATABASE_URL ?? '';
  assertTestDatabase(url);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.env.REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
