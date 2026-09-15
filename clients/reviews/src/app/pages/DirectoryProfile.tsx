/* Verdiict — Directory profile. Controls each location's public directory listing:
 * opt-in, website, description and city, plus a copyable public profile URL and
 * the "Verdiict Verified" badge designer (layout / mode / size / accent, live
 * preview, install snippet). Supports selecting individual locations via chips. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Check, Code2, Copy, ExternalLink, MapPin, RotateCcw } from 'lucide-react';
import { ColorPicker } from '@shared/components/ui/color-picker';
import {
  DEFAULT_BADGE_THEME,
  type ReviewBadgeTheme,
} from '@server/modules/reviews/badge-theme';
import { Seg, Toggle, SkeletonRows } from '../components';
import { badgeEmbedSnippet, badgeUrl } from '../lib';
import type { PageProps } from '../lib';
import { useToast } from '../toast';

const BADGE_VARIANT_HINTS: Record<ReviewBadgeTheme['variant'], string> = {
  card: 'Your name, rating and review count in a bordered card.',
  compact: 'A single-row pill — fits a site header or footer bar.',
  inline: 'Bare text with no card chrome, for running into a sentence.',
  seal: 'A round stamp for hero sections and sidebars.',
};

export function DirectoryProfile(props: PageProps) {
  const { brandId } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: profiles, isLoading } = useQuery(
    trpc.reviews.directory.myProfiles.queryOptions({ brandId }),
  );

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  // Set initial selected location once profiles load
  useEffect(() => {
    if (profiles && profiles.length > 0 && !selectedLocationId) {
      setSelectedLocationId(profiles[0].locationId);
    }
  }, [profiles, selectedLocationId]);

  const activeProfile = useMemo(() => {
    if (!profiles || profiles.length === 0) return null;
    return profiles.find((p) => p.locationId === selectedLocationId) ?? profiles[0];
  }, [profiles, selectedLocationId]);

  const [optIn, setOptIn] = useState(true);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');

  // Sync form state whenever activeProfile changes
  useEffect(() => {
    if (activeProfile) {
      setOptIn(activeProfile.directoryOptIn);
      setWebsiteUrl(activeProfile.websiteUrl ?? '');
      setDescription(activeProfile.description ?? '');
      setCity(activeProfile.city ?? '');
    }
  }, [activeProfile?.locationId]);

  const save = useMutation({
    ...trpc.reviews.directory.updateProfile.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.directory.myProfiles.queryKey() });
      toast('Directory profile saved.');
    },
    onError: (err) => toast(err.message || "Couldn't save your profile."),
  });

  function submit() {
    if (!activeProfile) return;
    save.mutate({
      brandId,
      locationId: activeProfile.locationId,
      directoryOptIn: optIn,
      websiteUrl: websiteUrl.trim() || null,
      description: description.trim() || null,
      city: city.trim() || null,
    });
  }

  const publicUrl = activeProfile ? window.location.origin + activeProfile.profileUrl : '';

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast('Profile URL copied.');
    } catch {
      toast("Couldn't copy the URL.");
    }
  }

  // "Verdiict Verified" badge — served by the API as an embeddable iframe
  const [badge, setBadge] = useState<ReviewBadgeTheme>(DEFAULT_BADGE_THEME);
  const [debouncedBadge, setDebouncedBadge] = useState(badge);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBadge(badge), 300);
    return () => clearTimeout(t);
  }, [badge]);

  const previewSrc = activeProfile
    ? badgeUrl(activeProfile.brandSlug, activeProfile.locationSlug, debouncedBadge)
    : '';
  const badgeSnippet = useMemo(
    () =>
      activeProfile
        ? badgeEmbedSnippet(activeProfile.brandSlug, activeProfile.locationSlug, badge)
        : '',
    [activeProfile, badge],
  );
  const [badgeCopied, setBadgeCopied] = useState(false);
  const isDefaultBadge = useMemo(
    () =>
      (Object.keys(DEFAULT_BADGE_THEME) as Array<keyof ReviewBadgeTheme>).every(
        (k) => badge[k] === DEFAULT_BADGE_THEME[k],
      ),
    [badge],
  );

  function setBadgeOpt<K extends keyof ReviewBadgeTheme>(key: K, value: ReviewBadgeTheme[K]) {
    setBadge((prev) => ({ ...prev, [key]: value }));
  }

  const previewRef = useRef<HTMLIFrameElement | null>(null);
  const [previewHeight, setPreviewHeight] = useState(140);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as { type?: string; height?: number } | null;
      if (!msg || msg.type !== 'pm:resize' || typeof msg.height !== 'number') return;
      if (previewRef.current && e.source !== previewRef.current.contentWindow) return;
      setPreviewHeight(Math.max(40, Math.ceil(msg.height)));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function copyBadge() {
    try {
      await navigator.clipboard.writeText(badgeSnippet);
      setBadgeCopied(true);
      setTimeout(() => setBadgeCopied(false), 2000);
    } catch {
      toast("Couldn't copy the embed code.");
    }
  }

  if (isLoading || !profiles || !activeProfile) {
    return (
      <>
        <div className="vpagehead">
          <h1>Directory profile</h1>
        </div>
        <SkeletonRows />
      </>
    );
  }

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Directory profile</h1>
          <p>Manage public directory listing and embed badges for your locations.</p>
        </div>
        <div>
          <button className="vbtn vbtn-primary" disabled={save.isPending} onClick={submit}>
            Save
          </button>
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="vcard" style={{ marginBottom: 16 }}>
          <div className="vlabel" style={{ marginBottom: 8, display: 'block', fontWeight: 600 }}>
            Select Location
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {profiles.map((p) => {
              const isSelected = p.locationId === activeProfile.locationId;
              // Listing is per location, so one location can be public while
              // another is hidden — say which is which before it's selected.
              const hidden = !p.directoryOptIn;
              return (
                <button
                  key={p.locationId}
                  type="button"
                  onClick={() => setSelectedLocationId(p.locationId)}
                  className={`vbtn vbtn-sm ${isSelected ? 'vbtn-primary' : 'vbtn-quiet'}`}
                  style={{
                    borderRadius: 9999,
                    gap: 6,
                    ...(hidden && !isSelected ? { opacity: 0.6 } : null),
                  }}
                >
                  <MapPin size={14} />
                  <span>{p.locationName}</span>
                  {hidden && <span style={{ fontSize: 11, opacity: 0.8 }}>· hidden</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="vcard" style={{ marginBottom: 16 }}>
        <div className="vrow-between">
          <div>
            <div className="vlabel" style={{ marginBottom: 2 }}>Public profile URL ({activeProfile.locationName})</div>
            <div className="vmuted mono" style={{ fontSize: 13 }}>{publicUrl}</div>
            {!optIn && (
              <div className="vhint" style={{ marginTop: 4 }}>
                This location is hidden from the directory, so the URL won't resolve
                until you list it below.
              </div>
            )}
          </div>
          <div className="vrow" style={{ gap: 8 }}>
            <button className="vbtn vbtn-quiet vbtn-sm" onClick={copyUrl}>
              <Copy size={14} />
              Copy
            </button>
            <a
              className="vbtn vbtn-quiet vbtn-sm"
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              View
            </a>
          </div>
        </div>
      </div>

      <div className="vcard" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="vrow-between">
          <div>
            <span className="vlabel" style={{ marginBottom: 2 }}>List in the directory</span>
            <div className="vhint" style={{ marginTop: 0 }}>
              When off, this location is hidden from public directory search.
            </div>
          </div>
          <Toggle on={optIn} onChange={setOptIn} />
        </div>

        <div className="vfield" style={{ marginBottom: 0 }}>
          <label className="vlabel">Website</label>
          <input
            className="vinput"
            value={websiteUrl}
            placeholder="https://example.com"
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>

        <div className="vfield" style={{ marginBottom: 0 }}>
          <label className="vlabel">Description</label>
          <textarea
            className="vtextarea"
            value={description}
            placeholder="Tell customers what this location does."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="vfield" style={{ marginBottom: 0 }}>
          <label className="vlabel">City</label>
          <input
            className="vinput"
            value={city}
            placeholder="Sydney"
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
      </div>

      {optIn ? (
        <div className="vcard" style={{ marginTop: 16 }}>
          <div className="vrow-between">
            <div className="vrow" style={{ gap: 8 }}>
              <Code2 size={14} />
              <span className="vlabel" style={{ marginBottom: 0 }}>
                Verdiict Verified badge ({activeProfile.locationName})
              </span>
            </div>
            <button
              className="vbtn vbtn-quiet vbtn-sm"
              disabled={isDefaultBadge}
              onClick={() => setBadge(DEFAULT_BADGE_THEME)}
            >
              <RotateCcw size={14} />
              Reset
            </button>
          </div>
          <div className="vhint" style={{ marginTop: 4 }}>
            Design it to fit your site, then paste the snippet anywhere. The rating and
            review count update automatically.
          </div>

          <div className="vgrid cols-2" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="vfield" style={{ marginBottom: 0 }}>
                <label className="vlabel">Layout</label>
                <Seg
                  value={badge.variant}
                  onChange={(v) => setBadgeOpt('variant', v)}
                  options={[
                    { value: 'card', label: 'Card' },
                    { value: 'compact', label: 'Compact' },
                    { value: 'inline', label: 'Inline' },
                    { value: 'seal', label: 'Seal' },
                  ]}
                />
                <div className="vhint">{BADGE_VARIANT_HINTS[badge.variant]}</div>
              </div>

              <div className="vfield" style={{ marginBottom: 0 }}>
                <label className="vlabel">Colour mode</label>
                <Seg
                  value={badge.mode}
                  onChange={(v) => setBadgeOpt('mode', v)}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'auto', label: 'Auto' },
                  ]}
                />
                {badge.mode === 'auto' ? (
                  <div className="vhint">Follows each visitor's system theme.</div>
                ) : null}
              </div>

              <div className="vfield" style={{ marginBottom: 0 }}>
                <label className="vlabel">Size</label>
                <Seg
                  value={badge.size}
                  onChange={(v) => setBadgeOpt('size', v)}
                  options={[
                    { value: 'sm', label: 'Small' },
                    { value: 'md', label: 'Medium' },
                    { value: 'lg', label: 'Large' },
                  ]}
                />
              </div>

              <div className="vfield" style={{ marginBottom: 0 }}>
                <label className="vlabel">Alignment</label>
                <Seg
                  value={badge.align}
                  onChange={(v) => setBadgeOpt('align', v)}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Center' },
                  ]}
                />
              </div>

              <div className="vrow-between">
                <div>
                  <span className="vlabel" style={{ marginBottom: 0 }}>Use your logo</span>
                  <div className="vhint" style={{ marginTop: 0 }}>
                    {activeProfile.logoUrl
                      ? 'Off shows the Verdiict checkmark instead.'
                      : 'Add a brand logo in your brand settings to use it here.'}
                  </div>
                </div>
                <Toggle
                  on={badge.showLogo}
                  disabled={!activeProfile.logoUrl}
                  onChange={(v) => setBadgeOpt('showLogo', v)}
                />
              </div>
              <div className="vrow-between">
                <div>
                  <span className="vlabel" style={{ marginBottom: 0 }}>Accent colour</span>
                  <div className="vhint" style={{ marginTop: 0 }}>
                    Tints the seal ring and the checkmark fallback.
                  </div>
                </div>
                <ColorPicker
                  ariaLabel="Badge accent colour"
                  value={badge.accentColor}
                  onChange={(v) => setBadgeOpt('accentColor', v)}
                />
              </div>
              <div className="vrow-between">
                <span className="vlabel" style={{ marginBottom: 0 }}>Show stars</span>
                <Toggle on={badge.showStars} onChange={(v) => setBadgeOpt('showStars', v)} />
              </div>
              <div className="vrow-between">
                <span className="vlabel" style={{ marginBottom: 0 }}>Show review count</span>
                <Toggle on={badge.showCount} onChange={(v) => setBadgeOpt('showCount', v)} />
              </div>
              <div className="vrow-between">
                <div>
                  <span className="vlabel" style={{ marginBottom: 0 }}>
                    Show "Best in industry"
                  </span>
                  <div className="vhint" style={{ marginTop: 0 }}>
                    Only appears while you rank top 3 in your industry.
                  </div>
                </div>
                <Toggle on={badge.showBest} onChange={(v) => setBadgeOpt('showBest', v)} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="veyebrow" style={{ marginBottom: 8 }}>Live preview</div>
                <div
                  style={{
                    background: 'var(--v-paper-2)',
                    borderRadius: 'var(--v-radius)',
                    padding: 20,
                  }}
                >
                  <iframe
                    key={previewSrc}
                    ref={previewRef}
                    src={previewSrc}
                    scrolling="no"
                    style={{
                      display: 'block',
                      width: '100%',
                      height: previewHeight,
                      border: 'none',
                      overflow: 'hidden',
                    }}
                    title="Verdiict Verified badge preview"
                  />
                </div>
              </div>

              <div>
                <div className="veyebrow" style={{ marginBottom: 8 }}>Embed code</div>
                <textarea
                  className="vtextarea mono"
                  readOnly
                  value={badgeSnippet}
                  style={{ fontSize: 12, minHeight: 128 }}
                />
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  style={{ marginTop: 10 }}
                  onClick={copyBadge}
                >
                  {badgeCopied ? (
                    <Check size={14} style={{ color: 'var(--v-success)' }} />
                  ) : (
                    <Copy size={14} />
                  )}
                  {badgeCopied ? 'Copied' : 'Copy embed code'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
