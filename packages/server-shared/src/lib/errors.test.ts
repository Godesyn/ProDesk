import { describe, it, expect } from 'vitest';
import { describeError } from './errors.js';

describe('describeError', () => {
  it('surfaces the Postgres cause that drizzle hides behind "Failed query"', () => {
    // Shape of a drizzle DrizzleQueryError wrapping a postgres.js PostgresError.
    const pgError = Object.assign(
      new Error('column "foo" does not exist'),
      { name: 'PostgresError', code: '42703', severity: 'ERROR' },
    );
    const drizzleError = Object.assign(
      new Error('Failed query: select "foo" from "staff"\nparams: '),
      { name: 'DrizzleQueryError', cause: pgError },
    );

    const out = describeError(drizzleError);
    expect(out).toContain('Failed query');
    // The whole point: the real reason is now visible.
    expect(out).toContain('caused by');
    expect(out).toContain('column "foo" does not exist');
    expect(out).toContain('code=42703');
  });

  it('handles non-Error values and null without throwing', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(null)).toBe('null');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('does not loop forever on a self-referential cause', () => {
    const e = new Error('loop') as Error & { cause?: unknown };
    e.cause = e;
    expect(() => describeError(e)).not.toThrow();
  });
});
