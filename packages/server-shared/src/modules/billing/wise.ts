import { and, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { payouts } from '../../db/schema.js';
import { stripe } from '../stripe/client.js';
import { withEnvTag } from '../stripe/env-tag.js';
import {
  payViaWise,
  fundWiseTransfer,
  WiseBalanceNotYetFundedError,
} from './payout-providers.js';
import {
  createWiseRecipient as resolveWiseRecipient,
  resolveTargetCurrency,
} from './wise-recipient.js';
import { resolvePayoutRecipient } from './payout-recipient.js';
import { payoutCents } from '../../lib/num.js';

/**
 * Wise payout, funded through Stripe — ported from main's reworked flow
 * (functions/src/modules/billing/payout_cron.ts + wise_helpers.ts, "wise and
 * stripe updates"). The Wise balance is topped up via Stripe in two legs, then
 * the money is sent to the recipient through the Wise API:
 *
 *   leg 1a  Stripe transfer: platform balance → Wise's Stripe Connect account
 *   leg 1b  Stripe payout:   connected account → its linked bank (= Wise account)
 *           (carries metadata.purpose = 'wise-funding'; confirmed via webhook)
 *   leg 2   Wise transfer:   Wise balance → recipient's bank
 *
 * The umbrella payout.status stays `processingByWire`; the fine-grained step is
 * tracked in payouts.wiseFunding.status.
 */

const connectAccountId = () => process.env.WISE_STRIPE_CONNECT_ACCOUNT_ID;
const isDevEnv = process.env.NODE_ENV !== 'production';
const WISE_BASE = isDevEnv
  ? 'https://api.sandbox.transferwise.tech'
  : 'https://api.transferwise.com';

export interface BankDetails {
  accountHolderName: string;
  currency?: string | null;
  accountNumber?: string;
  swiftCode?: string | null;
  bankName?: string;
  country?: string;
  routingNumber?: string | null;
  accountType?: string | null;
  address?: {
    firstLine?: string | null;
    city?: string | null;
    state?: string | null;
    postCode?: string | null;
    country?: string | null;
  } | null;
}

/**
 * Whether Wise can pay OUT from our AUD balance into `targetCurrency`. Wise will
 * happily CREATE a recipient in a currency it can't actually deliver from an AUD
 * balance (e.g. ALL — Albanian Lek): the account-requirements API accepts it, but
 * the eventual send 422s with `error.route.not.supported`, stranding the payout
 * with money sitting in our Wise balance. A non-committal BALANCE quote is the
 * only thing that surfaces this ahead of time (no money moves). Returns `true` on
 * any non-route failure (network/transient) so we never block linking on a hiccup.
 */
async function isAudBalanceRouteSupported(
  targetCurrency: string,
  token: string,
  profileId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${WISE_BASE}/v3/profiles/${profileId}/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceCurrency: 'AUD',
        targetCurrency,
        sourceAmount: 100,
        payOut: 'BALANCE',
      }),
    });
    if (res.ok) return true;
    return !/route\.not\.supported/i.test(await res.text());
  } catch {
    return true;
  }
}

/**
 * Create a Wise recipient (account) for a beneficiary's bank details and return
 * its id. Ports linkWiseRecipient/validateWiseRecipient (wise_helpers.ts). Returns
 * null when Wise isn't configured so dev can still store bank details locally.
 *
 * Currency fallback: if the beneficiary's natural payout currency has no
 * deliverable route from our AUD balance (see isAudBalanceRouteSupported — ALL is
 * the known case), create the recipient in USD instead. AUD→USD is broadly
 * supported and reaches most banks via SWIFT, so the payout can actually settle.
 * This needs a SWIFT/BIC on file for the beneficiary; if it's missing the USD
 * recipient create fails loudly with a clear missing-field error (better than a
 * recipient that silently can never be paid).
 */
