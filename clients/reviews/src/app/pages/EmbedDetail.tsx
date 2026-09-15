/* Verdiict — Embed designer for a single location. Edits the theme locally,
 * shows a live (debounced) iframe preview rendered server-side, and installs via
 * a copyable snippet. Branded controls + saving are gated by review counts. */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { ArrowLeft, Copy, Lock, Loader2 } from 'lucide-react';
import type { ReviewEmbedTheme } from '@server/modules/reviews/embed';
import { ColorPicker } from '@shared/components/ui/color-picker';
import { Seg, Toggle, SkeletonRows } from '../components';
import { embedSnippet } from '../lib';
import type { PageProps } from '../lib';
import { useToast } from '../toast';

export function EmbedDetail(props: PageProps) {
  const { go, params } = props;
  const locationId = params.id!;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery(
    trpc.reviews.embed.getForLocation.queryOptions({ locationId }),
  );

  const [theme, setTheme] = useState<ReviewEmbedTheme | null>(null);
  useEffect(() => {
    if (data && !theme) setTheme(data.theme);
  }, [data, theme]);

  // Debounce theme → preview query input so we re-render at most ~every 400ms.
  const [debounced, setDebounced] = useState<ReviewEmbedTheme | null>(null);
  useEffect(() => {
    if (!theme) return;
    const t = setTimeout(() => setDebounced(theme), 400);
    return () => clearTimeout(t);
  }, [theme]);

  const { data: preview, isFetching: previewFetching } = useQuery({
    ...trpc.reviews.embed.preview.queryOptions({ locationId, theme: debounced }),
    enabled: !!debounced,
    // Keep the last render on screen while the next one loads so the live preview
    // updates in place instead of flashing back to a skeleton on every tweak.
    placeholderData: (prev) => prev,
  });
  // True while a design change is being re-previewed but we're still showing the
  // previous render (placeholderData). Drives the corner spinner below.
  const previewRefreshing = previewFetching && !!preview;

  const save = useMutation({
    ...trpc.reviews.embed.save.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.embed.getForLocation.queryKey() });
      toast('Embed saved.');
    },
    onError: (err) => toast(err.message || "Couldn't save the embed."),
  });

  const snippet = useMemo(() => (data ? embedSnippet(data.slug) : ''), [data]);

  function set<K extends keyof ReviewEmbedTheme>(key: K, value: ReviewEmbedTheme[K]) {
    setTheme((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast('Snippet copied.');
    } catch {
      toast("Couldn't copy the snippet.");
    }
  }

  if (isLoading || !data || !theme) {
    return (
      <>
        <div className="vpagehead">
          <h1>Embed designer</h1>
        </div>
        <SkeletonRows />
      </>
    );
  }

  const brandedUnlocked = data.brandedUnlocked;
  const embedUnlocked = data.embedUnlocked;
  const reviewsToUnlock = Math.max(0, data.unlockThresholds.embed - data.accountReviews);
  const brandedToUnlock = Math.max(0, data.unlockThresholds.branded - data.locationReviews);
  const unlockPct = Math.min(
    100,
    data.unlockThresholds.embed > 0
      ? (data.accountReviews / data.unlockThresholds.embed) * 100
      : 0,
  );

  return (
    <>
      <div className="vpagehead">
        <div>
          <button className="vbtn vbtn-quiet vbtn-sm" onClick={() => go('embed')}>
            <ArrowLeft size={14} />
            Embeds
          </button>
          <h1 style={{ marginTop: 8 }}>{data.locationName}</h1>
          <p>Design your review embed and copy the install snippet.</p>
        </div>
        <div>
          <button
            className="vbtn vbtn-primary"
            disabled={!embedUnlocked || save.isPending}
            onClick={() => save.mutate({ locationId, theme })}
          >
            {embedUnlocked ? 'Save' : `Save unlocks in ${reviewsToUnlock}`}
          </button>
          {!embedUnlocked ? (
            <div className="vhint" style={{ textAlign: 'right' }}>
              Tweak as much as you like — your choices stay in this preview until you hit{' '}
              {data.unlockThresholds.embed} reviews.
            </div>
          ) : null}
        </div>
      </div>

      <div className="vgrid cols-2">
        <div className="vcard" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label className="vlabel">Layout</label>
            <Seg
              value={theme.variant}
              onChange={(v) => set('variant', v)}
              options={[
                { value: 'carousel', label: 'Carousel' },
                { value: 'wall', label: 'Wall' },
                { value: 'marquee', label: 'Marquee' },
                { value: 'hero', label: 'Hero' },
              ]}
            />
          </div>

          <div className="vrow-between">
            <span className="vlabel" style={{ marginBottom: 0 }}>Dark mode</span>
            <Toggle on={!!theme.dark} onChange={(v) => set('dark', v)} />
          </div>
          <div className="vrow-between">
            <span className="vlabel" style={{ marginBottom: 0 }}>Show win tags</span>
            <Toggle on={!!theme.showWinTags} onChange={(v) => set('showWinTags', v)} />
          </div>
          <div className="vrow-between">
            <span className="vlabel" style={{ marginBottom: 0 }}>Show star count</span>
            <Toggle on={!!theme.showStarCount} onChange={(v) => set('showStarCount', v)} />
          </div>
          <div className="vrow-between">
            <span className="vlabel" style={{ marginBottom: 0 }}>Five-star only</span>
            <Toggle on={!!theme.onlyFiveStar} onChange={(v) => set('onlyFiveStar', v)} />
          </div>

          <div className="vfield" style={{ marginBottom: 0 }}>
            <label className="vlabel">Density</label>
            <Seg
              value={theme.density ?? 'cozy'}
              onChange={(v) => set('density', v)}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'cozy', label: 'Cozy' },
                { value: 'comfortable', label: 'Comfortable' },
              ]}
            />
          </div>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label className="vlabel">Corners</label>
            <Seg
              value={theme.radius ?? 'soft'}
              onChange={(v) => set('radius', v)}
              options={[
                { value: 'sharp', label: 'Sharp' },
                { value: 'soft', label: 'Soft' },
                { value: 'round', label: 'Round' },
              ]}
            />
          </div>

          <div
            style={{
              borderTop: '1px solid var(--v-line)',
              paddingTop: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div className="veyebrow">Branded</div>
            {!brandedUnlocked ? (
              <div className="vhint" style={{ marginTop: 0 }}>
                Tweak freely — branded settings preview now and persist once you capture{' '}
                {brandedToUnlock} more {brandedToUnlock === 1 ? 'review' : 'reviews'} on this
                location ({data.locationReviews} / {data.unlockThresholds.branded}). Until
                then, saves drop branding back to defaults.
              </div>
            ) : null}
            <div className="vfield" style={{ marginBottom: 0 }}>
              <label className="vlabel">Font</label>
              <select
                className="vselect"
                value={theme.fontFamily ?? 'geist'}
                onChange={(e) =>
                  set('fontFamily', e.target.value as ReviewEmbedTheme['fontFamily'])
                }
              >
                <option value="geist">Geist</option>
                <option value="inter">Inter</option>
                <option value="system">System</option>
                <option value="playfair">Playfair</option>
                <option value="dm-sans">DM Sans</option>
              </select>
            </div>
            <div className="vrow-between">
              <span className="vlabel" style={{ marginBottom: 0 }}>Accent color</span>
              <ColorPicker
                ariaLabel="Accent color"
                // Default tracks the mode (black on light, white on dark) so it
                // matches the live preview's fallback until an explicit pick.
                value={theme.accentColor ?? (theme.dark ? '#ffffff' : '#000000')}
                onChange={(v) => set('accentColor', v)}
              />
            </div>
            <div className="vrow-between">
              <span className="vlabel" style={{ marginBottom: 0 }}>Show logo</span>
              <Toggle on={!!theme.showLogo} onChange={(v) => set('showLogo', v)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="vcard" style={{ position: 'relative' }}>
            <div className="vrow-between" style={{ marginBottom: 10 }}>
              <div className="veyebrow">Live preview</div>
              {/* Spinner while a design change is being re-rendered — the old
                  preview stays visible underneath so it never flashes blank. */}
              {previewRefreshing ? (
                <Loader2
                  size={15}
                  className="animate-spin"
                  style={{ color: 'var(--v-muted)' }}
                  aria-label="Updating preview"
                />
              ) : null}
            </div>
            {preview?.sampleReviews ? (
              <div className="vhint" style={{ marginTop: 0, marginBottom: 10 }}>
                Sample reviews · replaced with your real ones once captured
              </div>
            ) : null}
            {preview?.html ? (
              <iframe
                title="Embed preview"
                srcDoc={preview.html}
                style={{ width: '100%', height: 420, border: 0 }}
              />
            ) : (
              <div className="vskel" style={{ height: 420, width: '100%' }} />
            )}
          </div>

          {embedUnlocked ? (
            <div className="vcard">
              <div className="veyebrow" style={{ marginBottom: 10 }}>Install snippet</div>
              <textarea
                className="vtextarea mono"
                readOnly
                value={snippet}
                style={{ fontSize: 12, minHeight: 130 }}
              />
              <button className="vbtn vbtn-quiet vbtn-sm" style={{ marginTop: 10 }} onClick={copySnippet}>
                <Copy size={14} />
                Copy snippet
              </button>
            </div>
          ) : (
            <div
              className="vcard"
              style={{ textAlign: 'center', borderStyle: 'dashed', padding: '22px 18px' }}
            >
              <Lock size={18} style={{ opacity: 0.55 }} />
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>
                Install snippet locked
              </div>
              <div className="vhint" style={{ marginTop: 4 }}>
                Capture {reviewsToUnlock} more {reviewsToUnlock === 1 ? 'review' : 'reviews'}{' '}
                account-wide and the install code appears here.
              </div>
              <div
                style={{
                  height: 7,
                  borderRadius: 999,
                  background: 'var(--v-paper-2)',
                  margin: '12px auto 0',
                  maxWidth: 280,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${unlockPct}%`,
                    background: 'var(--v-accent)',
                  }}
                />
              </div>
              <div className="vmuted mono" style={{ fontSize: 12, marginTop: 8 }}>
                {data.accountReviews} / {data.unlockThresholds.embed}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
