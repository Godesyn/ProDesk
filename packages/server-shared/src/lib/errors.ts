import type { Worker } from 'bullmq';

/**
 * Deeply format an error for logging.
 *
 * `err.message` alone routinely hides the one fact you need:
 *  - drizzle wraps every DB failure in a `DrizzleQueryError` whose message is
 *    only `Failed query: <sql>\nparams: …` — the REAL Postgres error (missing
 *    column, constraint, RLS denial, connection reset, …) lives on `err.cause`.
 *  - postgres.js `PostgresError`s carry `.code/.detail/.hint/.constraint/…` that
 *    never appear in `.message`.
 *
 * So we walk the whole `cause` chain and surface the structured fields too.
 */
export function describeError(err: unknown, depth = 0): string {
  if (depth > 8) return '…(cause chain too deep)';
  if (err === null || err === undefined) return String(err);
  if (typeof err !== 'object') return String(err);

  const e = err as Record<string, unknown> & {
    message?: unknown;
    name?: unknown;
    cause?: unknown;
    stack?: unknown;
  };
  const parts: string[] = [];

  const name =
    typeof e.name === 'string' ? e.name : (e.constructor?.name ?? 'Error');
  const msg = typeof e.message === 'string' ? e.message : String(err);
  parts.push(`${name}: ${msg}`);

  // postgres.js / node-postgres structured fields — the actionable bits.
  const fields: string[] = [];
  for (const key of [
    'code',
    'severity',
    'detail',
    'hint',
    'where',
    'schema_name',
    'table_name',
    'column_name',
    'constraint_name',
    'routine',
  ] as const) {
    const v = e[key as keyof typeof e];
    if (v !== null && v !== undefined && v !== '') fields.push(`${key}=${v}`);
  }
  if (fields.length) parts.push('  ' + fields.join(' '));

  // Recurse into the cause chain (drizzle DrizzleQueryError.cause = PostgresError).
  if (e.cause !== null && e.cause !== undefined && e.cause !== err) {
    const inner = describeError(e.cause, depth + 1).replace(/\n/g, '\n     ');
    parts.push('  └─ caused by: ' + inner);
  }

  // Only include the stack of the outermost error, trimmed — the message lines
  // above already carry the "what"; the stack is the "where".
  if (depth === 0 && typeof e.stack === 'string') {
    const frames = e.stack.split('\n').slice(1, 6).join('\n');
    if (frames.trim()) parts.push(frames);
  }

  return parts.join('\n');
}

/**
 * Wire consistent lifecycle logging onto a BullMQ worker.
 *
 * Without this a failing job is either silent (BullMQ just marks it failed) or
 * logs a bare `err.message` that omits the underlying cause. `failed`/`error`
 * both go through {@link describeError} so the real reason (the Postgres cause
 * chain, the stack) is always visible. Returns the worker for chaining.
 */
export function attachWorkerLogging<W extends Worker>(
  worker: W,
  tag: string,
  opts: { logCompleted?: boolean } = {},
): W {
  if (opts.logCompleted) {
    worker.on('completed', (job) => {
      console.log(`[${tag}] ✓ ${job.name} done (id=${job.id})`);
    });
  }
  worker.on('failed', (job, err) => {
    console.error(
      `[${tag}] ✗ ${job?.name ?? '?'} FAILED (id=${job?.id}, attempt ${job?.attemptsMade}):\n${describeError(err)}`,
    );
  });
  // 'error' fires for worker-level problems not tied to a single job (e.g. a
  // Redis drop) — otherwise entirely invisible.
  worker.on('error', (err) => {
    console.error(`[${tag}] worker error:\n${describeError(err)}`);
  });
  return worker;
}
