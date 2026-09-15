import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '../../lib/trpc';
import { redirectorHost } from '../../lib/origins';
import { useActiveContext } from '../../hooks/use-active-context';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '../../components/ui/dialog';
import { Tooltip } from '../../components/ui/tooltip';
import { Popover } from '../../components/ui/popover';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { formatPrice } from '../../lib/utils';
import QRCodeStyling from 'qr-code-styling';
import { HexColorPicker } from 'react-colorful';
import { toast } from 'sonner';
import {
  Link2,
  Copy,
  Check,
  QrCode,
  Trash2,
  ExternalLink,
  Search,
  Plus,
  MousePointerClick,
  MoreVertical,
  Edit2,
  Share2,
  Download,
  ImageDown,
  Mail,
  Twitter,
  Facebook,
  Linkedin,
  MessageCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

// ─────────────────────────────────────────────────────────────────────────────
// QR HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const SHORT_LINK_BASE_NO_PROTOCOL = redirectorHost();
export const SHORT_LINK_BASE = `https://${SHORT_LINK_BASE_NO_PROTOCOL}`;

type QrConfig = {
  foregroundColor?: string;
  backgroundColor?: string;
  dotStyle?: string;
  cornerStyle?: string;
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isHex = (v: string) => HEX_RE.test(v);

/** Build the qr-code-styling options object from a saved/in-progress config. */
function buildQrOptions(
  slug: string,
  config: QrConfig | undefined,
  size: number,
) {
  const fg =
    config?.foregroundColor && isHex(config.foregroundColor)
      ? config.foregroundColor
      : '#000000';
  const bg =
    config?.backgroundColor && isHex(config.backgroundColor)
      ? config.backgroundColor
      : '#ffffff';
  return {
    width: size,
    height: size,
    type: 'svg' as const,
    data: `${SHORT_LINK_BASE}/${slug}`,
    margin: Math.max(2, Math.round(size * 0.04)),
    qrOptions: { errorCorrectionLevel: 'H' as const },
    dotsOptions: { color: fg, type: (config?.dotStyle || 'square') as any },
    cornersSquareOptions: {
      color: fg,
      type: (config?.cornerStyle || 'square') as any,
    },
    backgroundOptions: { color: bg },
  };
}

/**
 * Renders a QR code via qr-code-styling. The instance is created (and painted)
 * once on mount with the full option set, then `update()`d on subsequent option
 * changes — this is what guarantees the code is visible the moment the view
 * mounts, instead of staying blank until the first edit.
 */
function QRView({
  options,
  instanceRef,
  className,
}: {
  options: ReturnType<typeof buildQrOptions>;
  instanceRef?: React.MutableRefObject<QRCodeStyling | null>;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const obj = new QRCodeStyling(options);
    obj.append(containerRef.current);
    if (instanceRef) instanceRef.current = obj;
    return () => {
      if (instanceRef) instanceRef.current = null;
    };
    // Created once on mount; live edits are handled by the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    instanceRef?.current?.update(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  return <div ref={containerRef} className={className} />;
}

/** Small live QR preview used as the list thumbnail, reflecting the saved design. */
function QRThumbnail({ link }: { link: any }) {
  const instanceRef = useRef<QRCodeStyling | null>(null);
  const options = useMemo(
    () => buildQrOptions(link.slug, link.qrConfig, 64),
    [link.slug, link.qrConfig],
  );
  return (
    <QRView
      options={options}
      instanceRef={instanceRef}
      className="h-16 w-16 [&>svg]:h-full [&>svg]:w-full"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export function LinksPage() {
  const { brandId } = useActiveContext();
  const trpc = useTRPC();
  const [search, setSearch] = useState('');

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editLink, setEditLink] = useState<any>(null); // To edit
  const [qrModalLink, setQrModalLink] = useState<any>(null);

  const qc = useQueryClient();

  const {
    data: links,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.shortLinks.list.queryOptions({
      brandId: brandId as string,
      search,
    }),
    enabled: !!brandId,
    // shortLinks.list is paginated ({ items, nextCursor }); this page shows the
    // first page, so unwrap to the items array it already renders.
    select: (page) => page.items,
  });

  const toggleActiveMutation = useMutation({
    ...trpc.shortLinks.toggleActive.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() });
      qc.invalidateQueries({
        queryKey: trpc.shortLinks.entitlement.queryKey(),
      });
    },
  });

  // Billing: short links are $1 per active link / month (owner-scoped); beta
  // users get them free. `entitled` is true when beta OR an active subscription
  // is held. Creating links is free and unlimited — the gate is on ENABLING a
  // link: when NOT entitled, switching one on starts checkout first.
  const { data: ent } = useQuery({
    ...trpc.shortLinks.entitlement.queryOptions({ brandId: brandId as string }),
    enabled: !!brandId,
  });
  const locked = !!ent && !ent.entitled;

  const startCheckout = useMutation({
    ...trpc.featureSubscriptions.checkout.mutationOptions(),
    onSuccess: (res) => {
      if (res.url) {
        window.location.href = res.url; // hosted Stripe Checkout
        return;
      }
      // Dev fallback (no Stripe key) — subscription activated directly.
      qc.invalidateQueries({ queryKey: trpc.shortLinks.entitlement.queryKey() });
      toast.success('Subscription active — you can now enable links.');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not start checkout'),
  });

  /** Create is always free — open the modal directly. */
  const handleCreateClick = () => setCreateModalOpen(true);

  /** Start checkout for the short-link subscription (no Stripe price → toast).
   * `pendingEnableLinkId` is the link being enabled: the webhook activates it the
   * moment the subscription lands, so it goes live without a second click. */
  const startSubscribe = (pendingEnableLinkId?: string) => {
    if (!ent?.priceId) {
      toast.error('Short links are not available to subscribe to yet.');
      return;
    }
    startCheckout.mutate({
      brandId: brandId as string,
      priceId: ent.priceId,
      pendingEnableLinkId,
      successUrl: `${window.location.origin}/links?sub=success`,
      cancelUrl: `${window.location.origin}/links?sub=cancel`,
    });
  };

  /** Enabling a link is the billing gate: free to create, but switching one ON
   * requires a subscription. Start checkout when locked; otherwise toggle. */
  const handleToggleActive = (link: { id: string; isActive: boolean }) => {
    if (!link.isActive && locked) {
      startSubscribe(link.id);
      return;
    }
    toggleActiveMutation.mutate({ id: link.id, isActive: !link.isActive });
  };

  // Returning from Stripe Checkout: the webhook has (or shortly will have)
  // activated the pending link server-side, so refresh the list too — not just
  // entitlement — and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sub = params.get('sub');
    if (sub === 'success') {
      qc.invalidateQueries({ queryKey: trpc.shortLinks.entitlement.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() });
      toast.success('Subscription active — your link is going live.');
    } else if (sub === 'cancel') {
      toast.info('Checkout canceled.');
    }
    if (sub) window.history.replaceState({}, '', '/links');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!brandId) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display-sm text-ink-100">Links & QR</h1>
          <p className="mt-1 text-ui-md text-ink-60">
            Manage short links and branded QR codes.
          </p>
        </div>
        <Button onClick={handleCreateClick}>
          <Plus className="mr-2 h-4 w-4" />
          Create Link
        </Button>
      </div>

      {/* BILLING BANNER */}
      {ent && (ent.betaExempt ? (
        <Card className="border-dashed bg-paper px-4 py-3 text-ui-sm text-ink-60">
          Short links are <span className="font-medium text-ink-100">included with your beta access</span> — create and enable as many as you like.
        </Card>
      ) : locked ? (
        <Card className="flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-ui-sm text-ink-60">
            Creating links is free. Switching one on is{' '}
            <span className="font-medium text-ink-100">
              {formatPrice(ent.unitAmount, ent.currency)} per active link / month
            </span>
            . Subscribe to enable your links.
          </p>
          <Button size="sm" onClick={() => startSubscribe()} disabled={startCheckout.isPending}>
            {startCheckout.isPending ? 'Starting…' : 'Subscribe'}
          </Button>
        </Card>
      ) : (
        <Card className="bg-paper px-4 py-3 text-ui-sm text-ink-60">
          Billed at{' '}
          <span className="font-medium text-ink-100">
            {formatPrice(ent.unitAmount, ent.currency)} per active link / month
          </span>{' '}
          · {ent.activeCount} active ·{' '}
          <span className="font-medium text-ink-100">
            {formatPrice((ent.unitAmount ?? 1) * Math.max(1, ent.activeCount), ent.currency)}/mo
          </span>
        </Card>
      ))}

      {/* TOOLBAR */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input
            placeholder="Search links..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* LINK LIST */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-24 animate-pulse bg-paper" />
          ))}
        </div>
      ) : links?.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <Link2 className="h-12 w-12 text-ink-20 mb-4" />
          <h3 className="text-ui-lg font-semibold text-ink-100">
            No links found
          </h3>
          <p className="mt-1 text-ui-sm text-ink-60 max-w-sm mx-auto">
            {search
              ? 'Try adjusting your search query.'
              : 'Create your first short link to get started sharing your brand.'}
          </p>
          {!search && (
            <Button
              variant="outline"
              className="mt-6"
              onClick={handleCreateClick}
              disabled={startCheckout.isPending}
            >
              Create your first link
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {links?.map((link: any) => (
            <Card
              key={link.id}
              className={`flex items-center gap-6 p-5 transition-colors hover:border-ink-20 ${!link.isActive ? 'opacity-50 grayscale' : ''}`}
            >
              {/* Left: QR Thumbnail (clickable) — live preview of the saved design */}
              <Tooltip label="View & customize QR">
                <button
                  onClick={() => setQrModalLink(link)}
                  className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white transition-colors hover:border-accent"
                >
                  <QRThumbnail link={link} />
                  <span className="absolute inset-0 flex items-center justify-center bg-ink-100/0 opacity-0 transition-all group-hover:bg-ink-100/60 group-hover:opacity-100">
                    <QrCode className="h-5 w-5 text-paper" />
                  </span>
                </button>
              </Tooltip>

              {/* Middle: Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-ink-100 truncate">
                    {link.nickname}
                  </h3>
                  {!link.isActive && (
                    <span className="rounded-full bg-ink-20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-60">
                      Inactive
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-ui-sm">
                  <a
                    href={`${SHORT_LINK_BASE}/${link.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent hover:underline flex items-center gap-1"
                  >
                    {SHORT_LINK_BASE_NO_PROTOCOL}/{link.slug}
                  </a>
                  <CopyButton text={`${SHORT_LINK_BASE}/${link.slug}`} />
                </div>

                <div className="mt-1 flex items-center gap-1.5 text-ui-xs text-ink-40 truncate">
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{link.destinationUrl}</span>
                </div>
              </div>

              {/* Right: Stats & Actions */}
              <div className="flex items-center gap-6">
                <Tooltip label="Total clicks">
                  <div className="flex flex-col items-end text-right">
                    <span className="flex items-center gap-1 text-ui-md font-semibold text-ink-100">
                      <MousePointerClick className="h-4 w-4 text-ink-40" />
                      {link.clickCount.toLocaleString()}
                    </span>
                    <span className="text-ui-xs text-ink-40">clicks</span>
                  </div>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mr-2 text-ink-40 hover:text-ink-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditLink(link);
                        setCreateModalOpen(true);
                      }}
                    >
                      <Edit2 className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setQrModalLink(link)}>
                      <QrCode className="mr-2 h-4 w-4" /> QR Code
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleToggleActive(link)}>
                      {link.isActive ? 'Disable link' : 'Enable link'}
                    </DropdownMenuItem>

                    <div className="my-1 h-px bg-ink-20" />

                    <DeleteLinkDialog
                      linkId={link.id}
                      onSuccess={() => {
                        refetch();
                        qc.invalidateQueries({
                          queryKey: trpc.shortLinks.entitlement.queryKey(),
                        });
                      }}
                    >
                      <DropdownMenuItem
                        onSelect={(e) => e.preventDefault()}
                        className="text-error focus:text-error focus:bg-error/10"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DeleteLinkDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateEditLinkModal
        brandId={brandId}
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        initialData={editLink}
        onSuccess={() => {
          refetch();
          qc.invalidateQueries({
            queryKey: trpc.shortLinks.entitlement.queryKey(),
          });
          setEditLink(null);
        }}
      />

      {qrModalLink && (
        <QRCodeModal
          link={qrModalLink}
          open={!!qrModalLink}
          onOpenChange={(open) => !open && setQrModalLink(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE / EDIT LINK MODAL
// ─────────────────────────────────────────────────────────────────────────────

function CreateEditLinkModal({
  brandId,
  open,
  onOpenChange,
  initialData,
  onSuccess,
}: {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: any;
  onSuccess: () => void;
}) {
  const isEditing = !!initialData;
  const [nickname, setNickname] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [slug, setSlug] = useState('');

  // Slug checking
  const [slugStatus, setSlugStatus] = useState<
    'idle' | 'loading' | 'available' | 'unavailable'
  >('idle');
  const [slugError, setSlugError] = useState('');

  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const createMutation = useMutation(trpc.shortLinks.create.mutationOptions());
  const updateMutation = useMutation(trpc.shortLinks.update.mutationOptions());

  useEffect(() => {
    if (open) {
      if (initialData) {
        setNickname(initialData.nickname);
        setDestinationUrl(initialData.destinationUrl);
        setSlug(initialData.slug);
        setSlugStatus('idle');
      } else {
        setNickname('');
        setDestinationUrl('');
        setSlug('');
        setSlugStatus('idle');
      }
    }
  }, [open, initialData]);

  // Debounced slug check
  useEffect(() => {
    if (isEditing && slug === initialData?.slug) {
      setSlugStatus('idle');
      setSlugError('');
      return;
    }
    if (slug.length < 3) {
      setSlugStatus('idle');
      return;
    }

    const timer = setTimeout(async () => {
      setSlugStatus('loading');
      try {
        const res = await trpcClient.shortLinks.checkSlug.query({ slug });
        if (res.available) {
          setSlugStatus('available');
          setSlugError('');
        } else {
          setSlugStatus('unavailable');
          setSlugError(res.reason || 'Not available');
        }
      } catch (err) {
        setSlugStatus('unavailable');
        setSlugError('Error checking availability');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [slug, isEditing, initialData, trpc.shortLinks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (slugStatus === 'unavailable' || slugStatus === 'loading') return;

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({
          id: initialData.id,
          nickname,
          destinationUrl,
          slug: slug !== initialData.slug ? slug : undefined,
        });
      } else {
        await createMutation.mutateAsync({
          brandId,
          nickname,
          destinationUrl,
          slug,
        });
      }
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      // Toast error handled by global TRPC client, but could show inline
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isSubmitDisabled =
    !nickname ||
    !destinationUrl ||
    !slug ||
    slug.length < 3 ||
    slugStatus === 'unavailable' ||
    isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit Link' : 'Create a short link'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label htmlFor="destinationUrl">Destination URL</Label>
              <Input
                id="destinationUrl"
                type="url"
                placeholder="https://example.com/very-long-url-path"
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">Short Link</Label>
              <div className="flex items-center rounded-md border border-[color:var(--color-border-default)] bg-paper shadow-sm focus-within:ring-1 focus-within:ring-accent">
                <span className="flex select-none items-center pl-3 text-ink-40 text-ui-sm">
                  {SHORT_LINK_BASE_NO_PROTOCOL}/
                </span>
                <input
                  id="slug"
                  className="w-full bg-transparent px-2 py-2 text-ui-sm text-ink-100 placeholder:text-ink-40 focus:outline-none"
                  placeholder="my-campaign"
                  value={slug}
                  onChange={(e) =>
                    setSlug(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    )
                  }
                  required
                />
                <div className="pr-3 flex items-center justify-center w-6">
                  {slugStatus === 'loading' && (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
                  )}
                  {slugStatus === 'available' && (
                    <Check className="h-4 w-4 text-success" />
                  )}
                  {slugStatus === 'unavailable' && (
                    <span className="text-error text-xl leading-none">
                      &times;
                    </span>
                  )}
                </div>
              </div>
              {slugError && (
                <p className="text-ui-xs text-error">{slugError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                placeholder="Summer Sale Campaign"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
              <p className="text-ui-xs text-ink-40">
                Used internally to identify this link.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitDisabled}>
              {isSaving
                ? 'Saving...'
                : isEditing
                  ? 'Save Changes'
                  : 'Create Link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QR CODE MODAL
// ─────────────────────────────────────────────────────────────────────────────

function QRCodeModal({
  link,
  open,
  onOpenChange,
  onSuccess,
}: {
  link: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const trpc = useTRPC();
  const qrConfig: QrConfig = link.qrConfig || {};

  // Local state for the styling options — seeded from the saved design so
  // re-opening an edited code restores the colours and pattern previously chosen.
  const [foregroundColor, setForegroundColor] = useState(
    qrConfig.foregroundColor || '#000000',
  );
  const [backgroundColor, setBackgroundColor] = useState(
    qrConfig.backgroundColor || '#ffffff',
  );
  const [dotStyle, setDotStyle] = useState(qrConfig.dotStyle || 'square');
  const [cornerStyle, setCornerStyle] = useState(
    qrConfig.cornerStyle || 'square',
  );

  const qrCodeObj = useRef<QRCodeStyling | null>(null);
  const updateMutation = useMutation(trpc.shortLinks.update.mutationOptions());

  const fullUrl = `${SHORT_LINK_BASE}/${link.slug}`;
  const colorsValid = isHex(foregroundColor) && isHex(backgroundColor);

  const options = useMemo(
    () =>
      buildQrOptions(
        link.slug,
        { foregroundColor, backgroundColor, dotStyle, cornerStyle },
        280,
      ),
    [link.slug, foregroundColor, backgroundColor, dotStyle, cornerStyle],
  );

  const getBlob = async (): Promise<Blob | null> => {
    if (!qrCodeObj.current) return null;
    const raw = await qrCodeObj.current.getRawData('png');
    return raw instanceof Blob
      ? raw
      : raw
        ? new Blob([raw as any], { type: 'image/png' })
        : null;
  };

  const handleSave = async () => {
    if (!colorsValid) return;
    try {
      await updateMutation.mutateAsync({
        id: link.id,
        qrConfig: {
          foregroundColor,
          backgroundColor,
          dotStyle: dotStyle as any,
          cornerStyle: cornerStyle as any,
        },
      });
      toast.success('QR design saved');
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('Could not save QR design');
    }
  };

  const handleDownload = (ext: 'png' | 'svg') => {
    qrCodeObj.current?.download({ name: `qr-${link.slug}`, extension: ext });
  };

  const handleCopyImage = async () => {
    try {
      const blob = await getBlob();
      if (
        !blob ||
        !navigator.clipboard ||
        typeof ClipboardItem === 'undefined'
      ) {
        throw new Error('unsupported');
      }
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      toast.success('QR image copied to clipboard');
    } catch {
      toast.error('Copying images isn’t supported here — try Download instead');
    }
  };

  const handleNativeShare = async () => {
    const shareData: ShareData = {
      title: link.nickname || 'QR code',
      text: `Scan to open ${link.nickname || fullUrl}`,
      url: fullUrl,
    };
    try {
      const blob = await getBlob();
      const file = blob
        ? new File([blob], `qr-${link.slug}.png`, { type: 'image/png' })
        : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ ...shareData, files: [file] });
      } else if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(fullUrl);
        toast.success('Link copied — paste it anywhere to share');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error('Unable to share');
    }
  };

  const encoded = encodeURIComponent(fullUrl);
  const shareText = encodeURIComponent(
    `Check this out: ${link.nickname || fullUrl}`,
  );
  const socials = [
    {
      label: 'Share on X',
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?url=${encoded}&text=${shareText}`,
    },
    {
      label: 'Share on Facebook',
      icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    },
    {
      label: 'Share on LinkedIn',
      icon: Linkedin,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
    },
    {
      label: 'Share on WhatsApp',
      icon: MessageCircle,
      href: `https://wa.me/?text=${shareText}%20${encoded}`,
    },
    {
      label: 'Share via Email',
      icon: Mail,
      href: `mailto:?subject=${shareText}&body=${encoded}`,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] p-0 overflow-hidden flex flex-col md:flex-row gap-0">
        {/* Left: Preview + share */}
        <div className="flex flex-col items-center justify-center border-b border-ink-20 bg-inset p-8 md:w-[320px] md:border-b-0 md:border-r">
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <QRView
              options={options}
              instanceRef={qrCodeObj}
              className="h-[280px] w-[280px] [&>svg]:h-full [&>svg]:w-full"
            />
          </div>

          <div className="mt-5 flex w-full max-w-[280px] flex-col gap-3">
            <Button onClick={handleNativeShare} className="w-full">
              <Share2 className="mr-2 h-4 w-4" /> Share
            </Button>

            <div className="flex items-center justify-center gap-1.5">
              {socials.map(({ label, icon: Icon, href }) => (
                <Tooltip key={label} label={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-20 bg-paper text-ink-60 transition-colors hover:border-accent hover:text-accent"
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                </Tooltip>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload('png')}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> PNG
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload('svg')}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> SVG
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopyImage}>
                <ImageDown className="mr-1.5 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex-1 p-6">
          <DialogHeader className="mb-6">
            <DialogTitle>Customize QR Code</DialogTitle>
            <DialogDescription>
              {SHORT_LINK_BASE_NO_PROTOCOL}/{link.slug}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <ColorField
                label="Foreground"
                value={foregroundColor}
                onChange={setForegroundColor}
              />
              <ColorField
                label="Background"
                value={backgroundColor}
                onChange={setBackgroundColor}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pattern</Label>
                <select
                  className="flex h-9 w-full items-center justify-between rounded-md border border-[color:var(--color-border-default)] bg-transparent px-3 py-2 text-ui-sm shadow-sm ring-offset-paper placeholder:text-ink-40 focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                  value={dotStyle}
                  onChange={(e) => setDotStyle(e.target.value)}
                >
                  <option value="square">Square</option>
                  <option value="dots">Dots</option>
                  <option value="rounded">Rounded</option>
                  <option value="classy">Classy</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Corners</Label>
                <select
                  className="flex h-9 w-full items-center justify-between rounded-md border border-[color:var(--color-border-default)] bg-transparent px-3 py-2 text-ui-sm shadow-sm ring-offset-paper placeholder:text-ink-40 focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                  value={cornerStyle}
                  onChange={(e) => setCornerStyle(e.target.value)}
                >
                  <option value="square">Square</option>
                  <option value="dot">Dot</option>
                  <option value="extra-rounded">Extra Rounded</option>
                </select>
              </div>
            </div>

            {!colorsValid && (
              <p className="text-ui-xs text-error">
                Enter full 6-digit hex colours (e.g. #1A2B3C) to save.
              </p>
            )}
          </div>

          <div className="mt-8 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || !colorsValid}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Design'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR FIELD — swatch button that opens a react-colorful picker with presets
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#000000',
  '#ffffff',
  '#1f2937',
  '#0f172a',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = isHex(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover
        align="start"
        className="min-w-[220px]"
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            className="flex w-full items-center gap-2 rounded-md border border-[color:var(--color-border-default)] bg-paper px-2 py-1.5 text-ui-sm shadow-sm transition-colors hover:border-accent"
          >
            <span
              className="h-6 w-6 shrink-0 rounded border border-ink-20"
              style={{ backgroundColor: valid ? value : 'transparent' }}
            />
            <span className="font-medium uppercase text-ink-100">{value}</span>
          </button>
        )}
      >
        {() => (
          <div className="space-y-3">
            <HexColorPicker
              color={valid ? value : '#000000'}
              onChange={onChange}
              style={{ width: '100%', height: 150 }}
            />
            <div className="flex items-center rounded-md border border-[color:var(--color-border-default)] bg-paper">
              <span className="select-none pl-2 text-ink-40">#</span>
              <input
                value={value.replace(/^#/, '')}
                onChange={(e) =>
                  onChange(
                    '#' +
                      e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6),
                  )
                }
                maxLength={6}
                className="w-full bg-transparent px-1 py-1.5 text-ui-sm uppercase text-ink-100 focus:outline-none"
                placeholder="000000"
              />
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {COLOR_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChange(p)}
                  aria-label={p}
                  className="h-6 w-6 rounded border border-ink-20 transition-transform hover:scale-110"
                  style={{ backgroundColor: p }}
                />
              ))}
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Tooltip label="Copy link">
      <button
        onClick={handleCopy}
        className="text-ink-40 hover:text-ink-100 transition-colors"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </Tooltip>
  );
}

function DeleteLinkDialog({
  linkId,
  onSuccess,
  children,
}: {
  linkId: string;
  onSuccess: () => void;
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const deleteMutation = useMutation(trpc.shortLinks.remove.mutationOptions());
  const confirm = useConfirm();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (
      await confirm({
        title: 'Delete short link',
        description:
          'Are you sure you want to delete this link? It will immediately stop working and any existing QR codes will become invalid.',
        confirmLabel: 'Delete link',
        destructive: true,
      })
    ) {
      await deleteMutation.mutateAsync({ id: linkId });
      onSuccess();
    }
  };

  return (
    <div onClick={handleDelete} className="w-full">
      {children}
    </div>
  );
}
