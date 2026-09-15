import { env } from '../../lib/env.js';

/**
 * Environment isolation for a SHARED Stripe account.
 *
 * Multiple deployments (dev / staging / production) can point at the same Stripe
 * account. Stripe fans every event out to *every* configured webhook endpoint,
 * so a checkout completed in staging is also delivered to the dev endpoint (and
 * vice versa). Without scoping, the foreign environment can't find the purchase
 * in its own DB and `fulfillPurchase` throws → 500 → Stripe retry storm.
 *
 * The fix: stamp every Stripe object we create with an `env` metadata tag, and
 * have the webhook ignore events whose tag isn't this deployment's `NODE_ENV`.
 * Objects created before this existed (and prod's live objects) carry no tag —
 * those are processed normally, so nothing regresses.
 */
export const STRIPE_ENV_KEY = 'env';

/** Merge this deployment's environment tag into a Stripe `metadata` object. */
export function withEnvTag<T extends Record<string, string>>(
  meta: T = {} as T,
): T & { env: string } {
  return { ...meta, [STRIPE_ENV_KEY]: env.NODE_ENV };
}

/** Read the env tag off a webhook event's object. Invoices don't carry their own
 *  metadata for subscription charges — it lives under `subscription_details`. */
export function eventEnvTag(obj: {
  metadata?: Record<string, string> | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
}): string | undefined {
  return (
    obj?.metadata?.[STRIPE_ENV_KEY] ??
    obj?.subscription_details?.metadata?.[STRIPE_ENV_KEY] ??
    undefined
  );
}
