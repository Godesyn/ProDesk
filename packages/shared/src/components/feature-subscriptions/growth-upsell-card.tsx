import { ArrowRight } from 'lucide-react';
import { priceLabel as priceLabelFrom, fillCardCopy, type PriceParts } from './card-copy';

export interface UpsellProduct extends PriceParts {
  cardTitle?: string | null;
  cardSubtitle?: string | null;
  cardDescription?: string | null;
  cardButtonLabel?: string | null;
}

/**
 * In-thread upsell card for a Feature Subscription, rendered like a chat message
 * inside the brand AI thread when the brand owner isn't subscribed. Copy is
 * driven by the product (admin-editable), with sensible Growth Strategy defaults.
 * Every copy field (title, subtitle, description, button) supports the `{price}`
 * token, which is substituted with the product's live Feature Subscription price,
 * so the amount shown always tracks the configured price (never hardcoded).
 *
 * `padded` keeps the chat-bubble spacing; pass `false` to drop it when laying the
 * card out in a grid (e.g. the Explore section).
 */
export function GrowthUpsellCard({
  product,
  onSubscribe,
  loading,
  padded = true,
}: {
  product?: UpsellProduct | null;
  onSubscribe: () => void;
  loading?: boolean;
  padded?: boolean;
}) {
  // Live price string, e.g. "$299/mo". Null when no price is configured yet.
  const price = priceLabelFrom(product ?? {});
  const title = fillCardCopy(product?.cardTitle || 'NEW • AI GROWTH STRATEGY', { price });
  const subtitle = fillCardCopy(product?.cardSubtitle || 'Get your growth strategy for {price} with AI', { price });
  const description = fillCardCopy(
    product?.cardDescription ||
      'One clear plan, built from everything in your record and how you compare to businesses like you. The moves that matter, in order.',
    { price },
  );
  const buttonLabel = fillCardCopy(product?.cardButtonLabel || 'Generate my strategy', { price });

  return (
    <div className={padded ? 'px-5 pb-4 pt-2' : undefined}>
      <div className="w-full max-w-full rounded-[20px] bg-ink-100 p-6 text-left sm:w-[420px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-accent">
          {title}
        </p>
        <h3 className="mt-4 text-[26px] font-bold leading-[1.1] tracking-tight text-paper">
          {subtitle}
        </h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-20">
          {description}
        </p>
        <button
          onClick={onSubscribe}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-ink-100 transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {buttonLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
