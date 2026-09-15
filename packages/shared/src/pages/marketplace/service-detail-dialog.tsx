import { useMemo, useState } from 'react';
import { ArrowLeft, Check, ShoppingCart, Zap, CalendarClock, Share2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { SERVICE_TYPE_DISPLAY_NAME, type ServiceType } from '@server/lib/service-type';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { useCurrentUser } from '../../auth/auth-context';
import { useCartOptional } from './cart-store';
import { BookMeetingDialog } from './book-meeting-dialog';
import { priceLine, isWeekly, asMaybePrice } from './pricing';
import { QuantityStepper } from './quantity-stepper';
import { getIntegrationPrompt } from './integration-prompt';
import { DetailMedia, useDetailMediaPanel } from './detail-media';
import type { MarketplaceService, ServiceAddon, ServiceOption, ServiceVariant, SelectedAddon } from './types';

/**
 * Full service detail modal — ports
 * `lib/src/shared/components/service_detail_components/*` into the web
 * design-system, matching the Flutter LAYOUT exactly: a media panel on the
 * LEFT, and the header + description + "WHAT'S INCLUDED" + price box + option
 * dropdowns + add-on tiles all stacked in the RIGHT scrollable panel, with a
 * full-width action bar below.
 *
 * The action bar is gated on the service integration flags like Flutter:
 *   • `onSelectConfiguration`            → "Confirm Configuration"
 *   • `purchasable && allowBuyNow`       → Purchase Now + Add to cart
 *   • `purchasable && allowBookMeeting`  → Book Sales Meeting
 * When opened from the catalog (`isFromCatalog`) the header exposes the
 * "copy integration prompt" action and purchase CTAs are suppressed.
 */
export function ServiceDetailDialog({
  service,
  open,
  onOpenChange,
  onBuyNow,
  purchasable = true,
  isFromCatalog = false,
  onSelectConfiguration,
}: {
  service: MarketplaceService;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Buy a single configured line immediately (skip the cart). */
  onBuyNow?: (line: {
    serviceId: string;
    quantity: number;
    selectedVariantId?: string;
    selectedOptions: Record<string, string>;
    selectedAddons: SelectedAddon[];
  }) => void;
  /** Whether buy/cart/book CTAs may show (false in the catalog preview). */
  purchasable?: boolean;
  /** Opened from the agency catalog — exposes the copy-integration-prompt action. */
  isFromCatalog?: boolean;
  /** Proposal / config flow — replaces the purchase CTAs with "Confirm Configuration". */
  onSelectConfiguration?: (config: {
    selectedVariantId?: string;
    selectedOptions: Record<string, string>;
    selectedAddons: SelectedAddon[];
    quantity: number;
  }) => void;
}) {
  // Optional: the catalog renders this dialog with `purchasable={false}`, so the
  // add-to-cart path is unreachable and no CartProvider wraps the page.
  const cart = useCartOptional();
  const { data: currentUser } = useCurrentUser();
  const options = (service.options ?? []) as ServiceOption[];
  const variants = (service.variants ?? []) as ServiceVariant[];
  const addons = (service.addons ?? []) as ServiceAddon[];

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [bookOpen, setBookOpen] = useState(false);

  // Size the media panel to the cover's aspect ratio (Flutter parity): the
  // media is contained, the panel width tracks the artwork on desktop / its
  // height on mobile, so bezels only appear past the panel's size band.
  const { panelStyle, onAspect } = useDetailMediaPanel({
    imageAspectRatio: service.imageAspectRatio,
    videoUrl: service.videoUrl,
  });

  // Resolve the variant whose option map matches the current selection.
  const selectedVariant = useMemo(() => {
    if (!variants.length) return undefined;
    return variants.find((v) =>
      Object.entries(v.options ?? {}).every(([k, val]) => selectedOptions[k] === val),
    );
  }, [variants, selectedOptions]);
  const selectedVariantId = selectedVariant?.id;

  const selectedAddons: SelectedAddon[] = useMemo(
    () =>
      addons
        .filter((a) => selectedAddonIds.has(a.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          oneOffUpfrontDifference: a.oneOffUpfrontDifference,
          recurringUpfrontDifference: a.recurringUpfrontDifference,
          recurringWeeklyDifference: a.recurringWeeklyDifference,
        })),
    [addons, selectedAddonIds],
  );

  const price = priceLine({ service, quantity, selectedVariantId, selectedAddons });
  const weekly = isWeekly(service);
  const typeLabel = service.type
    ? SERVICE_TYPE_DISPLAY_NAME[service.type as ServiceType] ?? service.type
    : '';

  // The "Options ( +$100 and +$10 / wk )" modifier next to the heading.
  const optionsModifier = useMemo(
    () => signedDelta(diffForFeature(selectedVariant), weekly),
    [selectedVariant, weekly],
  );

  /** All options must be chosen before buy/cart/confirm (Flutter `_validateOptions`). */
  function validateOptions(): boolean {
    for (const opt of options) {
      if (!selectedOptions[opt.name]) {
        toast.error(`Please select an option for "${opt.name}"`);
        return false;
      }
    }
    return true;
  }

  const addToCart = () => {
    if (!cart || !validateOptions()) return;
    cart.add({ service, quantity, selectedVariantId, selectedOptions, selectedAddons });
    onOpenChange(false);
    toast.success('Added to cart');
  };

  const buyNow = () => {
    if (!validateOptions()) return;
    onBuyNow?.({ serviceId: service.id, quantity, selectedVariantId, selectedOptions, selectedAddons });
  };

  const confirmConfiguration = () => {
    if (!validateOptions()) return;
    onSelectConfiguration?.({ selectedVariantId, selectedOptions, selectedAddons, quantity });
    onOpenChange(false);
  };

  const copyIntegrationPrompt = async () => {
    const prompt = getIntegrationPrompt(service.id, currentUser?.id ?? '', service.agencyId);
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('Integration prompt copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const disciplines = (service.disciplines ?? []).filter(Boolean);
  const showBuy = purchasable && !!service.allowBuyNow;
  const showBook = purchasable && !!service.allowBookMeeting;
  const showActions = !!onSelectConfiguration || showBuy || showBook;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="flex h-[85vh] w-[92vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-full flex-col">
          {/* Mobile: the whole media+content stack scrolls as one (so options
              below a tall media stay reachable); desktop keeps the side-by-side
              with only the content column scrolling. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            {/* Left: media panel (image / inline video / placeholder), sized to the
                cover's aspect ratio; the media is contained within it. */}
            <div className="relative aspect-video w-full shrink-0 bg-paper md:aspect-auto md:w-[44%]" style={panelStyle}>
              <DetailMedia imageUrl={service.imageUrl} videoUrl={service.videoUrl} onAspect={onAspect} />
            </div>
            <div className="hidden w-px bg-[color:var(--color-border-hairline)] md:block" />

            {/* Right: content (scrolls independently on desktop). Extra bottom
                padding so the last line (e.g. the price) clears the action bar
                where the mobile scroll meets the footer. */}
            <div className="p-5 pb-7 md:min-h-0 md:flex-1 md:overflow-y-auto md:pb-5">
              {/* Header: back · trailing badges, then the name below. */}
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-60 hover:bg-inset"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                  {isFromCatalog && (
                    <button
                      type="button"
                      onClick={copyIntegrationPrompt}
                      title="Copy service integration prompt"
                      className="inline-flex items-center gap-1 rounded-[6px] border border-[color:var(--color-border-default)] bg-inset px-2 py-1 text-[11px] font-medium text-ink-60 hover:text-ink-100"
                    >
                      <Share2 className="h-3 w-3" /> Copy prompt
                    </button>
                  )}
                  {service.agencyName && (
                    <span className="rounded-[6px] border border-[color:var(--color-border-default)] bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-60">
                      {service.agencyName}
                    </span>
                  )}
                  {typeLabel && (
                    <span className="rounded-[6px] border border-[color:var(--color-border-default)] bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-60">
                      {typeLabel}
                    </span>
                  )}
                </div>
              </div>
              <h2 className="mt-3 text-2xl font-bold leading-tight text-ink-100">{service.name}</h2>

              {service.description && (
                <p className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-60">{service.description}</p>
              )}

              {/* WHAT'S INCLUDED — disciplines with check ticks. */}
              {disciplines.length > 0 && (
                <div className="mt-8">
                  <div className="mb-4 flex items-center gap-2">
                    <span className="h-4 w-[3px] bg-ink-100" />
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[1.2px] text-ink-40">
                      What&apos;s Included
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {disciplines.map((d) => (
                      <li key={d} className="flex items-start gap-3">
                        <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success/15">
                          <Check className="h-2.5 w-2.5 text-success" strokeWidth={3} />
                        </span>
                        <span className="text-sm text-ink-80">{d}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 border-t border-[color:var(--color-border-hairline)]" />
                </div>
              )}

              {/* Price box (weekly headline + setup, or one-off total). */}
              <div className={`${disciplines.length ? 'mt-6' : 'mt-8'} rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-inset/50 p-4`}>
                {weekly ? (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[28px] font-bold leading-none tabular-nums text-ink-100">{asMaybePrice(price.recurringWeekly)}</span>
                      <span className="text-sm text-ink-60">/ week</span>
                    </div>
                    {price.recurringUpfront > 0 && (
                      <p className="mt-1.5 text-[13px] text-ink-40">+ {asMaybePrice(price.recurringUpfront)} upfront</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-ink-40">Total Price</p>
                    <p className="mt-1 text-[28px] font-bold leading-none tabular-nums text-ink-100">{asMaybePrice(price.oneOff)}</p>
                  </>
                )}
              </div>

              {/* Options — dropdown per option, with the selected-variant modifier. */}
              {options.length > 0 && (
                <div className="mt-6">
                  <div className="mb-3 flex items-baseline gap-2">
                    <h3 className="text-lg font-bold text-ink-100">Options</h3>
                    {optionsModifier && <span className="text-base text-ink-40">( {optionsModifier} )</span>}
                  </div>
                  <div className="space-y-3">
                    {options.map((opt) => (
                      <div key={opt.name}>
                        <p className="mb-1.5 text-sm text-ink-60">{opt.name}</p>
                        <select
                          className="h-10 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm text-ink-100"
                          value={selectedOptions[opt.name] ?? ''}
                          onChange={(e) => setSelectedOptions((p) => ({ ...p, [opt.name]: e.target.value }))}
                        >
                          <option value="" disabled>
                            Select an option
                          </option>
                          {(opt.choices ?? []).map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add-ons — selectable tiles with per-item price deltas. */}
              {addons.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-lg font-bold text-ink-100">Add-ons</h3>
                  <div className="space-y-2">
                    {addons.map((a) => {
                      const checked = selectedAddonIds.has(a.id);
                      const delta = signedDelta(diffForFeature(a), weekly) || 'No extra cost';
                      return (
                        <label
                          key={a.id}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm transition-colors ${
                            checked
                              ? 'border-accent bg-accent/10'
                              : 'border-[color:var(--color-border-hairline)] hover:bg-inset'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedAddonIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(a.id)) next.delete(a.id);
                                  else next.add(a.id);
                                  return next;
                                })
                              }
                            />
                            <span className="text-ink-100">{a.name}</span>
                          </span>
                          <span className="shrink-0 text-xs text-ink-60">{delta}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quantity (web convenience; Flutter sets quantity in the cart). */}
              {showActions && (
                <div className="mt-6 flex items-center justify-between">
                  <span className="text-sm text-ink-60">Quantity</span>
                  <QuantityStepper value={quantity} onChange={setQuantity} />
                </div>
              )}
            </div>
          </div>

          {/* Full-width action bar — gated on flags / mode (Flutter bottom bar). */}
          {showActions && (
            <div className="shrink-0 border-t border-[color:var(--color-border-hairline)] bg-inset/30 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                {onSelectConfiguration ? (
                  <Button variant="accent" className="flex-1" onClick={confirmConfiguration}>
                    <Wrench className="mr-1.5 h-4 w-4" /> Confirm Configuration
                  </Button>
                ) : (
                  <>
                    {showBuy && onBuyNow && (
                      <Button variant="accent" className="flex-1" onClick={buyNow}>
                        <Zap className="mr-1.5 h-4 w-4" /> Purchase Now
                      </Button>
                    )}
                    {showBuy && (
                      <Button variant="outline" className="flex-1" onClick={addToCart}>
                        <ShoppingCart className="mr-1.5 h-4 w-4" /> Add to cart
                      </Button>
                    )}
                    {showBook && (
                      <Button variant={showBuy ? 'ghost' : 'accent'} className="flex-1" onClick={() => setBookOpen(true)}>
                        <CalendarClock className="mr-1.5 h-4 w-4" /> Book Sales Meeting
                      </Button>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="mt-3 w-full text-center text-xs text-ink-40 hover:text-ink-60"
              >
                Maybe Later
              </button>
            </div>
          )}
        </div>
      </DialogContent>
      <BookMeetingDialog service={service} open={bookOpen} onOpenChange={setBookOpen} />
    </Dialog>
  );
}

/** Pull the price differences off a variant or add-on (shared shape). */
function diffForFeature(f?: { oneOffUpfrontDifference?: number; recurringUpfrontDifference?: number; recurringWeeklyDifference?: number }) {
  return {
    upfront: (f?.recurringUpfrontDifference ?? 0) + (f?.oneOffUpfrontDifference ?? 0),
    weekly: f?.recurringWeeklyDifference ?? 0,
  };
}

/**
 * Format a price delta the way the Flutter right-content widget does, e.g.
 * `+$100`, `-$50`, or `+$100 and +$10 / wk`. Returns '' when there is no delta.
 */
function signedDelta({ upfront, weekly }: { upfront: number; weekly: number }, isWeeklyService: boolean): string {
  const part = (v: number) => `${v >= 0 ? '+' : '-'}${asMaybePrice(Math.abs(v))}`;
  if (isWeeklyService) {
    const out: string[] = [];
    if (upfront !== 0) out.push(part(upfront));
    if (weekly !== 0) out.push(`${part(weekly)} / wk`);
    return out.join(' and ');
  }
  return upfront !== 0 ? part(upfront) : '';
}
