import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
loadEnv({ path: resolve(root, '.env.prod'), override: true });

import postgres from 'postgres';

// Connect directly — bypass lib/env.ts entirely
const dbUrl = process.env.DATABASE_URL!;
console.log('DATABASE_URL:', dbUrl.replace(/\/\/.*:.*@/, '//***@'));

const sql = postgres(dbUrl, { prepare: false });

// Raw query for that specific email
const rows = await sql`SELECT id, email, role FROM users WHERE email = 'mastersajat+n1@gmail.com'`;
console.log('\nDirect SQL result for mastersajat+n1@gmail.com:');
console.log(rows.length ? rows : '  (no rows)');

// Also check: what DATABASE_URL does lib/env.ts resolve to?
const { env } = await import('@prodesk/server-shared/lib/env');
console.log('\nlib/env.ts DATABASE_URL:', env.DATABASE_URL.replace(/\/\/.*:.*@/, '//***@'));

// Query via drizzle db
const { db } = await import('@prodesk/server-shared/db/index');
const { users } = await import('@prodesk/server-shared/db/schema');
const { eq } = await import('drizzle-orm');
const drizzleRows = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, 'mastersajat+n1@gmail.com'));
console.log('\nDrizzle result:');
console.log(drizzleRows.length ? drizzleRows : '  (no rows)');

await sql.end();
process.exit(0);
