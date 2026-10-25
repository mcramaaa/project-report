import base from '@laporan-proyek/config/eslint';
import { defineConfig } from 'eslint/config';

// packages/calc must stay pure: no database, filesystem, HTTP, AI, or app env (AGENTS.md).
export default defineConfig([
  base,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'fs/*', 'http', 'https', 'net', 'child_process'], message: 'packages/calc must be pure.' },
            { group: ['@prisma/*', 'prisma', 'mysql*'], message: 'packages/calc must not access the database.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'process', message: 'packages/calc must not read app environment.' }, 'fetch'],
    },
  },
]);
