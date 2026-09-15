/* Verdiict — Locations home. Lists the brand's review locations and creates new
 * ones. The first place a brand lands; surfaces the review streak, the full
 * milestones section, per-location QR codes and the trial billing nudges. */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type QRCodeStyling from 'qr-code-styling';
import { useTRPC } from '@shared/lib/trpc';
import { LazyImage } from '@shared/components/ui/lazy-image';
import {
  Plus,
  Copy,
  Check,
  CheckCircle2,
  Settings,
  MessageSquare,
  QrCode as QrCodeIcon,
  ExternalLink,
  Building2,
  Download,
  Loader2,
  Lock,
  Sparkles,
  Package,
  Star,
  Award,
  Trophy,
} from 'lucide-react';
import { EmptyState, Modal, SkeletonRows, QrCode } from '../components';
import { num, qrLink, reviewLink } from '../lib';
import type { Page, PageProps, ReviewLocation, RewardRow } from '../lib';
import { useToast } from '../toast';

/** Compact week-streak card — teaser for the Progress page. */
function StreakCard({ brandId, go }: { brandId: string; go: PageProps['go'] }) {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.reviews.insights.streak.queryOptions({ brandId }));
  if (!data || data.weeks.length === 0) return null;
  const thisWeek = data.weeks[data.weeks.length - 1]?.count ?? 0;
  const streak = data.streak ?? 0;
  return (
    <button
      type="button"
      className="vcard vrow-between"
      style={{
        width: '100%',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        marginBottom: 16,
      }}
      onClick={() => go('progress')}
    >
      <div className="vrow" style={{ gap: 12 }}>
        <span
          className="mono"
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'var(--v-ink)',
            color: 'var(--v-paper)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {num(streak)}
        </span>
        <div>
          <div className="veyebrow">
            {streak === 1 ? 'Week streak' : `${num(streak)} week streak`}
          </div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>
            {thisWeek === 1 ? '1 review this week' : `${num(thisWeek)} reviews this week`}
          </div>
        </div>
      </div>
      {data.atRisk ? (
        <span className="vbadge" style={{ color: 'var(--v-warn)' }}>
          At risk
        </span>
      ) : streak >= 4 ? (
        <span className="vbadge" style={{ color: 'var(--v-success)' }}>
          On a roll
        </span>
      ) : null}
    </button>
  );
}

type MilestoneTileData = {
  k: string;
  icon: typeof Sparkles;
  label: string;
  threshold: number;
  current: number;
  scope: 'account' | 'location';
  whatItIs: string;
  whyItMatters: string;
  cta?: { label: string; page: Page };
  reward?: RewardRow;
  claimLabel?: string;
  featured?: boolean;
};

/** One milestone card. Visually distinguishes four states, mirroring the
 * original surface: locked → in-progress → unlocked (claimable) → claimed. */
