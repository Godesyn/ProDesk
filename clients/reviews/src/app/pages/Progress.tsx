/* Verdiict — Progress. Streak, industry rank and referral cards up top, then
 * the full milestones card: growth unlocks (embed, branding) plus
 * claimable physical rewards. LocationsHome shows the compact teaser strip;
 * this page is the detail surface. */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useCurrentUser } from '@shared/auth/auth-context';
import { Copy, Gift, Lock, Sparkles, Star, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Modal, SkeletonRows } from '../components';
import { PlacesAddressField, DIAL_CODES } from '../places';
import { num } from '../lib';
import type { PageProps, RewardRow } from '../lib';
import { useToast } from '../toast';

const REWARD_LABELS: Record<string, string> = {
  sticker_pack: 'Sticker pack',
  gold_plaque: 'Gold plaque',
  platinum_plaque: 'Platinum plaque',
};

/** Fulfilment status shown to the brand (mirrors the admin shipping pipeline). */
const REWARD_STATUS: Record<string, string> = {
  unlocked: 'Ready to claim',
  claimed: 'Claimed — preparing to ship',
  shipped: 'Shipped — on its way',
  delivered: 'Delivered',
};

/* Growth-unlock thresholds (mirror the server constants surfaced on
 * embeds.entitlements / collections.detail). */
const EMBED_UNLOCK = 10;
const BRANDED_UNLOCK = 25;

type Address = {
  name: string;
  houseNumber: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  dialCode: string;
  phone: string;
};

const EMPTY_ADDRESS: Address = {
  name: '',
  houseNumber: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postcode: '',
  country: 'Australia',
  dialCode: '+61',
  phone: '',
};

