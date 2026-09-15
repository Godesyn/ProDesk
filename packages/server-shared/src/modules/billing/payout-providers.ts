/**
 * Payout provider integrations. Ports functions/src/modules/billing/payout_services.ts.
 * Each returns a provider transaction id. Reads credentials from env; throws a
 * clear error when unconfigured so the payout stays pending and can be retried.
 */
import { isProd } from '../../lib/env.js';
import { payoutCents, roundPayoutDown } from '../../lib/num.js';
import { stripe } from '../stripe/client.js';
import {
  createWiseRecipient as createWiseRecipientAccount,
  type WireBankDetails,
} from './wise-recipient.js';

// Sandbox everywhere except production — so staging exercises the test APIs and
// never moves real money. (Wise elsewhere already keys on production.)
const PAYPAL_BASE = isProd
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';
const WISE_BASE = isProd
  ? 'https://api.transferwise.com'
  : 'https://api.sandbox.transferwise.tech';

export interface PayoutRequest {
  amount: number;
  currency: string;
  recipientEmail?: string;
  recipientStripeAccountId?: string;
  recipientId?: string; // wise recipient id
  note?: string;
}

async function paypalToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal not configured');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function payViaPaypal(req: PayoutRequest): Promise<string> {
  if (!req.recipientEmail)
    throw new Error('PayPal payout requires a recipient email');
  const token = await paypalToken();
  const batchId = `pd_${req.recipientId ?? req.recipientEmail}_${req.amount}`;
  const res = await fetch(`${PAYPAL_BASE}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'You have a payout from Prodesk',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          // PAYOUT → floor to whole cents so we never send more than collected.
          amount: { value: roundPayoutDown(req.amount).toFixed(2), currency: req.currency },
          receiver: req.recipientEmail,
          note: req.note ?? 'Prodesk payout',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PayPal payout failed (${res.status})`);
  const json = (await res.json()) as {
    batch_header?: { payout_batch_id?: string };
  };
  return json.batch_header?.payout_batch_id ?? batchId;
}

export async function payViaStripe(req: PayoutRequest): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  if (!req.recipientStripeAccountId)
    throw new Error('Beneficiary has no connected Stripe account');
  const transfer = await stripe.transfers.create({
    amount: payoutCents(req.amount), // PAYOUT → floor to whole cents

    currency: req.currency.toLowerCase(),
    destination: req.recipientStripeAccountId,
    description: req.note ?? 'Prodesk payout',
  });
  return transfer.id;
}

/** Wise has no payout route from our source balance into the target currency. */
class WiseRouteUnsupportedError extends Error {
  constructor(public readonly targetCurrency: string) {
    super(`Wise has no payout route into ${targetCurrency} from our balance`);
    this.name = 'WiseRouteUnsupportedError';
  }
}

/**
 * Our Wise balance can't yet fund this send — the Stripe funding payout is
 * settled per `payout.paid`, but the cash has NOT actually landed in / been
 * credited to our Wise balance (bank rails + Wise crediting lag behind Stripe's
 * "paid"). This is TRANSIENT: the balance lands within hours-to-2-business-days,
 * so the caller must NOT fail the payout — it should leave it retriable and
 * re-attempt later.
 *
 * Thrown in two spots: the PROACTIVE balance gate (before a transfer is created —
 * `transferId` undefined, nothing stranded), and the REACTIVE funding guard (the
 * transfer already exists but Wise 422'd the balance pay-in — `transferId` set so
 * the retry re-funds THAT transfer rather than minting a fresh one).
 */
export class WiseBalanceNotYetFundedError extends Error {
  constructor(public readonly transferId?: string) {
    super(
      transferId
        ? `Wise balance not yet funded to pay transfer ${transferId}`
        : 'Wise balance not yet credited — deferring transfer creation',
    );
    this.name = 'WiseBalanceNotYetFundedError';
  }
}

type WiseHeaders = { Authorization: string; 'Content-Type': string };

/** Whether a Wise fund-transfer failure means "our balance isn't credited yet". */
function isInsufficientBalance(status: number, body: string): boolean {
  return (
    status === 422 &&
    /insufficient|not enough|balance\.(insufficient|payment-option-unavailable)|low.balance/i.test(
      body,
    )
  );
}

/**
 * Available STANDARD balance for `currency` (0 when we hold none). Used by the
 * proactive gate to avoid creating a transfer we can't immediately fund — an
 * unfundable transfer strands in Wise's `incoming_payment_waiting` ("paused")
 * state until the balance lands, and every retry would mint another.
 */
async function wiseBalance(
  currency: string,
  profileId: string,
  headers: WiseHeaders,
): Promise<number> {
  const res = await fetch(
    `${WISE_BASE}/v4/profiles/${profileId}/balances?types=STANDARD`,
    { headers },
  );
  if (!res.ok)
    throw new Error(`Wise balance lookup failed (${res.status}): ${await res.text()}`);
  const balances = (await res.json()) as Array<{
    currency?: string;
    amount?: { value?: number };
  }>;
  const match = balances.find(
    (b) => b.currency?.toUpperCase() === currency.toUpperCase(),
  );
  return match?.amount?.value ?? 0;
}