function MilestoneTile({
  tile: p,
  go,
  canEdit,
}: {
  tile: MilestoneTileData;
  go: PageProps['go'];
  canEdit: boolean;
}) {
  const reached = p.current >= p.threshold;
  const claimable = p.reward?.status === 'unlocked';
  const status = p.reward?.status;
  const claimed =
    status === 'claimed' || status === 'shipped' || status === 'delivered';
  const delivered = status === 'delivered';
  // Fulfilment message shown once claimed → mirrors the shipping pipeline.
  const fulfilMsg =
    status === 'delivered'
      ? 'Delivered — enjoy!'
      : status === 'shipped'
        ? 'Shipped — on its way to you.'
        : 'Claimed — we’re preparing to ship.';
  const pct = Math.min(100, p.threshold > 0 ? (p.current / p.threshold) * 100 : 0);
  const Icon = p.icon;
  return (
    <div
      style={{
        border: '1px solid var(--v-line)',
        borderRadius: 'var(--v-radius)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        background: reached ? 'var(--v-card)' : 'var(--v-paper-2)',
        ...(p.featured && reached ? { borderColor: 'var(--v-accent)' } : {}),
      }}
    >
      <div className="vrow" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            background: reached ? 'var(--v-ink)' : 'var(--v-line-soft)',
            color: reached ? 'var(--v-paper)' : 'var(--v-muted)',
          }}
        >
          <Icon size={16} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="vrow" style={{ gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{p.label}</h3>
            {claimed ? (
              <span className="vbadge" style={{ color: 'var(--v-success)' }}>
                <CheckCircle2 size={10} />
                {delivered ? 'Delivered' : status === 'shipped' ? 'Shipped' : 'Claimed'}
              </span>
            ) : reached ? (
              <span className="vbadge" style={{ color: 'var(--v-success)' }}>Unlocked</span>
            ) : (
              <span className="vbadge" style={{ background: 'var(--v-line-soft)' }}>
                <Lock size={10} />
                Locked
              </span>
            )}
          </div>
          <div className="mono vmuted" style={{ fontSize: 11, marginTop: 2, letterSpacing: '0.04em' }}>
            {reached
              ? p.scope === 'location'
                ? 'Per-location reward'
                : 'Account-wide reward'
              : `${num(p.current)} / ${num(p.threshold)} reviews ${
                  p.scope === 'location' ? '(per location)' : '(account-wide)'
                }`}
          </div>
        </div>
      </div>

      {!reached ? (
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: 'var(--v-line-soft)',
            marginTop: 12,
            overflow: 'hidden',
          }}
        >
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--v-accent)' }} />
        </div>
      ) : null}

      <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55 }}>
        <strong>What it is. </strong>
        <span className="vmuted">{p.whatItIs}</span>
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55 }}>
        <strong>Why you want it. </strong>
        <span className="vmuted">{p.whyItMatters}</span>
      </p>

      <div
        className="vrow"
        style={{ marginTop: 'auto', paddingTop: 16, gap: 8, flexWrap: 'wrap' }}
      >
        {p.cta ? (
          <button
            className={reached ? 'vbtn vbtn-primary vbtn-sm' : 'vbtn vbtn-sm'}
            onClick={() => go(p.cta!.page)}
          >
            {p.cta.label}
            <ExternalLink size={13} />
          </button>
        ) : null}
        {claimable && canEdit && p.claimLabel ? (
          <button className="vbtn vbtn-primary vbtn-sm" onClick={() => go('progress')}>
            {p.claimLabel}
          </button>
        ) : null}
        {claimed ? (
          <span className="vmuted vrow" style={{ fontSize: 12, gap: 6 }}>
            <CheckCircle2 size={13} style={{ color: 'var(--v-success)' }} />
            {fulfilMsg}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Full milestones section — parity with the original dashboard surface. Each
 * card explains *what unlocks* AND *why the customer should care*, not just a
 * threshold count. Claims are completed on the Progress page. */
function Milestones({
  brandId,
  go,
  canEdit,
}: {
  brandId: string;
  go: PageProps['go'];
  canEdit: boolean;
}) {
  const trpc = useTRPC();
  const { data: rewards } = useQuery(trpc.reviews.rewards.list.queryOptions({ brandId }));
  if (!rewards) return null;
  const account = rewards.accountReviews;
  const maxLoc = rewards.maxLocationReviews;
  const th = rewards.thresholds;
  const stickerReward = rewards.rewards.find((r) => r.kind === 'sticker_pack');
  const goldReward = rewards.rewards.find((r) => r.kind === 'gold_plaque');
  const platinumReward = rewards.rewards.find((r) => r.kind === 'platinum_plaque');

  const cards: MilestoneTileData[] = [
    {
      k: 'embed',
      icon: Sparkles,
      label: 'Embed your reviews on your website',
      threshold: 10,
      current: account,
      scope: 'account',
      whatItIs: 'A copy-paste embed code that puts your 5-star reviews on your homepage.',
      whyItMatters:
        'Reviews on Google are great. Reviews on your own site convert visitors. The embed shows your latest 5-star reviews, refreshing automatically as new ones come in — and the design matches your brand.',
      cta: { label: 'Open embed builder', page: 'embed' },
    },
    {
      k: 'sticker',
      icon: Package,
      label: 'Free QR sticker pack — printed and shipped',
      threshold: th.stickerPack,
      current: maxLoc,
      scope: 'location',
      whatItIs:
        'A physical pack of weatherproof QR-code stickers we print and post to you, free of charge.',
      whyItMatters:
        'Hand them to customers, stick them on invoices, vans, or counters. Every scan opens your review page in three taps. Once a single location hits 20 reviews, that location qualifies for its own pack — every additional location unlocks its own pack independently.',
      reward: stickerReward,
      claimLabel: 'Claim sticker pack',
    },
    {
      k: 'branded',
      icon: Star,
      label: 'Branded customisation',
      threshold: 25,
      current: maxLoc,
      scope: 'location',
      whatItIs:
        'Custom colours, fonts, your logo, and tone — applied to your review request page and your embed.',
      whyItMatters:
        'Customers trust pages that look like yours, not ours. Branded pages convert noticeably better and reinforce your business each time someone leaves a review.',
      cta: { label: 'Open embed builder', page: 'embed' },
    },
    {
      k: 'gold',
      icon: Award,
      label: 'Gold plaque — shipped to your door',
      threshold: th.gold,
      current: account,
      scope: 'account',
      whatItIs:
        'A real, framed brushed-gold plaque engraved with your business name and milestone date. Shipped on us.',
      whyItMatters:
        'Hang it where customers can see it. 1,000 verified reviews is a serious credential — make sure you’re wearing it. Most businesses never get here; the ones that do tend to dominate their category locally.',
      reward: goldReward,
      claimLabel: 'Claim Gold plaque',
      featured: true,
    },
    {
      k: 'platinum',
      icon: Trophy,
      label: 'Platinum plaque — shipped to your door',
      threshold: th.platinum,
      current: account,
      scope: 'account',
      whatItIs:
        'An oversized brushed-platinum plaque — engraved, framed, and shipped. The rarest tier on Verdiict.',
      whyItMatters:
        '10,000 reviews puts you in the top fraction of a percent. The plaque is the trophy. The credibility lift is the prize.',
      reward: platinumReward,
      claimLabel: 'Claim Platinum plaque',
      featured: true,
    },
  ];

  return (
    <section style={{ marginTop: 40 }}>
      <div className="vrow-between" style={{ alignItems: 'flex-end', gap: 12, marginBottom: 12 }}>
        <div>
          <span className="veyebrow">Your milestones</span>
          <h2 style={{ margin: '4px 0 0', fontSize: 22, letterSpacing: '-0.025em' }}>
            What you unlock as your reviews grow
          </h2>
        </div>
        <button className="vbtn vbtn-quiet vbtn-sm" onClick={() => go('progress')}>
          View streak &amp; insights →
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
        }}
      >
        {cards.map((c) => (
          <MilestoneTile key={c.k} tile={c} go={go} canEdit={canEdit} />
        ))}
      </div>
      <p className="vmuted" style={{ fontSize: 12, marginTop: 14 }}>
        Reviews counted: {num(account)} across your account. Sticker pack and branded
        customisation count <em>per location</em>; everything else counts your whole account.
      </p>
    </section>
  );
}

