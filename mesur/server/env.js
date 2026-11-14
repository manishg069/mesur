import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read configuration from .env (if present) and the process environment. */
export function loadEnv(overrides = {}) {
  const file = resolve(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const e = process.env;
  const port = Number(e.PORT) || 4000;
  const env = {
    PORT: port,
    APP_MODE: e.APP_MODE === 'production' ? 'production' : 'demo',
    APP_URL: (e.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    STOREFRONT_URL: (e.STOREFRONT_URL ?? 'http://localhost:4100').replace(/\/$/, ''),
    DATABASE_PATH: resolve(ROOT, e.DATABASE_PATH || 'data/mesur.db'),
    COOKIE_SECURE: e.COOKIE_SECURE || '0',
    COOKIE_CROSS_SITE: e.COOKIE_CROSS_SITE || '0',
    ADMIN_EMAIL: e.ADMIN_EMAIL || '',
    ADMIN_PASSWORD: e.ADMIN_PASSWORD || '',
    ...overrides,
  };
  return env;
}
