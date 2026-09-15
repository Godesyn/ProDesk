/**
 * Feature-subscription & billing tools: live catalog/prices, current subscriptions, card on file.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, eq } from 'drizzle-orm';
import { featureSubscriptionPrices, featureSubscriptionProducts, featureSubscriptionTiers } from '../../../db/schema.js';
import { brandOwnerId } from '../../feature-subscriptions/entitlements.js';
import { listOwnerFeatureSubscriptions, productFeatureKeys } from '../../feature-subscriptions/queries.js';
import { obj, getOwnerCardOnFile, FEATURE_GUIDE } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function billingTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId } = ctx;
  return [
    {
      def: {
        name: 'list_feature_subscriptions',
        description: [
          "List THIS brand's feature subscriptions (the paid tool add-ons billed to the brand owner) AND the catalog of available features with live pricing. Takes no arguments. Use this whenever the user asks what they are subscribed to, what something costs, what a subscription covers, or before proposing any PAID action.",
          'Returns { subscriptions, available }:',
          '- subscriptions: the owner\'s existing subscriptions, each { productName, features (array of feature-key strings), status ("active"|"trialing"|"canceled"|…), active (boolean), perUnit (boolean — billed per unit rather than flat), unitAmount (NUMBER dollars per unit/month), quantity (INTEGER units currently billed; 1 for flat), monthlyTotal (NUMBER dollars = unitAmount × quantity), currency, renewsAt (ISO or null), cancelAtPeriodEnd (boolean — true means it ends at renewsAt instead of renewing).',
          '- available: the feature catalog, each { featureKey, productName, app (which Prodesk app it belongs to), guards (what it unlocks, in plain words), billedAction (what exactly is billed), unitAmount (NUMBER dollars/month, live price), perUnit (boolean), currency, subscribed (boolean — whether this brand already has it) }.',
          'Money fields here are NUMBERS in dollars (e.g. 8 = $8.00/month). Quote prices from this tool — never from memory, since admins can change them.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const ownerId = await brandOwnerId(db, brandId);
        // Shared query core (also backs tRPC featureSubscriptions.myForBrand).
        const subRows = ownerId ? await listOwnerFeatureSubscriptions(db, ownerId, { limit: 50 }) : [];
        const isActiveStatus = (s: string) => s === 'active' || s === 'trialing';
        const subscriptions = subRows.map((s) => ({
          productName: s.productName,
          features: productFeatureKeys({ featureKey: s.productFeatureKey, featureKeys: s.productFeatureKeys }),
          status: s.status,
          active: isActiveStatus(s.status),
          perUnit: s.productPerUnit,
          unitAmount: Number(s.amount),
          quantity: s.quantity ?? 1,
          monthlyTotal: Number(s.amount) * (s.quantity ?? 1),
          currency: s.currency,
          renewsAt: s.currentPeriodEnd ? s.currentPeriodEnd.toISOString() : null,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        }));

        // Catalog: every ACTIVE product with its cheapest active monthly price
        // (live, so admin price changes are always reflected). What each feature
        // guards comes from the static FEATURE_GUIDE by featureKey.
        const productRows = await db
          .select({
            id: featureSubscriptionProducts.id,
            name: featureSubscriptionProducts.name,
            featureKey: featureSubscriptionProducts.featureKey,
            featureKeys: featureSubscriptionProducts.featureKeys,
            perUnit: featureSubscriptionProducts.perUnit,
            amount: featureSubscriptionPrices.amount,
            currency: featureSubscriptionPrices.currency,
          })
          .from(featureSubscriptionProducts)
          .innerJoin(featureSubscriptionTiers, and(
            eq(featureSubscriptionTiers.productId, featureSubscriptionProducts.id),
            eq(featureSubscriptionTiers.active, true),
          ))
          .innerJoin(featureSubscriptionPrices, and(
            eq(featureSubscriptionPrices.tierId, featureSubscriptionTiers.id),
            eq(featureSubscriptionPrices.active, true),
            eq(featureSubscriptionPrices.interval, 'month'),
          ))
          .where(eq(featureSubscriptionProducts.active, true));
        const activeFeatureSet = new Set(subscriptions.filter((s) => s.active).flatMap((s) => s.features));
        const seenProducts = new Set<string>();
        const available: unknown[] = [];
        for (const p of productRows) {
          if (seenProducts.has(p.id)) continue; // keep the first (cheapest-tier order not guaranteed; one price per product is the norm)
          seenProducts.add(p.id);
          const guide = FEATURE_GUIDE[p.featureKey];
          available.push({
            featureKey: p.featureKey,
            productName: p.name,
            app: guide?.app ?? null,
            guards: guide?.guards ?? 'A Prodesk feature add-on.',
            billedAction: guide?.billedAction ?? (p.perUnit ? 'Billed per unit per month.' : 'A flat monthly subscription.'),
            unitAmount: Number(p.amount),
            perUnit: p.perUnit,
            currency: p.currency,
            subscribed: productFeatureKeys({ featureKey: p.featureKey, featureKeys: p.featureKeys }).some((k) => activeFeatureSet.has(k)),
          });
        }
        return { subscriptions, available };
      },
    },
    {
      def: {
        name: 'get_billing_summary',
        description: [
          "Get THIS brand's billing status: the saved card that subscription charges go to, and the current monthly feature-subscription spend. Takes no arguments. ALWAYS call this before proposing a PAID action (activating a short link, adding a signature member, subscribing to a feature) so you can tell the user exactly which card will be charged — or that no card is on file.",
          'Returns an object:',
          '- cardOnFile: { brand (e.g. "visa"), last4, expMonth, expYear } — the brand owner\'s default card, used for ALL feature-subscription charges — or null when no card is saved (a paid action would then go through Stripe Checkout to collect one).',
          '- activeSubscriptions: INTEGER count of active feature subscriptions.',
          '- monthlyTotal: NUMBER — current total feature-subscription spend in dollars per month.',
          '- currency: the billing currency (e.g. "AUD").',
          'Payment details beyond this (changing the card, invoices) live on each app\'s Billing page — direct the user there for changes.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const ownerId = await brandOwnerId(db, brandId);
        // Same shared subscriptions core as list_feature_subscriptions (active only),
        // so the summary and the detailed list can never disagree.
        const [card, subRows] = await Promise.all([
          getOwnerCardOnFile(db, brandId),
          ownerId ? listOwnerFeatureSubscriptions(db, ownerId, { activeOnly: true }) : Promise.resolve([]),
        ]);
        const monthlyTotal = subRows.reduce((sum, s) => sum + Number(s.amount) * (s.quantity ?? 1), 0);
        return {
          cardOnFile: card,
          activeSubscriptions: subRows.length,
          monthlyTotal,
          currency: subRows[0]?.currency ?? 'AUD',
        };
      },
    },
  ];
}