export function LocationsHome(props: PageProps) {
  const { brandId, entitlement, canEdit, go } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [qrLoc, setQrLoc] = useState<ReviewLocation | null>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);

  const { data: locations, isLoading } = useQuery(
    trpc.reviews.locations.list.queryOptions({ brandId }),
  );
  const { data: industries } = useQuery(trpc.reviews.industries.list.queryOptions());

  const create = useMutation({
    ...trpc.reviews.locations.create.mutationOptions(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() });
      setCreating(false);
      setName('');
      setIndustry('');
      toast('Location created.');
      go('location', { id: res.locationId });
    },
    onError: (err) => toast(err.message || "Couldn't create the location."),
  });

  async function copyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(reviewLink(slug));
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug((s) => (s === slug ? null : s)), 2000);
      toast('Review link copied.');
    } catch {
      toast("Couldn't copy the link.");
    }
  }

  function submitCreate() {
    if (!name.trim() || !industry) {
      toast('Please fill in all fields.');
      return;
    }
    create.mutate({ brandId, name: name.trim(), industry });
  }

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Locations</h1>
          <p>Each location gets its own review-capture page and platform links.</p>
        </div>
        {canEdit ? (
          <div>
            <button className="vbtn vbtn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              New location
            </button>
          </div>
        ) : null}
      </div>

      <StreakCard brandId={brandId} go={go} />

      {entitlement && entitlement.trialActive && !entitlement.entitled ? (
        <div className="vbanner accent vrow-between" style={{ marginBottom: 16 }}>
          <span>
            Free trial — {num(entitlement.trialRemaining)} of {num(entitlement.trialLimit)} free
            reviews remaining. Your review pages are fully live.
          </span>
          <button className="vbtn vbtn-quiet vbtn-sm" onClick={() => go('billing')}>
            View billing
          </button>
        </div>
      ) : null}

      {entitlement && !entitlement.live ? (
        <div className="vbanner warn vrow-between" style={{ marginBottom: 16 }}>
          <span>Your free trial has ended — subscribe to keep your pages live.</span>
          <button className="vbtn vbtn-accent vbtn-sm" onClick={() => go('billing')}>
            View billing
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <SkeletonRows />
      ) : !locations || locations.length === 0 ? (
        <EmptyState
          title="No locations yet"
          body={
            canEdit
              ? 'Create your first location to start collecting reviews.'
              : 'No locations have been created for this brand yet.'
          }
          cta={canEdit ? 'New location' : undefined}
          onCta={canEdit ? () => setCreating(true) : undefined}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {locations.map((loc) => (
            <div key={loc.id} className="vcard vrow-between vlocation-card">
              <div className="vrow" style={{ gap: 14, minWidth: 0 }}>
                {loc.logoUrl ? (
                  <LazyImage
                    src={loc.logoUrl}
                    alt={loc.name}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      border: '1px solid var(--v-line)',
                      background: '#fff',
                      flexShrink: 0,
                    }}
                    imgClassName="object-contain"
                  />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: 'var(--v-paper-2)',
                      color: 'var(--v-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Building2 size={18} />
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="vrow" style={{ gap: 10 }}>
                    <h3 style={{ margin: 0 }}>{loc.name}</h3>
                    <span className="vbadge">{loc.industry}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    <a
                      href={reviewLink(loc.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="vmuted"
                      style={{ color: 'var(--v-muted)' }}
                    >
                      {reviewLink(loc.slug)}
                    </a>
                  </div>
                </div>
              </div>
              <div className="vrow" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="vbtn vbtn-quiet vbtn-sm" onClick={() => copyLink(loc.slug)}>
                  {copiedSlug === loc.slug ? (
                    <Check size={14} style={{ color: 'var(--v-success)' }} />
                  ) : (
                    <Copy size={14} />
                  )}
                  Copy link
                </button>
                <button className="vbtn vbtn-quiet vbtn-sm" onClick={() => setQrLoc(loc)}>
                  <QrCodeIcon size={14} />
                  QR
                </button>
                <a
                  className="vbtn vbtn-quiet vbtn-sm"
                  href={reviewLink(loc.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} />
                  Preview
                </a>
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  onClick={() => go('reviewsLog', { id: loc.id })}
                >
                  <MessageSquare size={14} />
                  Reviews
                </button>
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  onClick={() => go('location', { id: loc.id })}
                >
                  <Settings size={14} />
                  Settings
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Milestones brandId={brandId} go={go} canEdit={canEdit} />

      {qrLoc ? (
        <Modal title={`QR code — ${qrLoc.name}`} onClose={() => setQrLoc(null)} width={360}>
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
          >
            <div
              style={{
                padding: 14,
                background: '#fff',
                borderRadius: 12,
                border: '1px solid var(--v-line)',
              }}
            >
              {/* QR encodes the redirector hop (immutable location id), not the
                  slug URL — printed codes keep working across link renames. The
                  caption below stays the friendly /r/ link on purpose. */}
              <QrCode value={qrLink(qrLoc.id)} size={220} instanceRef={qrRef} />
            </div>
            <div
              className="vmuted"
              style={{ fontSize: 12, textAlign: 'center', wordBreak: 'break-all' }}
            >
              {reviewLink(qrLoc.slug)}
            </div>
            <button
              className="vbtn vbtn-primary"
              style={{ width: '100%' }}
              onClick={() =>
                qrRef.current?.download({ name: `verdiict-qr-${qrLoc.slug}`, extension: 'png' })
              }
            >
              <Download size={15} />
              Download PNG
            </button>
          </div>
        </Modal>
      ) : null}

      {creating ? (
        <Modal title="Add a new location" onClose={() => setCreating(false)} width={460}>
          <div className="vfield">
            <label className="vlabel">Business name</label>
            <input
              className="vinput"
              value={name}
              autoFocus
              placeholder="e.g. Sunrise Plumbing Co."
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="vfield">
            <label className="vlabel">Industry</label>
            {!industries ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                <Loader2 size={18} className="animate-spin" style={{ color: 'var(--v-muted)' }} />
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  maxHeight: 256,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {industries.map((i) => (
                  <button
                    key={i.slug}
                    type="button"
                    className="vselcard"
                    data-selected={industry === i.slug}
                    style={{ padding: 12 }}
                    onClick={() => setIndustry(i.slug)}
                  >
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{i.label}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="vbtn vbtn-quiet" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              className="vbtn vbtn-primary"
              disabled={create.isPending}
              onClick={submitCreate}
            >
              {create.isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Creating…
                </>
              ) : (
                'Create location'
              )}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
