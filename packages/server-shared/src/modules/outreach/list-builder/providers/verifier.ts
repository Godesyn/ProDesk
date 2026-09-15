import { env } from '../../../../lib/env.js';

/**
 * Email verification.
 *
 * §2.8: mandatory before any address reaches Smartlead. This is the single
 * highest-leverage safety control in the feature — bounces burn sending domains
 * faster than anything else we do — so it is never optional and never "best
 * effort". A missing key BLOCKS a run rather than quietly skipping the gate.
 */

export type VerifyResult = 'valid' | 'invalid' | 'unknown';

export interface Verifier {
  configured: boolean;
  verify(email: string): Promise<VerifyResult>;
}

export const verifier: Verifier = {
  get configured() {
    return !!env.MILLIONVERIFIER_API_KEY;
  },

  async verify(email) {
    if (!env.MILLIONVERIFIER_API_KEY) throw new Error('No email verifier is configured.');
    const url = new URL('https://api.millionverifier.com/api/v3/');
    url.searchParams.set('api', env.MILLIONVERIFIER_API_KEY);
    url.searchParams.set('email', email);
    url.searchParams.set('timeout', '20');

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    // A transport failure is NOT a verdict. Reporting it as `invalid` would
    // silently discard good contacts during an outage; `unknown` is dropped
    // from the send list too, but is counted separately so a run that lost
    // half its list to a flaky API looks different from one that scraped
    // half a list of dead addresses.
    if (!res.ok) return 'unknown';
    const body = (await res.json().catch(() => null)) as { result?: string } | null;
    if (!body?.result) return 'unknown';

    // Only "ok" passes. `catch_all` looks deliverable and frequently isn't —
    // treating it as valid is how a clean list starts bouncing.
    if (body.result === 'ok') return 'valid';
    if (body.result === 'unknown' || body.result === 'error') return 'unknown';
    return 'invalid';
  },
};
