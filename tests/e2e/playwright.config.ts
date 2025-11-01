import { defineConfig, devices } from '@playwright/test';
import { loadEnv, snapshotEnv } from './utils/env.js';

loadEnv();
const env = snapshotEnv();

const baseURL = env.TOOLMGMT_BASE_URL || 'http://127.0.0.1:4173';
const headless = env.PLAYWRIGHT_HEADLESS === '0' ? false : true;

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
      use: { ...devices['Desktop Chrome'], headless },
    },
  ],
  reporter: [['list']],
});