/** Auth headers from env, or null when Wise isn't configured. */
function wiseHeadersFromEnv(): { headers: WiseHeaders; profileId: string } | null {
  const apiToken = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  if (!apiToken || !profileId) return null;
  return {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    profileId,
  };
}

/**
 * Fund an already-created Wise transfer from the platform's Wise balance
 * (leg-2's final step). Throws WiseBalanceNotYetFundedError when the balance
 * isn't credited yet (transient — retry later); any other failure throws a
 * plain Error. Shared by the first send and the retry sweep.
 */
async function postWiseTransferPayment(
  transferId: string,
  profileId: string,
  headers: WiseHeaders,
): Promise<void> {
  const fundRes = await fetch(
    `${WISE_BASE}/v3/profiles/${profileId}/transfers/${transferId}/payments`,
    { method: 'POST', headers, body: JSON.stringify({ type: 'BALANCE' }) },
  );
  if (!fundRes.ok) {
    const body = await fundRes.text();
    if (isInsufficientBalance(fundRes.status, body))
      throw new WiseBalanceNotYetFundedError(transferId);
    throw new Error(`Wise transfer funding failed (${fundRes.status}): ${body}`);
  }
}

/**
 * Re-fund an existing Wise transfer (retry sweep). Self-contained: reads
 * credentials from env and builds its own headers, so the caller only needs the
 * transfer id. Throws WiseBalanceNotYetFundedError while the balance is still in
 * transit.
 */
export async function fundWiseTransfer(transferId: string): Promise<void> {
  const cfg = wiseHeadersFromEnv();
  if (!cfg) throw new Error('Wise not configured');
  await postWiseTransferPayment(transferId, cfg.profileId, cfg.headers);
}

/** The recipient account's own (delivery) currency, UPPERCASE. */
async function wiseAccountCurrency(
  recipientId: string,
  headers: WiseHeaders,
): Promise<string> {
  const res = await fetch(`${WISE_BASE}/v1/accounts/${recipientId}`, { headers });
  if (!res.ok)
    throw new Error(`Wise recipient lookup failed (${res.status}): ${await res.text()}`);
  const currency = ((await res.json()) as { currency?: string }).currency?.toUpperCase();
  if (!currency) throw new Error('Wise recipient account has no currency');
  return currency;
}

/**
 * Quote → transfer → fund a single Wise send. Throws WiseRouteUnsupportedError
 * when the quote 422s with `error.route.not.supported` so the caller can retry
 * on a different currency; any other failure throws a plain Error.
 */
async function wiseQuoteTransferFund(opts: {
  recipientId: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  headers: WiseHeaders;
  profileId: string;
  // Called once the Wise transfer is created, BEFORE it is funded — lets the
  // caller persist the transfer id so a WiseBalanceNotYetFundedError leaves a
  // re-fundable row instead of an orphaned transfer.
  onTransferCreated?: (transferId: string) => void | Promise<void>;
}): Promise<string> {
  const { recipientId, sourceCurrency, targetCurrency, sourceAmount, headers, profileId, onTransferCreated } = opts;

  const quoteRes = await fetch(`${WISE_BASE}/v3/profiles/${profileId}/quotes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sourceCurrency,
      targetCurrency,
      // PAYOUT → floor to whole cents. Fixing the SOURCE amount disburses exactly
      // what we owe in the payout currency; Wise computes the converted target.
      sourceAmount,
      payOut: 'BALANCE',
    }),
  });
  if (!quoteRes.ok) {
    const body = await quoteRes.text();
    if (/route\.not\.supported/i.test(body))
      throw new WiseRouteUnsupportedError(targetCurrency);
    throw new Error(`Wise quote failed (${quoteRes.status}): ${body}`);
  }
  const quote = (await quoteRes.json()) as {
    id: string;
    paymentOptions?: Array<{
      payIn?: string;
      sourceAmount?: number;
      disabled?: boolean;
    }>;
  };

  // Proactive balance gate: only create a transfer we can fund from balance right
  // now. Creating one while the balance is short strands it in Wise's
  // `incoming_payment_waiting` ("paused") state until leg-1 credits our balance,
  // and each retry mints another. Skip instead — the caller (dispatchWiseLeg2)
  // treats this as transient and re-attempts next sweep. The reactive
  // insufficient-balance guard on funding below stays as the backstop for the
  // (tiny) check→fund race. Dispatch loops are sequential, so each read reflects
  // the debit of the previous payout funded in the same tick.
  const balanceOption = quote.paymentOptions?.find(
    (o) => o.payIn === 'BALANCE' && !o.disabled,
  );
  const requiredSource = balanceOption?.sourceAmount ?? sourceAmount;
  const available = await wiseBalance(sourceCurrency, profileId, headers);
  if (available < requiredSource) throw new WiseBalanceNotYetFundedError();

  const transferRes = await fetch(`${WISE_BASE}/v1/transfers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetAccount: Number(recipientId),
      quoteUuid: quote.id,
      customerTransactionId: crypto.randomUUID(),
      details: { reference: 'Prodesk' },
    }),
  });
  if (!transferRes.ok)
    throw new Error(`Wise transfer failed (${transferRes.status}): ${await transferRes.text()}`);
  const transfer = (await transferRes.json()) as { id: number };
  const transferId = String(transfer.id);
  // Surface the transfer id before funding: if funding can't complete yet
  // (balance still in transit) the caller can re-fund THIS transfer later.
  if (onTransferCreated) await onTransferCreated(transferId);

  // Fund the transfer from the platform's Wise balance so it actually sends.
  // (Ports wise_helpers.ts leg-2.) The wise webhook then advances it to
  // OUTGOING_PAYMENT_SENT → the payout is marked received.
  await postWiseTransferPayment(transferId, profileId, headers);
  return transferId;
}

