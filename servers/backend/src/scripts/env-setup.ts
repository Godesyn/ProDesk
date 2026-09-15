import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

const isProd = process.argv.includes('--prod');
const isStage = process.argv.includes('--stage');

if (isProd) {
  console.log('🌲 Running in PRODUCTION mode (loading .env.prod)...');
  loadEnv({ path: resolve(process.cwd(), '.env.prod'), override: true });
  loadEnv({ path: resolve(process.cwd(), '../../.env.prod'), override: true });
} else if (isStage) {
  console.log('🟡 Running in STAGING mode (loading .env.stage)...');
  loadEnv({ path: resolve(process.cwd(), '.env.stage'), override: true });
  loadEnv({ path: resolve(process.cwd(), '../../.env.stage'), override: true });
} else {
  console.log('🔌 Running in DEVELOPMENT mode (loading .env)...');
  loadEnv({ path: resolve(process.cwd(), '.env'), override: true });
  loadEnv({ path: resolve(process.cwd(), '../../.env'), override: true });
}