export async function createWiseRecipient(
  details: BankDetails,
): Promise<string | null> {
  const token = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  // Dev without Wise configured: store bank details locally, no network call.
  if (!token || !profileId) return null;

  let effective = details;
  let intended: string | null = null;
  try {
    intended = resolveTargetCurrency(details);
  } catch {
    // Currency couldn't be resolved — let resolveWiseRecipient raise the precise
    // error rather than pre-empting it here.
  }
  // Skip the probe for AUD (our balance currency — a same-currency send never has
  // a route problem) and USD (already our fallback target).
  if (
    intended &&
    intended !== 'USD' &&
    intended !== 'AUD' &&
    !(await isAudBalanceRouteSupported(intended, token, profileId))
  ) {
    console.warn(
      `[wise] AUD→${intended} is not payable from our balance — creating the recipient in USD instead`,
    );
    effective = { ...details, currency: 'USD' };
  }

  const { recipientId } = await resolveWiseRecipient(
    {
      baseUrl: WISE_BASE,
      token,
      profileId,
      sourceCurrency: 'AUD',
      onWarn: (m, e) => console.warn(m, e),
    },
    effective,
  );
  return recipientId;
}

/** Leg 1: fund our Wise balance for a single payout. Returns the Stripe payout id. */
export async function fundWiseViaStripe(
  payoutId: string,
  db = defaultDb,
): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  const acct = connectAccountId();
  if (!acct) throw new Error('WISE_STRIPE_CONNECT_ACCOUNT_ID not set');

  const payout = (
    await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1)
  )[0];
  if (!payout) throw new Error('Payout not found');
  const gross = Number(payout.amount);
  const currency = payout.currency.toLowerCase();
  const cents = payoutCents(gross); // PAYOUT → floor to whole cents

  // leg 1a — platform balance → Wise's Stripe Connect account
  const transfer = await stripe.transfers.create({
    amount: cents,
    currency,
    destination: acct,
    description: `Wise funding ${payoutId}`,
  });
  // leg 1b — connected account → its linked bank (the actual Wise account)
  const stripePayout = await stripe.payouts.create(
    {
      amount: cents,
      currency,
      metadata: withEnvTag({ purpose: 'wise-funding', payoutId }),
    },
    { stripeAccount: acct },
  );

  await db
    .update(payouts)
    .set({
      status: 'processingByWire',
      method: 'wire',
      transactionId: stripePayout.id,
      wiseFunding: {
        status: 'paying_out',
        grossAmount: gross,
        fundingTransferId: transfer.id,
        stripePayoutId: stripePayout.id,
        payoutAttemptCount: 1,
      },
    })
    .where(eq(payouts.id, payoutId));
  // Invoice status is derived from this payout at read time (docs/invoices.md §7).
  return stripePayout.id;
}

async function findByStripePayoutId(stripePayoutId: string, db = defaultDb) {
  const rows = await db
    .select()
    .from(payouts)
    .where(sql`${payouts.wiseFunding} ->> 'stripePayoutId' = ${stripePayoutId}`)
    .limit(1);
  return rows[0] ?? null;
}

/** Stripe `payout.paid` for a wise-funding payout → balance landed → send out (leg 2). */
export async function handleWiseStripePayoutPaid(
  stripePayoutId: string,
  db = defaultDb,
): Promise<string | null> {
  const payout = await findByStripePayoutId(stripePayoutId, db);
  if (!payout) return null;
  const wf = payout.wiseFunding ?? {};
  // Idempotency: `payout.paid` can be re-delivered (Stripe retries, manual
  // re-sends). Leg 2 has already sent once wiseFunding is `transferring` or the
  // umbrella payout is `received` — firing it again would pay the recipient
  // twice. Skip.
  if (wf.status === 'transferring' || payout.status === 'received') {
    console.warn(
      '[wise] payout.paid re-delivered but leg-2 already sent — skipping',
      payout.id,
      wf.status ?? payout.status,
    );
    return null;
  }
  const funded = { ...wf, status: 'funded' as const, fundedAmount: wf.grossAmount };
  await db
    .update(payouts)
    .set({ wiseFunding: funded })
    .where(eq(payouts.id, payout.id));

  return dispatchWiseLeg2({ ...payout, wiseFunding: funded }, db);
}

type PayoutRow = Awaited<ReturnType<typeof findByStripePayoutId>>;

