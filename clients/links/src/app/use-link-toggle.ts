/* Enabling a link is the billing gate. Creating links is free and unlimited, but
 * switching one ON requires a short-link subscription. The rate depends on the
 * KIND: a plain link bills at the per-link rate, a CAMPAIGN (a scheduled link) at
 * its own higher rate — so every quote here is derived from `kind`, never assumed.
 * When the owner isn't entitled yet, we start Stripe checkout instead of toggling;
 * once subscribed they can enable. Turning a link OFF is always free.
 *
 * Every enable goes through an explicit price-disclosure confirm ("this adds
 * $X/month, charged to your saved card") so nobody is billed without seeing the
 * amount first — the server backstop rejects unsubscribed enables regardless.
 *
 * Shared by LinksHome and LinkDetail so the gate behaves identically wherever the
 * active toggle appears. */
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useToast } from './toast';
import { useConfirm } from './confirm';
import { useLinksInvalidate } from './use-invalidate';
import { money, type Entitlement } from './lib';

export function useLinkToggle(
  brandId: string,
  entitlement: Entitlement | undefined,
) {
  const trpc = useTRPC();
  const toast = useToast();
  const confirm = useConfirm();

  const toggle = useMutation(trpc.shortLinks.toggleActive.mutationOptions());
  const checkout = useMutation(
    trpc.featureSubscriptions.checkout.mutationOptions(),
  );

  // A toggle can be either kind, and campaigns are the same rows under a
  // different lens, so refresh both sides rather than guessing from `kind`.
  const { afterLinkChange, afterCampaignChange } = useLinksInvalidate();
  const invalidate = () => {
    afterLinkChange();
    afterCampaignChange();
  };

  async function setActive(
    id: string,
    next: boolean,
    kind: 'link' | 'campaign' = 'link',
  ) {
    const isCampaign = kind === 'campaign';
    const noun = isCampaign ? 'campaign' : 'link';
    // The unit rate + the price to check out against both depend on the kind.
    const unitAmount = isCampaign
      ? entitlement?.newCampaignAmount
      : entitlement?.newLinkAmount;
    const priceId = isCampaign
      ? entitlement?.campaignPriceId
      : entitlement?.priceId;

    // Enabling costs money — say exactly how much before anything is charged.
    // Disabling is free and immediate; beta-exempt owners are never billed, so
    // no charge warning for them either.
    if (next && entitlement && !entitlement.betaExempt) {
      const rate = money(unitAmount ?? 0, entitlement.currency);
      const ok = await confirm({
        title: `Switch this ${noun} on?`,
        description: entitlement.entitled
          ? `Active ${noun}s are billed monthly: switching this one on adds ${rate}/month to your Links subscription (new total ${money(entitlement.monthlyTotal + (unitAmount ?? 0), entitlement.currency)}/month, charged to your saved card). Switching it off later removes the charge.`
          : `Active ${noun}s are billed at ${rate}/month each, starting with this one. You'll be taken to secure checkout to start the subscription — the ${noun} goes live as soon as payment completes.`,
        confirmLabel: entitlement.entitled
          ? `Switch on · ${rate}/mo`
          : `Subscribe · ${rate}/mo per ${noun}`,
      });
      if (!ok) return;
    }

    if (!next) {
      const ok = await confirm({
        title: `Park this ${noun}?`,
        description: `Disabling this ${noun} will stop redirects and park it for 30 days. After 30 days of inactivity, the ${noun} will be permanently deleted and its short URL released for reuse.`,
        confirmLabel: 'Park link (30 days)',
        destructive: true,
      });
      if (!ok) return;
    }

    // Turning a link ON while unsubscribed → send to checkout first. Once they
    // return subscribed (?sub=success), they enable the link with another click.
    if (next && entitlement && !entitlement.entitled) {
      if (!priceId) {
        toast(`${isCampaign ? 'Campaigns' : 'Short links'} are not available to subscribe to yet.`);
        return;
      }
      try {
        const base = window.location.origin + window.location.pathname;
        const res = await checkout.mutateAsync({
          brandId,
          // The campaign tier's price when enabling a campaign — otherwise the
          // first campaign a brand switches on would start a $1/link subscription.
          priceId,
          // The webhook activates this exact link the moment the subscription lands
          // (recordFeatureSubscription), so it goes live even if the browser return
          // lags or never happens. The ?sub=success handler just refreshes the UI.
          pendingEnableLinkId: id,
          successUrl: base + '?sub=success',
          cancelUrl: base + '?sub=cancel',
        });
        if (res.url) {
          window.location.href = res.url;
          return;
        }
        // Card on file charged (or dev fallback): the subscription is active now.
        // The on-file path also flips this link active server-side via
        // pendingEnableLinkId, so refresh and stop here.
        invalidate();
        if (res.status === 'active') {
          toast(`Subscribed — ${noun} is live now.`);
          return;
        }
      } catch (e) {
        toast('Error: ' + (e instanceof Error ? e.message : 'checkout failed'));
        return;
      }
    }
    toggle.mutate(
      { id, isActive: next },
      {
        onSuccess: (_d, v) => {
          invalidate();
          toast(v.isActive ? 'Switched on. Live now.' : 'Switched off.');
        },
        onError: (e) => toast('Error: ' + e.message),
      },
    );
  }

  return { setActive, pending: toggle.isPending || checkout.isPending };
}