/**
 * Build a USD recipient from an existing recipient's own bank details (fetched
 * from Wise) — the fallback when the recipient's native currency has no payout
 * route from our AUD balance (e.g. ALL). Reuses the IBAN/account number, BIC and
 * address already on file; Wise's USD `swift_code` type delivers to most foreign
 * banks. Returns the new recipient id.
 */
async function createUsdFallbackRecipient(
  recipientId: string,
  token: string,
  profileId: string,
  headers: WiseHeaders,
): Promise<string> {
  const res = await fetch(`${WISE_BASE}/v1/accounts/${recipientId}`, { headers });
  if (!res.ok)
    throw new Error(`Wise recipient lookup failed (${res.status}): ${await res.text()}`);
  const acc = (await res.json()) as {
    accountHolderName?: string;
    country?: string;
    details?: Record<string, any>;
  };
  const d = acc.details ?? {};
  const details: WireBankDetails = {
    accountHolderName: acc.accountHolderName || d.accountHolderName || '',
    currency: 'USD',
    accountNumber: d.accountNumber || d.IBAN || d.iban || null,
    swiftCode: d.swiftCode || d.bic || d.BIC || null,
    country: acc.country || d.address?.country || null,
    address: d.address
      ? {
          firstLine: d.address.firstLine ?? null,
          city: d.address.city ?? null,
          state: d.address.state ?? null,
          postCode: d.address.postCode ?? null,
          country: d.address.country ?? null,
        }
      : null,
  };
  const { recipientId: usdId } = await createWiseRecipientAccount(
    { baseUrl: WISE_BASE, token, profileId, sourceCurrency: 'AUD' },
    details,
  );
  return usdId;
}

export async function payViaWise(
  req: PayoutRequest,
  opts?: { onTransferCreated?: (transferId: string) => void | Promise<void> },
): Promise<string> {
  const apiToken = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  if (!apiToken || !profileId) throw new Error('Wise not configured');
  if (!req.recipientId)
    throw new Error('Wise payout requires a linked recipient id');
  const headers: WiseHeaders = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };
  const onTransferCreated = opts?.onTransferCreated;

  // Wise requires UPPERCASE ISO-4217 codes; payout.currency is stored lowercase
  // (Stripe, used for leg 1, accepts lowercase). A lowercase code 400s the quote.
  const sourceCurrency = req.currency.toUpperCase();
  // PAYOUT → floor to whole cents. Fixing the SOURCE amount disburses exactly
  // what we owe in the payout currency; Wise computes the converted target.
  const sourceAmount = roundPayoutDown(req.amount);

  // A BALANCE payout must be DELIVERED in the recipient account's own currency:
  // a same-currency quote/transfer 422s when the linked account holds a different
  // currency (e.g. an AUD payout to a USD account). Look up the account currency
  // and let Wise convert from our source balance when they differ.
  const targetCurrency = await wiseAccountCurrency(req.recipientId, headers);

  try {
    return await wiseQuoteTransferFund({
      recipientId: req.recipientId,
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      headers,
      profileId,
      onTransferCreated,
    });
  } catch (err) {
    // No route from our balance into the recipient's currency (e.g. AUD→ALL).
    // Fall back to a USD recipient built from the same bank details and send in
    // USD — AUD→USD is broadly supported and reaches most banks via SWIFT. Guard
    // against a pointless loop when USD is already involved.
    if (
      !(err instanceof WiseRouteUnsupportedError) ||
      sourceCurrency === 'USD' ||
      targetCurrency === 'USD'
    )
      throw err;
    console.warn(
      `[wise] ${sourceCurrency}→${targetCurrency} has no payout route — retrying via a USD recipient`,
    );
    const usdRecipientId = await createUsdFallbackRecipient(
      req.recipientId,
      apiToken,
      profileId,
      headers,
    );
    return await wiseQuoteTransferFund({
      recipientId: usdRecipientId,
      sourceCurrency,
      targetCurrency: 'USD',
      sourceAmount,
      headers,
      profileId,
      onTransferCreated,
    });
  }
}
