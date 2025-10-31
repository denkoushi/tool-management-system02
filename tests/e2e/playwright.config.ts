import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.TOOLMGMT_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts', '**/*.spec.mjs'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [['list']],
});