export function Progress(props: PageProps) {
  const { brandId, go, canEdit } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: user } = useCurrentUser();

  const { data: streak, isLoading: streakLoading } = useQuery(
    trpc.reviews.insights.streak.queryOptions({ brandId }),
  );
  const { data: rank } = useQuery(
    trpc.reviews.insights.industryRank.queryOptions({ brandId }),
  );
  const { data: rewards } = useQuery(trpc.reviews.rewards.list.queryOptions({ brandId }));
  const { data: referrals } = useQuery(trpc.reviews.referrals.mine.queryOptions());

  const [claiming, setClaiming] = useState<RewardRow | null>(null);
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [redeemCode, setRedeemCode] = useState('');

  const claim = useMutation({
    ...trpc.reviews.rewards.claim.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.rewards.list.queryKey() });
      setClaiming(null);
      setAddress(EMPTY_ADDRESS);
      toast('Reward claimed — we’ll ship it out.');
    },
    onError: (err) => toast(err.message || "Couldn't claim the reward."),
  });

  const redeem = useMutation({
    ...trpc.reviews.referrals.redeem.mutationOptions(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: trpc.reviews.referrals.mine.queryKey() });
      setRedeemCode('');
      toast(
        res.settled
          ? 'Code redeemed — a month of credit is on your account.'
          : 'Code redeemed — your free month is credited when your subscription starts.',
      );
    },
    onError: (err) => toast(err.message || "Couldn't redeem that code."),
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast('Referral code copied.');
    } catch {
      toast("Couldn't copy the code.");
    }
  }

  function submitClaim() {
    if (!claiming) return;
    if (!address.name.trim() || !address.houseNumber.trim() || !address.line1.trim()) return;
    if (!address.city.trim() || !address.postcode.trim() || !address.country.trim()) return;
    claim.mutate({
      brandId,
      rewardId: claiming.id,
      address: {
        name: address.name.trim(),
        houseNumber: address.houseNumber.trim(),
        line1: address.line1.trim(),
        line2: address.line2.trim() || undefined,
        city: address.city.trim(),
        state: address.state.trim() || undefined,
        postcode: address.postcode.trim(),
        country: address.country.trim(),
        phone: address.phone.trim()
          ? `${address.dialCode} ${address.phone.trim()}`
          : undefined,
      },
    });
  }

  const maxLoc = rewards?.maxLocationReviews ?? 0;
  const account = rewards?.accountReviews ?? 0;
  const th = rewards?.thresholds;

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>{rewards ? `${num(account)} reviews captured` : 'Progress'}</h1>
          <p>
            Every review unlocks something — embeds, custom branding, and physical
            rewards we’ll ship to your door.
          </p>
        </div>
      </div>

      <div className="vgrid cols-3">
        {/* Streak */}
        <div className="vcard">
          <div className="veyebrow" style={{ marginBottom: 12 }}>Review streak</div>
          {streakLoading || !streak ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {num(streak.streak)}{' '}
                {streak.streak === 1 ? 'week' : 'weeks'}
                <span className="vmuted" style={{ fontSize: 14, fontWeight: 400 }}>
                  {' '}streak
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 4,
                  height: 80,
                  marginTop: 14,
                }}
              >
                {streak.weeks.map((w, i) => {
                  const max = Math.max(1, ...streak.weeks.map((x) => x.count));
                  return (
                    <div
                      key={i}
                      title={`${w.count} ${w.count === 1 ? 'review' : 'reviews'}`}
                      style={{
                        flex: 1,
                        height: `${Math.max(4, (w.count / max) * 80)}px`,
                        background: 'var(--v-accent)',
                        borderRadius: 3,
                        opacity: w.count > 0 ? 1 : 0.18,
                      }}
                    />
                  );
                })}
              </div>
              {streak.atRisk ? (
                <div className="vbanner warn" style={{ marginTop: 14 }}>
                  <span>Your streak is at risk — capture a review this week to keep it.</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Industry rank */}
        <div className="vcard">
          <div className="veyebrow" style={{ marginBottom: 12 }}>Industry rank</div>
          {!rank ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <div className="vrow" style={{ gap: 8 }}>
                <Trophy size={18} />
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    textTransform: 'capitalize',
                  }}
                >
                  {rank.industry}
                </span>
              </div>
              <div className="vmuted" style={{ fontSize: 13, marginTop: 10 }}>
                {rank.percentile != null
                  ? `Top ${100 - Math.round(rank.percentile)}% of accounts in this industry`
                  : 'Capture a few reviews to see your rank'}
              </div>
            </>
          )}
        </div>

        {/* Referrals */}
        <div className="vcard">
          <div className="veyebrow" style={{ marginBottom: 12 }}>Referrals</div>
          {!referrals ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <div className="vrow-between">
                <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                  {referrals.code}
                </span>
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  onClick={() => copyCode(referrals.code)}
                >
                  <Copy size={14} />
                  Copy
                </button>
              </div>
              <div className="vmuted" style={{ fontSize: 13, marginTop: 10 }}>
                Share your code — you both get one month free when they subscribe.
              </div>
              <div className="vmuted" style={{ fontSize: 13, marginTop: 6 }}>
                {num(referrals.monthsEarned)} free{' '}
                {referrals.monthsEarned === 1 ? 'month' : 'months'} earned
                {referrals.monthsPending > 0
                  ? ` · ${num(referrals.monthsPending)} pending`
                  : ''}
              </div>
              {referrals.myRedemption ? (
                <div className="vmuted" style={{ fontSize: 13, marginTop: 12 }}>
                  You redeemed <span className="mono">{referrals.myRedemption.code}</span> —{' '}
                  {referrals.myRedemption.creditedAt
                    ? 'your free month has been credited.'
                    : 'your free month is credited when your subscription starts.'}
                </div>
              ) : canEdit && user?.role === 'brandOwner' ? (
                <div className="vfield" style={{ marginTop: 16, marginBottom: 0 }}>
                  <label className="vlabel">Redeem a code</label>
                  <div className="vrow" style={{ gap: 8 }}>
                    <input
                      className="vinput"
                      value={redeemCode}
                      placeholder="FRIENDCODE"
                      onChange={(e) => setRedeemCode(e.target.value)}
                    />
                    <button
                      className="vbtn vbtn-primary vbtn-sm"
                      disabled={!redeemCode.trim() || redeem.isPending}
                      onClick={() => redeem.mutate({ code: redeemCode.trim() })}
                    >
                      Redeem
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Milestones — growth unlocks + physical rewards */}
      <div className="vcard" style={{ marginTop: 16 }}>
        <div className="veyebrow" style={{ marginBottom: 12 }}>Milestones</div>
        {!rewards || !th ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            <div className="vgrid cols-2" style={{ marginBottom: 18 }}>
              <UnlockTile
                icon={Sparkles}
                label="Embed your reviews on your website"
                current={account}
                target={EMBED_UNLOCK}
                scope="account-wide"
                whatItIs="A copy-paste embed code that puts your 5-star reviews on your homepage."
                whyItMatters="Reviews on Google are great. Reviews on your own site convert visitors — the embed refreshes automatically as new ones come in."
                cta="Open embed builder"
                onCta={() => go('embed')}
              />
              <UnlockTile
                icon={Star}
                label="Branded customisation"
                current={maxLoc}
                target={BRANDED_UNLOCK}
                scope="per location"
                whatItIs="Custom colours, fonts, your logo and tone — applied to your review page and your embed."
                whyItMatters="Customers trust pages that look like yours, not ours. Branded pages convert noticeably better."
                cta="Open embed builder"
                onCta={() => go('embed')}
              />
            </div>
            <MilestoneBar
              label="Sticker pack"
              current={maxLoc}
              target={th.stickerPack}
              hint="per location"
            />
            <MilestoneBar label="Gold plaque" current={account} target={th.gold} />
            <MilestoneBar
              label="Platinum plaque"
              current={account}
              target={th.platinum}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {rewards.rewards.map((r) => (
                <div key={r.id} className="vrow-between">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="vrow" style={{ gap: 8 }}>
                      <Gift size={15} />
                      <span>{REWARD_LABELS[r.kind] ?? r.kind}</span>
                      <span
                        className="vbadge"
                        style={r.status === 'delivered' ? { color: 'var(--v-success)' } : undefined}
                      >
                        {REWARD_STATUS[r.status] ?? r.status}
                      </span>
                    </div>
                    {(r.status === 'shipped' || r.status === 'delivered') && r.trackingNumber ? (
                      <span className="vmuted" style={{ fontSize: 12, paddingLeft: 23 }}>
                        Tracking:{' '}
                        <span style={{ fontFamily: 'monospace', color: 'var(--v-ink)' }}>
                          {r.trackingNumber}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  {r.status === 'unlocked' && canEdit ? (
                    <button
                      className="vbtn vbtn-accent vbtn-sm"
                      onClick={() => {
                        setClaiming(r);
                        setAddress(EMPTY_ADDRESS);
                      }}
                    >
                      Claim
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {claiming ? (
        <Modal
          title={`Claim ${REWARD_LABELS[claiming.kind] ?? claiming.kind}`}
          onClose={() => setClaiming(null)}
          width={480}
        >
          <p className="vmuted" style={{ margin: '0 0 14px', fontSize: 13 }}>
            Where should we ship this? We’ll send tracking to your account email once
            it’s on its way.
          </p>
          <div className="vfield">
            <label className="vlabel">Recipient name</label>
            <input
              className="vinput"
              value={address.name}
              autoFocus
              onChange={(e) => setAddress((a) => ({ ...a, name: e.target.value }))}
            />
          </div>
          {/* Google Places autocomplete (proxied via the backend). Filling this
              autofills the fields below; they stay editable for manual tweaks. */}
          <PlacesAddressField
            onPick={(p) =>
              setAddress((a) => ({
                ...a,
                houseNumber: p.houseNumber || a.houseNumber,
                line1: p.line1 || a.line1,
                city: p.city || a.city,
                state: p.state || a.state,
                postcode: p.postcode || a.postcode,
                country: p.country || a.country,
              }))
            }
          />
          <div className="vform-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <div className="vfield">
              <label className="vlabel">House number</label>
              <input
                className="vinput"
                value={address.houseNumber}
                placeholder="12A"
                onChange={(e) => setAddress((a) => ({ ...a, houseNumber: e.target.value }))}
              />
            </div>
            <div className="vfield">
              <label className="vlabel">Street address</label>
              <input
                className="vinput"
                value={address.line1}
                onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
              />
            </div>
          </div>
          <div className="vfield">
            <label className="vlabel">Address line 2</label>
            <input
              className="vinput"
              value={address.line2}
              onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))}
            />
          </div>
          <div className="vform-grid">
            <div className="vfield">
              <label className="vlabel">City</label>
              <input
                className="vinput"
                value={address.city}
                onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
              />
            </div>
            <div className="vfield">
              <label className="vlabel">State</label>
              <input
                className="vinput"
                value={address.state}
                onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
              />
            </div>
            <div className="vfield">
              <label className="vlabel">Postcode</label>
              <input
                className="vinput"
                value={address.postcode}
                onChange={(e) => setAddress((a) => ({ ...a, postcode: e.target.value }))}
              />
            </div>
            <div className="vfield">
              <label className="vlabel">Country</label>
              <input
                className="vinput"
                value={address.country}
                onChange={(e) => setAddress((a) => ({ ...a, country: e.target.value }))}
              />
            </div>
          </div>
          <div className="vfield">
            <label className="vlabel">Phone</label>
            <div className="vrow" style={{ gap: 8 }}>
              <select
                className="vinput"
                style={{ width: 'auto', flexShrink: 0 }}
                value={address.dialCode}
                onChange={(e) => setAddress((a) => ({ ...a, dialCode: e.target.value }))}
              >
                {DIAL_CODES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input
                className="vinput"
                style={{ flex: 1 }}
                inputMode="tel"
                value={address.phone}
                placeholder="400 000 000"
                onChange={(e) => setAddress((a) => ({ ...a, phone: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="vbtn vbtn-quiet" onClick={() => setClaiming(null)}>
              Cancel
            </button>
            <button
              className="vbtn vbtn-primary"
              disabled={
                !address.name.trim() ||
                !address.houseNumber.trim() ||
                !address.line1.trim() ||
                !address.city.trim() ||
                !address.postcode.trim() ||
                !address.country.trim() ||
                claim.isPending
              }
              onClick={submitClaim}
            >
              Claim reward
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Growth-unlock tile: what it is, why you want it, progress until unlocked and
 * a CTA once reached. */
function UnlockTile({
  icon: Icon,
  label,
  current,
  target,
  scope,
  whatItIs,
  whyItMatters,
  cta,
  onCta,
}: {
  icon: LucideIcon;
  label: string;
  current: number;
  target: number;
  scope: string;
  whatItIs: string;
  whyItMatters: string;
  cta: string;
  onCta: () => void;
}) {
  const unlocked = current >= target;
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  return (
    <div
      style={{
        border: '1px solid var(--v-line)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: unlocked ? 'var(--v-card)' : 'var(--v-paper-2)',
      }}
    >
      <div className="vrow-between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div className="vrow" style={{ gap: 8 }}>
          <Icon size={15} style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        </div>
        {unlocked ? (
          <span className="vbadge" style={{ color: 'var(--v-success)' }}>Unlocked</span>
        ) : (
          <span className="vbadge">
            <Lock size={10} />
            Locked
          </span>
        )}
      </div>
      {!unlocked ? (
        <div>
          <div className="vrow-between vmuted" style={{ fontSize: 12 }}>
            <span>{scope}</span>
            <span>
              {num(current)} / {num(target)}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: 'var(--v-line-soft)',
              marginTop: 5,
              overflow: 'hidden',
            }}
          >
            <div
              style={{ height: '100%', width: `${pct}%`, background: 'var(--v-accent)' }}
            />
          </div>
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>What it is.</strong>{' '}
        <span className="vmuted">{whatItIs}</span>
      </p>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>Why you want it.</strong>{' '}
        <span className="vmuted">{whyItMatters}</span>
      </p>
      {unlocked ? (
        <div style={{ marginTop: 'auto' }}>
          <button className="vbtn vbtn-primary vbtn-sm" onClick={onCta}>
            {cta}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MilestoneBar({
  label,
  current,
  target,
  hint,
}: {
  label: string;
  current: number;
  target: number;
  hint?: string;
}) {
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="vrow-between" style={{ fontSize: 13 }}>
        <span>{label}{hint ? <span className="vmuted"> · {hint}</span> : null}</span>
        <span className="vmuted">
          {num(current)} / {num(target)}
        </span>
      </div>
      <div
        style={{
          height: 7,
          borderRadius: 999,
          background: 'var(--v-paper-2)',
          marginTop: 6,
          overflow: 'hidden',
        }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--v-accent)' }} />
      </div>
    </div>
  );
}
