import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

type EnvSnapshot = {
  TOOLMGMT_BASE_URL?: string;
  TOOLMGMT_API_TOKEN?: string;
  RASPI_SERVER_BASE?: string;
  RASPI_SERVER_API_TOKEN?: string;
  VIEWER_API_TOKEN?: string;
  PLAYWRIGHT_HEADLESS?: string;
};

let initialized = false;

export function loadEnv(envFile = process.env.PLAYWRIGHT_ENV_FILE || '.env.test') {
  if (initialized) return;
  const target = resolve(process.cwd(), envFile);
  if (existsSync(target)) {
    const result = loadDotenv({ path: target });
    if (result.error) {
      throw result.error;
    }
  }
  initialized = true;
}

export function snapshotEnv(): EnvSnapshot {
  return {
    TOOLMGMT_BASE_URL: process.env.TOOLMGMT_BASE_URL,
    TOOLMGMT_API_TOKEN: process.env.TOOLMGMT_API_TOKEN,
    RASPI_SERVER_BASE: process.env.RASPI_SERVER_BASE,
    RASPI_SERVER_API_TOKEN: process.env.RASPI_SERVER_API_TOKEN,
    VIEWER_API_TOKEN: process.env.VIEWER_API_TOKEN,
    PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS,
  };
}

export function requireEnv(keys: string[]) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
