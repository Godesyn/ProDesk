import { defineConfig } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// drizzle-kit runs from the server/ cwd, but .env lives at the monorepo root.
const here = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes('--prod');
if (isProd) {
  loadEnv({ path: resolve(here, '../../.env.prod'), override: true });
  loadEnv({ override: true });
} else {
  loadEnv({ path: resolve(here, '../../.env') });
  loadEnv();
}

export default defineConfig({
  schema: '../../packages/server-shared/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the direct (session-mode, :5432) connection for migrations — the
    // transaction pooler does not support the prepared statements drizzle-kit issues.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
