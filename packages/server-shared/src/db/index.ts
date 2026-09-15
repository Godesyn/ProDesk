import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env.js';
import * as schema from './schema.js';

// `prepare: false` is required when talking to the Supabase transaction pooler
// (Supavisor) on port 6543, which does not support prepared statements.
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema, casing: 'snake_case' });
export type DB = typeof db;
export { schema };
export { eq, sql, and } from 'drizzle-orm';
