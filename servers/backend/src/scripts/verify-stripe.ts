/**
 * Staging verification for the Stripe shapes the services/projects flow relies
 * on (test mode). Exercises the exact API calls our code makes:
 *   • buildCheckoutLineItems → checkout.sessions.create (per-item recurring lines
 *     + one-time due-today line; delayed phases excluded)
 *   • product-metadata → subscription-item mapping (persistSubscriptionItemIds)
 *   • subscriptionItems.create (delayed-phase activation)
 *   • subscriptionItems.del one item (single-project cancel) + cancel whole (last)
 *
 * Run: bun run src/scripts/verify-stripe.ts   (uses STRIPE test key from .env)
 */
import { stripe } from '@prodesk/server-shared/modules/stripe/client';
import { buildCheckoutLineItems } from '@prodesk/server-shared/modules/billing/subscription';

async function main() {
  if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured');

  // 1) Checkout line items: per-item lines from each item's amount snapshot —
  // a recurring retainer (setup one-time + forever weekly), a delayed retainer
  // (excluded), and a one-off (deposit one-time). Expect mode=subscription and
  // 3 lines (retainer setup + retainer weekly + one-off upfront).
  const items = [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      serviceName: 'Weekly SEO',
      serviceType: 'recurringService',
      amount: {
        recurring: { upfront: 100, weeklyAfter: 50 },
        oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 },
        oneOffTotal: 0,
      },
      startDelayDays: null,
    },
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      serviceName: 'Delayed retainer',
      serviceType: 'recurringService',
      amount: {
        recurring: { upfront: 0, weeklyAfter: 80 },
        oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 },
        oneOffTotal: 0,
      },
      startDelayDays: 40,
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      serviceName: 'One-off audit',
      serviceType: 'oneOffService',
      amount: {
        recurring: { upfront: 0, weeklyAfter: 0 },
        oneOff: { upfront: 200, weeklyAfter: 0, numberOfWeeks: 0 },
        oneOffTotal: 200,
      },
      startDelayDays: null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;
  const { mode, lineItems } = buildCheckoutLineItems(items, 'VERIFY01');
  if (mode !== 'subscription')
    throw new Error(`expected subscription mode, got ${mode}`);
  if (lineItems.length !== 3)
    throw new Error(
      `expected 3 line items (retainer setup + retainer weekly + one-off upfront, delayed excluded), got ${lineItems.length}`,
    );
  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: lineItems,
    subscription_data: { metadata: { purchaseId: 'verify' } },
    success_url: 'https://example.com/s',
    cancel_url: 'https://example.com/c',
  });
  console.log(
    `✓ checkout session created (${session.id}, mode=${session.mode})`,
  );

  // 2) Per-item subscription lifecycle against a test customer.
  const customer = await stripe.customers.create({ name: 'Prodesk verify' });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  const prodA = await stripe.products.create({
    name: 'Item A',
    metadata: { purchaseItemId: 'item-A' },
  });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [
      {
        price_data: {
          currency: 'aud',
          recurring: { interval: 'week' },
          unit_amount: 5000,
          product: prodA.id,
        },
      },
    ],
    metadata: { purchaseId: 'verify' },
  });
  console.log(
    `✓ subscription created (${sub.id}) with ${sub.items.data.length} item`,
  );

  // delayed-phase activation: add a 2nd subscription item later
  const prodB = await stripe.products.create({
    name: 'Item B',
    metadata: { purchaseItemId: 'item-B' },
  });
  const si2 = await stripe.subscriptionItems.create({
    subscription: sub.id,
    price_data: {
      currency: 'aud',
      recurring: { interval: 'week' },
      unit_amount: 8000,
      product: prodB.id,
    },
    proration_behavior: 'none',
  });
  console.log(`✓ added 2nd subscription item on activation (${si2.id})`);

  // mapping: expanded product metadata → purchaseItemId (persistSubscriptionItemIds)
  const refetched = await stripe.subscriptions.retrieve(sub.id, {
    expand: ['items.data.price.product'],
  });
  const mapped = refetched.items.data
    .map(
      (i) =>
        (i.price.product as { metadata?: Record<string, string> }).metadata
          ?.purchaseItemId,
    )
    .sort();
  if (mapped.join(',') !== 'item-A,item-B')
    throw new Error(`metadata mapping wrong: ${mapped.join(',')}`);
  console.log(`✓ product-metadata mapping resolves [${mapped.join(', ')}]`);

  // single-project cancel: del one item, the other keeps billing
  await stripe.subscriptionItems.del(si2.id, { proration_behavior: 'none' });
  const afterDel = await stripe.subscriptions.retrieve(sub.id);
  if (afterDel.items.data.length !== 1)
    throw new Error(
      `expected 1 item after del, got ${afterDel.items.data.length}`,
    );
  console.log(
    `✓ single-item cancel leaves ${afterDel.items.data.length} item billing (sub still active)`,
  );

  // last item → cancel the whole subscription
  await stripe.subscriptions.cancel(sub.id);
  console.log('✓ whole subscription cancelled on last item');

  await stripe.customers.del(customer.id);
  console.log('\nALL STRIPE SHAPE CHECKS PASSED ✅');
}

main().catch((e) => {
  console.error('\nSTRIPE CHECK FAILED ❌:', e?.message ?? e);
  process.exit(1);
});
