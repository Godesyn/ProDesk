import { z } from 'zod';

/** True for absolute http(s) URLs — the only schemes safe to redirect or link a visitor to. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A URL a visitor will be redirected or linked to. Use instead of
 * `z.string().url()`, which also accepts `javascript:` and `data:` URLs.
 */
export const httpUrl = (max = 2048) =>
  z.string().max(max).url().refine(isHttpUrl, 'Must be an http(s) link');
