// Dummy env so modules that validate env / construct the (lazy) DB client can be
// imported in unit tests without a real Supabase/Postgres. No connection is made.
process.env.DATABASE_URL ??=
  'postgresql://user:pass@localhost:5432/prodesk_test';
process.env.SUPABASE_URL ??= 'https://test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.SUPABASE_SECRET_KEY ??= 'sb_secret_test';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret';
// Vitest pins NODE_ENV='test', but `env.ts` only accepts development|production|
// staging (the old 'test' value was renamed to 'staging'). Hard-override it so the
// env schema validates — a plain `??=` can't win against Vitest's pre-set value.
if (!['development', 'production', 'staging'].includes(process.env.NODE_ENV ?? '')) {
  process.env.NODE_ENV = 'development';
}
