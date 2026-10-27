import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const envFile = new URL('../../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Use the same origin as the API's CSRF check. PORT belongs to the API.
const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000');
if (!['http:', 'https:'].includes(origin.protocol)) {
  throw new Error('APP_URL harus menggunakan http atau https.');
}
const port = origin.port || (origin.protocol === 'https:' ? '443' : '80');
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [
  require.resolve('next/dist/bin/next'),
  'dev', '--port', port, ...process.argv.slice(2),
], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
});
