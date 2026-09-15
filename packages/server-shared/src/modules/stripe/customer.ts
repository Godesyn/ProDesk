import type Stripe from 'stripe';
import { stripe } from './client.js';

/**
 * Tolerant reads for a STORED Stripe customer id.
 *
 * A `cus_…` we persisted (users.stripeCustomerId, proposals, …) is only valid for
 * the Stripe account AND mode (test vs live) that minted it. Two routine things
 * break that pairing:
 *   - a prod DB restored into dev/staging (docs/agents prod-clone playbook) —
 *     the rows carry LIVE customer ids while the env runs a `sk_test_…` key;
 *   - a customer deleted from the Stripe dashboard.
 * Either way Stripe answers `resource_missing` ("No such customer: 'cus_…'"),
 * which a bare `customers.retrieve` throws — turning every card-on-file read and
 * the whole Add-card flow into a 500 instead of a "no card yet" empty state.
 *
 * Only `resource_missing` is swallowed: auth/network/rate-limit failures still
 * throw, so a misconfigured key can never be mistaken for "customer is gone" and
 * silently orphan a real customer.
 */
export async function retrieveCustomerOrNull(
  customerId: string,
): Promise<Stripe.Customer | null> {
  if (!stripe) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted ? null : customer;
  } catch (err) {
    if (isMissingResource(err)) return null;
    throw err;
  }
}

/** True when the stored id still resolves in the CURRENT Stripe account/mode. */
export async function stripeCustomerExists(customerId: string): Promise<boolean> {
  return (await retrieveCustomerOrNull(customerId)) !== null;
}

/** The customer's default payment-method id, or null (missing customer included). */
export async function customerDefaultPaymentMethodId(
  customerId: string,
): Promise<string | null> {
  const customer = await retrieveCustomerOrNull(customerId);
  if (!customer) return null;
  const dpm = customer.invoice_settings?.default_payment_method;
  return typeof dpm === 'string' ? dpm : (dpm?.id ?? null);
}

/** Stripe's "this object doesn't exist in this account/mode" error (a 404 on
 *  retrieve, a 400 when passed as a parameter — the code is the reliable part). */
export function isMissingResource(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'resource_missing';
}