/**
 * Send (or re-send) leg 2 for a `funded` wise payout. Shared by the Stripe
 * `payout.paid` handler and the hourly retry sweep.
 *
 * The critical fix: Stripe's `payout.paid` only means the funding was SENT to
 * our Wise-linked bank — the cash often hasn't been credited to our Wise
 * BALANCE yet (rails lag hours-to-days). Funding leg 2 then fails with an
 * insufficient-balance error. That is TRANSIENT, so a WiseBalanceNotYetFundedError
 * leaves the payout `funded`/`processingByWire` (never `failed`) for the retry
 * sweep, which re-funds the SAME transfer once the balance lands. Only a genuine,
 * non-recoverable leg-2 failure marks the payout `failed`.
 */
async function dispatchWiseLeg2(
  payout: NonNullable<PayoutRow>,
  db = defaultDb,
): Promise<string | null> {
  const wf = payout.wiseFunding ?? {};

  // A transfer was already created on a prior attempt — just re-fund it (never
  // mint a second transfer, which would strand orphan sends).
  if (wf.wiseTransferId) {
    try {
      await fundWiseTransfer(wf.wiseTransferId);
    } catch (err) {
      if (err instanceof WiseBalanceNotYetFundedError) {
        console.warn(
          '[wise] balance not yet credited — leg-2 re-fund deferred to retry sweep',
          payout.id,
          wf.wiseTransferId,
        );
        return null; // stay `funded` — the hourly retry tries again
      }
      // An unexpected re-fund error: the money is in transit, so leave it
      // `funded` for the retry / manual review rather than marking `failed`
      // (which would strand it — retryFailedPayouts skips wise rows).
      console.error(
        '[wise] leg-2 re-fund failed — left funded for retry',
        payout.id,
        (err as Error).message,
      );
      return null;
    }
    await db
      .update(payouts)
      .set({
        status: 'processingByWire',
        transactionId: wf.wiseTransferId,
        wiseFunding: { ...wf, status: 'transferring', fundedAmount: wf.grossAmount },
      })
      .where(eq(payouts.id, payout.id));
    return wf.wiseTransferId;
  }

  // First send: create + fund a transfer. The onTransferCreated hook persists
  // its id BEFORE funding, so a balance-not-yet-funded failure still leaves a
  // re-fundable row.
  const recipient = await resolvePayoutRecipient(payout, db);
  const pm = (recipient?.payoutMethods ?? {}) as Record<
    string,
    { recipientId?: string }
  >;
  try {
    const wiseTransferId = await payViaWise(
      {
        amount: Number(payout.amount),
        currency: payout.currency,
        recipientId: pm.wire?.recipientId,
      },
      {
        onTransferCreated: async (id) => {
          await db
            .update(payouts)
            .set({
              wiseFunding: {
                ...wf,
                status: 'funded',
                fundedAmount: wf.grossAmount,
                wiseTransferId: id,
              },
            })
            .where(eq(payouts.id, payout.id));
        },
      },
    );
    await db
      .update(payouts)
      .set({
        // Reset the umbrella status: a prior failed attempt (e.g. an
        // unsupported route, now settled via the USD fallback) may have left
        // this `failed`. Leg 2 is in flight again → back to `processingByWire`.
        status: 'processingByWire',
        transactionId: wiseTransferId,
        wiseFunding: {
          ...wf,
          status: 'transferring',
          fundedAmount: wf.grossAmount,
          wiseTransferId,
        },
      })
      .where(eq(payouts.id, payout.id));
    // The Wise webhook (wisePayoutWebhook, `outgoing_payment_sent`) later flips
    // this to `received`. There is no polling fallback — a missed/unverified
    // webhook leaves the payout stuck in `transferring`.
    return wiseTransferId;
  } catch (err) {
    if (err instanceof WiseBalanceNotYetFundedError) {
      // Balance not credited yet. Either the proactive gate fired BEFORE creating
      // a transfer (err.transferId undefined — nothing stranded), or a transfer
      // was created and its id was persisted by the hook before funding 422'd
      // (err.transferId set — the retry re-funds THAT transfer). Both leave the
      // row `funded` for the sweep: a transient shortfall must NOT become a
      // permanent `failed`.
      console.warn(
        '[wise] balance not yet credited — leg 2 will retry',
        payout.id,
        err.transferId ?? '(no transfer created)',
      );
      return null;
    }
    // Genuine, non-recoverable leg-2 failure (e.g. an unsupported route with the
    // USD fallback exhausted, or a bad recipient). Money is in our Wise balance;
    // DON'T re-throw (Stripe would retry for ~3 days looping the same call).
    // Record `failed` durably and ack; reconcile manually.
    await db
      .update(payouts)
      .set({ status: 'failed' })
      .where(eq(payouts.id, payout.id));
    console.error(
      '[wise] leg-2 dispatch failed — funds in Wise balance, reconcile manually',
      payout.id,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Retry sweep for wise payouts stranded at leg 2: funding settled
 * (`wiseFunding.status = 'funded'`, i.e. the Stripe `payout.paid` for leg 1 DID
 * arrive) but the send never completed because our Wise balance wasn't credited
 * in time. Covers BOTH the new transient state (`processingByWire`) AND rows the
 * old code marked `failed` for the same reason — including pre-existing ones from
 * before this fix (no `wiseTransferId` → re-run full leg 2; a fresh transfer is
 * created + funded from the balance the leg-1 funding put there).
 *
 * Only `wiseFunding.status = 'funded'` rows qualify, which by construction
 * excludes leg-1 funding failures (those stay `paying_out`), so we never try to
 * send money that isn't in the balance. `dispatchWiseLeg2` re-funds an existing
 * transfer when one is recorded (idempotent, no orphan/duplicate sends) and flips
 * a recovered row back to `processingByWire`. Safe to run repeatedly — it NEVER
 * re-runs leg-1 funding. Wired into the hourly cron AND the weekly/admin dispatch.
 *
 * A `failed` row with NO recorded `wiseTransferId` is deliberately left alone,
 * because that state cannot tell us whether money already moved:
 *   • post-gate it usually means leg 2 died BEFORE creating a transfer (a quote or
 *     route failure), so nothing was sent and a first send would be safe — but
 *   • the pre-gate code produced the SAME state after creating a transfer it
 *     couldn't fund, without persisting that transfer's id. Those transfers were
 *     frequently funded and SENT hours later, once leg-1's cash reached our
 *     balance (see scripts/reconcile-sent-wise-payouts.ts).
 * The two are indistinguishable from the row alone, and the downside is asymmetric:
 * skipping delays a payout, first-sending pays the beneficiary TWICE. So we skip,
 * shout, and count it — resolve by reconciling against Wise. `processingByWire`
 * rows carry no such ambiguity: that state is only ever reached post-gate, where a
 * missing transfer id provably means the gate skipped before creating one.
 */
export async function retryFundedWiseLeg2(db = defaultDb): Promise<{
  considered: number;
  sent: number;
  needsReconcile: number;
}> {
  const rows = await db
    .select()
    .from(payouts)
    .where(
      and(
        inArray(payouts.status, ['processingByWire', 'failed']),
        sql`${payouts.wiseFunding} ->> 'status' = 'funded'`,
      ),
    );
  let sent = 0;
  let needsReconcile = 0;
  for (const p of rows) {
    if (p.status === 'failed' && !p.wiseFunding?.wiseTransferId) {
      needsReconcile++;
      console.error(
        '[wise] leg-2 retry SKIPPED — `failed` with no wiseTransferId, so a ' +
          'transfer may already have been sent for it; reconcile manually ' +
          '(scripts/reconcile-sent-wise-payouts.ts) rather than re-sending',
        p.id,
        p.amount,
      );
      continue;
    }
    try {
      if (await dispatchWiseLeg2(p, db)) sent++;
    } catch (e) {
      console.error('[wise] leg-2 retry errored', p.id, (e as Error).message);
    }
  }
  if (rows.length)
    console.log('[wise] leg-2 retry sweep', {
      considered: rows.length,
      sent,
      needsReconcile,
    });
  return { considered: rows.length, sent, needsReconcile };
}

/** Stripe `payout.failed` / `payout.canceled` for a wise-funding payout. */
export async function handleWiseStripePayoutFailed(
  stripePayoutId: string,
  reason: string,
  db = defaultDb,
): Promise<void> {
  const payout = await findByStripePayoutId(stripePayoutId, db);
  if (!payout) return;
  await db
    .update(payouts)
    .set({ status: 'failed' })
    .where(eq(payouts.id, payout.id));
  console.error('[wise] Stripe funding payout failed', stripePayoutId, reason);
}
