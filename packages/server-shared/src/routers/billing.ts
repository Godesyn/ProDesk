import { z } from 'zod';
import { and, eq, inArray, isNull, desc } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { purchases, purchaseItems, brands, projects, agencies } from '../db/schema.js';
import { assertBrandViewAccess } from '../trpc/permissions.js';
import { hasDeliverableCycle, type ServiceType } from '../lib/service-type.js';

/**
 * BILLING — a brand's payment dashboard. Derives a forward-looking payment
 * schedule from the brand's purchases (upfront charge + the weekly recurring
 * cadence of any subscription) and rolls it up into the stat cards the Flutter
 * brand_billing_screen.dart shows. Read-only; the actual charging happens in the
 * Stripe webhook + payout pipeline.
 */

type RecordStatus = 'paid' | 'upcoming' | 'pending' | 'failed';

export interface PaymentRecord {
  id: string;
  purchaseId: string;
  date: string; // ISO
  description: string;
  amount: number;
  cycle: number; // 1 = upfront, 2..N = weekly instalments
  status: RecordStatus;
  recurring: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HORIZON_WEEKS = 52; // how far ahead to project a live subscription

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0);

/** Approximate days per deliverable_frequency step (Flutter DeliverableFrequency). */
const FREQ_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };

/**
 * The earliest date a subscription can be cancelled, given a minimum term of
 * `minTerm` billing cycles (CancelSubscriptionDialog.getMinimumCancellationDate).
 * Returns null when there is no future-dated minimum term to enforce.
 */
function minimumCancellationDate(
  createdAt: Date | null,
  freq: string | null,
  repeatsEvery: number | null,
  minTerm: number,
): Date | null {
  if (!createdAt || !freq || minTerm <= 0) return null;
  const stepDays = (FREQ_DAYS[freq] ?? 7) * (repeatsEvery && repeatsEvery > 0 ? repeatsEvery : 1) * minTerm;
  const date = new Date(createdAt.getTime() + stepDays * 24 * 60 * 60 * 1000);
  return date.getTime() > Date.now() ? date : null;
}

