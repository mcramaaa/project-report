import { defineConfig, devices } from '@playwright/test';

// Runs against the dev servers (`npm run dev`); each run creates its own E2E-* project, the user's data is untouched.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  reporter: [['list']],
});
