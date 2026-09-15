import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// Neutralise Stripe — sync reconciles the subscription's items (one per
// grandfathered price) via subscriptions.retrieve + update; assert the update
// without a live API. The Stripe sub carries one item at the seeded price.
const { retrieveSub, updateSub, cancelSub } = vi.hoisted(() => ({
  retrieveSub: vi.fn().mockResolvedValue({
    items: { data: [{ id: 'si_test', price: { id: 'price_stripe_test' } }] },
  }),
  updateSub: vi.fn().mockResolvedValue({}),
  cancelSub: vi.fn().mockResolvedValue({}),
}));
vi.mock('../stripe/client.js', () => ({
  stripe: { subscriptions: { retrieve: retrieveSub, update: updateSub, cancel: cancelSub } },
}));
import {
  users,
  brands,
  shortLinks,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  featureSubscriptionPrices,
  featureSubscriptions,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';
import {
  countOwnerActiveLinks,
  getOwnerUrlSubscription,
  getUrlShortenerOffer,
  syncUrlShortenerQuantity,
} from './per-unit.js';

/**
 * Per-unit (quantity-scaled) URL-shortener billing. Stripe is unconfigured in the
 * test env, so `syncUrlShortenerQuantity` exercises the count + our-row mirror
 * (the Stripe item update is skipped) — which is exactly the local-state path we
 * need to guarantee bills the owner for the right number of ACTIVE links.
 */
describe('per-unit url-shortener billing', () => {
  let db: DB;
  let close: () => Promise<void>;

  const id = {
    owner: randomUUID(),
    otherOwner: randomUUID(),
    brandA: randomUUID(),
    brandB: randomUUID(),
    otherBrand: randomUUID(),
    product: randomUUID(),
    tier: randomUUID(),
    price: randomUUID(),
    sub: randomUUID(),
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.owner, email: 'owner@t' },
      { id: id.otherOwner, email: 'other@t' },
    ]);
    await db.insert(brands).values([
      { id: id.brandA, ownerId: id.owner, businessName: 'Brand A' },
      { id: id.brandB, ownerId: id.owner, businessName: 'Brand B' },
      { id: id.otherBrand, ownerId: id.otherOwner, businessName: 'Other' },
    ]);
    // Owner: 2 active (across both brands) + 1 inactive. Other owner: 1 active.
    await db.insert(shortLinks).values([
      { brandId: id.brandA, slug: 'a1', destinationUrl: 'https://x.test/1', nickname: 'A1', isActive: true },
      { brandId: id.brandB, slug: 'b1', destinationUrl: 'https://x.test/2', nickname: 'B1', isActive: true },
      { brandId: id.brandA, slug: 'a2', destinationUrl: 'https://x.test/3', nickname: 'A2', isActive: false },
      { brandId: id.otherBrand, slug: 'o1', destinationUrl: 'https://x.test/4', nickname: 'O1', isActive: true },
    ]);
    // The per-unit URL-shortener product ($1/active link/month).
    await db.insert(featureSubscriptionProducts).values({
      id: id.product, name: 'URL Shortener', slug: 'url-shortener',
      featureKey: 'url_shortener', featureKeys: ['url_shortener'], perUnit: true,
    });
    await db.insert(featureSubscriptionTiers).values({ id: id.tier, productId: id.product, name: 'Standard' });
    await db.insert(featureSubscriptionPrices).values({
      id: id.price, tierId: id.tier, interval: 'month', amount: '1.00', currency: 'AUD',
      stripePriceId: 'price_stripe_test', // pre-minted so sync needn't create one
    });
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('counts only ACTIVE links across all the owner brands, ignoring other owners', async () => {
    expect(await countOwnerActiveLinks(db, id.owner)).toBe(2);
    expect(await countOwnerActiveLinks(db, id.otherOwner)).toBe(1);
  });

  it('exposes the active per-unit offer (product + monthly price)', async () => {
    const offer = await getUrlShortenerOffer(db);
    expect(offer?.product.id).toBe(id.product);
    expect(offer?.priceId).toBe(id.price);
    expect(offer?.unitAmount).toBe(1);
    expect(offer?.currency).toBe('AUD');
  });

  it('sync is a no-op when the owner has no active subscription', async () => {
    expect(await getOwnerUrlSubscription(db, id.owner)).toBeNull();
    await syncUrlShortenerQuantity(db, id.owner); // must not throw
  });

  it('sets the subscription quantity to the live active-link count', async () => {
    await db.insert(featureSubscriptions).values({
      id: id.sub, userId: id.owner, productId: id.product, tierId: id.tier, priceId: id.price,
      status: 'active', interval: 'month', amount: '1.00', currency: 'AUD',
      stripeSubscriptionId: 'sub_test', stripeSubscriptionItemId: 'si_test', quantity: 1,
    });

    await syncUrlShortenerQuantity(db, id.owner);
    let row = (await db.select().from(featureSubscriptions).where(eq(featureSubscriptions.id, id.sub)))[0];
    expect(row.quantity).toBe(2); // two active links
    // The Stripe items are reconciled (both links on the one base price) with proration.
    expect(updateSub).toHaveBeenCalledWith('sub_test', {
      items: [{ id: 'si_test', quantity: 2 }],
      proration_behavior: 'create_prorations',
    });

    // Disabling a link lowers the billed quantity.
    await db.update(shortLinks).set({ isActive: false }).where(eq(shortLinks.slug, 'b1'));
    await syncUrlShortenerQuantity(db, id.owner);
    row = (await db.select().from(featureSubscriptions).where(eq(featureSubscriptions.id, id.sub)))[0];
    expect(row.quantity).toBe(1);

    // Disabling the LAST active link cancels the subscription outright — Stripe
    // licensed prices can't be quantity 0 and there's nothing left to bill, so we
    // don't leave a $1/mo subscription running against zero links.
    await db.update(shortLinks).set({ isActive: false }).where(eq(shortLinks.slug, 'a1'));
    await syncUrlShortenerQuantity(db, id.owner);
    row = (await db.select().from(featureSubscriptions).where(eq(featureSubscriptions.id, id.sub)))[0];
    expect(cancelSub).toHaveBeenCalledWith('sub_test', { prorate: true, invoice_now: true });
    expect(row.status).toBe('canceled');
    expect(row.quantity).toBe(0);
  });
});