export const billingRouter = router({
  /**
   * Full billing summary for one brand: stat cards + the split past / upcoming
   * payment lists. Accessible to the brand (owner/staff), a CONNECTED agency
   * (owner/staff — the Flutter `/payments/:brandId` agency view), and admins.
   */
  brandSummary: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const access = await assertBrandViewAccess(ctx, input.brandId);
      // An agency viewer only sees the brand's purchases that involve its own
      // agency (Flutter watchBrandPurchases(brandId, agencyId)); the brand itself
      // sees everything, with an optional per-agency filter.
      const scopeAgencyId = access.viaAgencyId ?? input.agencyId ?? null;

      const brand = (
        await ctx.db
          .select({ id: brands.id, businessName: brands.businessName, logoUrl: brands.logoUrl })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1)
      )[0];

      const purchaseRows = await ctx.db
        .select()
        .from(purchases)
        // Exclude internal purchases: the brand is never charged for internal/
        // complimentary work (zero commissions, agency pays the contractor), so it
        // must not appear in the brand's payment schedule. Production read the
        // separate `purchase_history` collection, which excluded internal inherently.
        .where(and(eq(purchases.brandId, input.brandId), eq(purchases.viewableToBrand, true), eq(purchases.isInternal, false)))
        .orderBy(desc(purchases.createdAt));

      const ids = purchaseRows.map((p) => p.id);
      const items = ids.length ? await ctx.db.select().from(purchaseItems).where(inArray(purchaseItems.purchaseId, ids)) : [];
      const itemsByPurchase = new Map<string, typeof items>();
      for (const it of items) {
        if (!itemsByPurchase.has(it.purchaseId)) itemsByPurchase.set(it.purchaseId, []);
        itemsByPurchase.get(it.purchaseId)!.push(it);
      }
      const describe = (purchaseId: string, fallback: string) => {
        const names = (itemsByPurchase.get(purchaseId) ?? []).map((i) => i.serviceName).filter(Boolean) as string[];
        return names.length ? names.join(', ') : fallback;
      };

      // Scope to the viewing agency's own purchases (an item it fulfils or a
      // proposal it sent). The brand / super-admin path keeps every purchase.
      const scopedPurchases = scopeAgencyId
        ? purchaseRows.filter(
            (p) =>
              p.proposalSentByAgencyId === scopeAgencyId ||
              (itemsByPurchase.get(p.id) ?? []).some((it) => it.agencyId === scopeAgencyId),
          )
        : purchaseRows;

      const now = new Date();
      const records: PaymentRecord[] = [];
      let activeSubscriptions = 0;

      for (const p of scopedPurchases) {
        const amount = (p.amount ?? {}) as Record<string, unknown>;
        const dueToday = num(amount.dueToday) || num(p.totalAmount);
        const weekly = num(amount.weekly);
        const anchor = p.paidAt ?? p.completedAt ?? p.createdAt ?? now;
        const isPaid = p.status === 'paid' || p.status === 'completed';
        const isFailed = p.status === 'failed';
        const desc = describe(p.id, (amount.planLabel as string) || 'Purchase');

        // Cycle 1 — the upfront charge.
        records.push({
          id: `${p.id}:1`,
          purchaseId: p.id,
          date: new Date(anchor).toISOString(),
          description: desc,
          amount: dueToday,
          cycle: 1,
          status: isPaid ? 'paid' : isFailed ? 'failed' : 'pending',
          recurring: false,
        });

        // Weekly recurring schedule. A purchase can mix an ongoing subscription
        // (recurring.weeklyAfter — billed forever) with a one-off bought on a
        // payment plan (oneOff.weeklyAfter — billed only for numberOfWeeks). The
        // projected weekly therefore has to STEP DOWN as each finite instalment
        // stream ends: e.g. a $10/wk plan (10 wks) + $20/wk subscription is
        // $30/wk for weeks 1-10, then $20/wk thereafter — NOT a flat $30 forever.
        // Both streams come from the per-item `amount` snapshots, which are the
        // source of truth for what Stripe actually charges.
        if (isPaid) {
          const lineItems = itemsByPurchase.get(p.id) ?? [];
          // A proposal phase start delay defers ONLY the forever weekly retainer
          // (it activates when the phase begins — see subscription.ts); the phase's
          // one-time money and any one-off instalment plan are still charged at
          // checkout. So each forever-weekly stream carries the week it starts
          // contributing, while instalments always run from week 1.
          const retainers: { weekly: number; startWeek: number }[] = [];
          const instalments: { weekly: number; weeks: number }[] = [];
          for (const it of lineItems) {
            const a = (it.amount ?? {}) as {
              recurring?: { weeklyAfter?: number };
              oneOff?: { weeklyAfter?: number; numberOfWeeks?: number };
            };
            const fw = num(a.recurring?.weeklyAfter);
            if (fw > 0) retainers.push({ weekly: fw, startWeek: Math.round(num(it.startDelayDays) / 7) });
            const instWeekly = num(a.oneOff?.weeklyAfter);
            const instWeeks = num(a.oneOff?.numberOfWeeks);
            if (instWeekly > 0 && instWeeks > 0) instalments.push({ weekly: instWeekly, weeks: instWeeks });
          }
          // Legacy purchases without per-item snapshots: treat the stored flat
          // weekly as an ongoing subscription (preserves the old behaviour).
          if (lineItems.length === 0 && weekly > 0) retainers.push({ weekly, startWeek: 0 });

          const hasRetainer = retainers.length > 0;
          if (hasRetainer || instalments.length > 0) {
            activeSubscriptions += 1;
            const maxInstWeeks = instalments.reduce((m, i) => Math.max(m, i.weeks), 0);
            // Ongoing subscriptions project to the horizon; a plan-only purchase
            // stops once its last instalment is paid.
            const lastWeek = hasRetainer ? HORIZON_WEEKS : maxInstWeeks;
            const start = new Date(anchor).getTime();
            for (let k = 1; k <= lastWeek; k++) {
              const amountThisWeek =
                retainers.reduce((s, r) => s + (k >= r.startWeek ? r.weekly : 0), 0) +
                instalments.reduce((s, i) => s + (k <= i.weeks ? i.weekly : 0), 0);
              if (amountThisWeek <= 0) continue; // nothing billed this week (e.g. a phase hasn't started)
              const cycle = k + 1; // cycle 1 was the upfront charge above
              const when = new Date(start + k * WEEK_MS);
              const past = when.getTime() <= now.getTime();
              records.push({
                id: `${p.id}:${cycle}`,
                purchaseId: p.id,
                date: when.toISOString(),
                description: desc,
                amount: amountThisWeek,
                cycle,
                status: past ? 'paid' : 'upcoming',
                recurring: true,
              });
            }
          }
        }
      }

      const past = records
        .filter((r) => r.status === 'paid' || r.status === 'failed')
        .sort((a, b) => +new Date(b.date) - +new Date(a.date));
      const upcoming = records
        .filter((r) => r.status === 'upcoming' || r.status === 'pending')
        .sort((a, b) => +new Date(a.date) - +new Date(b.date));

      // Stat-card windows.
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      const inMonth = (d: Date, monthOffset: number) => {
        const target = new Date(thisYear, thisMonth + monthOffset, 1);
        return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth();
      };

      const sum = (rs: PaymentRecord[]) => rs.reduce((t, r) => t + r.amount, 0);
      const stats = {
        totalPaid: sum(past.filter((r) => r.status === 'paid')),
        upcomingThisMonth: sum(upcoming.filter((r) => inMonth(new Date(r.date), 0))),
        upcomingNextMonth: sum(upcoming.filter((r) => inMonth(new Date(r.date), 1))),
        upcomingThisYear: sum(upcoming.filter((r) => new Date(r.date).getFullYear() === thisYear)),
        activeSubscriptions,
        currency: 'AUD' as const,
      };

      return { brand: brand ?? null, stats, past, upcoming };
    }),

  /**
   * Recurring subscriptions for one brand (ports brand_subscriptions_screen.dart
   * + agency_subscriptions_screen.dart). A subscription is any non-deleted
   * project with a weekly recurring fee or a deliverable cadence.
   *
   * Access mirrors `brandSummary`: the brand sees EVERY connected agency's
   * subscriptions; a connected agency sees only the ones it fulfils for this
   * brand (Flutter watchBrandProjects(brandId, agencyId)). Each row carries the
   * weekly amount and the minimum-term cancellation date the cancel dialog needs.
   */
  brandSubscriptions: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const access = await assertBrandViewAccess(ctx, input.brandId);

      // An agency viewer is locked to its own projects (ignore any supplied
      // agencyId); the brand sees them all, with an optional per-agency filter.
      const scopeAgencyId = access.viaAgencyId ?? input.agencyId ?? null;

      const filters = [eq(projects.brandId, input.brandId), isNull(projects.deletedAt)];
      if (scopeAgencyId) filters.push(eq(projects.agencyId, scopeAgencyId));
      else filters.push(eq(projects.viewableToBrand, true));

      const rows = await ctx.db
        .select()
        .from(projects)
        .where(and(...filters))
        .orderBy(desc(projects.createdAt));

      const agencyIds = [...new Set(rows.map((r) => r.agencyId).filter(Boolean))] as string[];
      const agencyRows = agencyIds.length
        ? await ctx.db.select({ id: agencies.id, businessName: agencies.businessName, logoUrl: agencies.logoUrl }).from(agencies).where(inArray(agencies.id, agencyIds))
        : [];
      const agencyById = new Map(agencyRows.map((a) => [a.id, a]));

      const subscriptions = rows
        .map((p) => {
          const amt = (p.amount ?? {}) as { recurring?: { weeklyAfter?: number }; oneOff?: { weeklyAfter?: number } };
          const weekly = num(amt.recurring?.weeklyAfter) || num(amt.oneOff?.weeklyAfter) || num(p.recurringDeliveryFee);
          return { p, weekly };
        })
        .filter(({ p, weekly }) => weekly > 0 || !!p.deliverableFrequency)
        .map(({ p, weekly }) => {
          const cfg = (p.recurringProjectConfig ?? {}) as { minimumTermBeforeCancellation?: number };
          const minTerm = num(cfg.minimumTermBeforeCancellation);
          // A one-off whose weekly figure comes from `oneOff.weeklyAfter` is a
          // one-off being paid down via a weekly payment plan (not a recurring
          // service). Those are surfaced here but can't be cancelled — the agreed
          // instalments must run to completion.
          const amt = (p.amount ?? {}) as { oneOff?: { weeklyAfter?: number } };
          const paymentPlan = num(amt.oneOff?.weeklyAfter) > 0;
          const cancelAfter = minimumCancellationDate(p.createdAt ?? null, p.deliverableFrequency, p.repeatsEvery, minTerm);
          const agency = p.agencyId ? agencyById.get(p.agencyId) : undefined;
          return {
            id: p.id,
            title: p.title,
            serviceName: p.serviceName,
            status: p.status,
            agencyId: p.agencyId,
            agencyName: agency?.businessName ?? null,
            agencyLogoUrl: agency?.logoUrl ?? null,
            weeklyAmount: weekly,
            deliverableFrequency: p.deliverableFrequency,
            repeatsEvery: p.repeatsEvery,
            cycleCount: p.cycleCount ?? 0,
            nextCycleAt: p.nextCycleAt ? p.nextCycleAt.toISOString() : null,
            createdAt: p.createdAt ? p.createdAt.toISOString() : null,
            cancelledAt: p.cancelledAt ? p.cancelledAt.toISOString() : null,
            minimumTermBeforeCancellation: minTerm || null,
            minimumCancellationDate: cancelAfter ? cancelAfter.toISOString() : null,
            // Only Recurring Service / Recurring Product (Ships) subscriptions are
            // cancellable (see projects.cancelSubscription); everything else here
            // (e.g. a payment-plan one-off surfaced via its instalment weekly) is
            // not. The UI hides the cancel control when false.
            cancellable: hasDeliverableCycle(p.serviceType as ServiceType | null),
            paymentPlan,
          };
        });

      const active = subscriptions.filter((s) => !s.cancelledAt);
      return {
        subscriptions,
        totalWeekly: active.reduce((t, s) => t + s.weeklyAmount, 0),
        activeCount: active.length,
        currency: 'AUD' as const,
      };
    }),
});
