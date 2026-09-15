/* Verdiict — Collection designer. Edits name + membership and the (always
 * branded-unlocked) theme. The live preview renders the UNSAVED draft via
 * reviews.collections.preview (debounced) and seeds sample reviews when none
 * are captured. Collections are not review-gated — the public embed URL and
 * install snippet work from the start. Owner can delete. */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { ArrowLeft, Copy, Loader2, Trash2 } from 'lucide-react';
import type { ReviewEmbedTheme } from '@server/modules/reviews/embed';
import { ColorPicker } from '@shared/components/ui/color-picker';
import { Seg, Toggle, SkeletonRows } from '../components';
import { collectionEmbedSnippet } from '../lib';
import type { PageProps } from '../lib';
import { useConfirm } from '../confirm';
import { useToast } from '../toast';

export function CollectionDetail(props: PageProps) {
  const { brandId, go, params, canEdit } = props;
  const id = params.id!;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: detail, isLoading } = useQuery(
    trpc.reviews.collections.detail.queryOptions({ brandId, id }),
  );
  const { data: locations } = useQuery(
    trpc.reviews.locations.list.queryOptions({ brandId }),
  );

  const [name, setName] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<ReviewEmbedTheme | null>(null);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (detail && !seeded) {
      setName(detail.name);
      setLocationIds(detail.locationIds);
      setTheme(detail.theme);
      setSeeded(true);
    }
  }, [detail, seeded]);

  const update = useMutation({
    ...trpc.reviews.collections.update.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.collections.detail.queryKey() });
      // The embeds index lists collections by name — reflect renames there too.
      qc.invalidateQueries({ queryKey: trpc.reviews.collections.list.queryKey() });
      toast('Collection saved.');
    },
    onError: (err) => toast(err.message || "Couldn't save the collection."),
  });

  const remove = useMutation({
    ...trpc.reviews.collections.remove.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.collections.list.queryKey() });
      toast('Collection deleted.');
      go('embed');
    },
    onError: (err) => toast(err.message || "Couldn't delete the collection."),
  });

  const snippet = useMemo(
    () => (detail ? collectionEmbedSnippet(detail.slug) : ''),
    [detail],
  );

  // Live draft preview — debounce the unsaved theme + membership so each tweak
  // doesn't fire a render round-trip.
  const [debounced, setDebounced] = useState<{
    theme: ReviewEmbedTheme;
    locationIds: string[];
  } | null>(null);
  useEffect(() => {
    if (!theme) return;
    const t = setTimeout(() => setDebounced({ theme, locationIds }), 400);
    return () => clearTimeout(t);
  }, [theme, locationIds]);

  const preview = useQuery({
    ...trpc.reviews.collections.preview.queryOptions({
      brandId,
      id,
      theme: debounced?.theme,
      locationIds: debounced?.locationIds,
    }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
  });

  function set<K extends keyof ReviewEmbedTheme>(key: K, value: ReviewEmbedTheme[K]) {
    setTheme((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleLocation(locId: string) {
    setLocationIds((prev) =>
      prev.includes(locId) ? prev.filter((x) => x !== locId) : prev.concat([locId]),
    );
  }

  function submit() {
    if (!theme) return;
    update.mutate({ brandId, id, name: name.trim(), locationIds, theme });
  }

  async function handleDelete() {
    if (!detail) return;
    const ok = await confirm({
      title: `Delete collection ${detail.name}?`,
      description: 'The embed URL will stop working.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate({ brandId, id });
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast('Snippet copied.');
    } catch {
      toast("Couldn't copy the snippet.");
    }
  }

  if (isLoading || !detail || !theme) {
    return (
      <>
        <div className="vpagehead">
          <h1>Collection</h1>
        </div>
        <SkeletonRows />
      </>
    );
  }

  return (
    <>
      <div className="vpagehead">
        <div>
          <button className="vbtn vbtn-quiet vbtn-sm" onClick={() => go('embed')}>
            <ArrowLeft size={14} />
            Embeds
          </button>
          <h1 style={{ marginTop: 8 }}>{detail.name}</h1>
          <p>Combine several locations into one review wall.</p>
        </div>
        {canEdit ? (
          <div className="vrow" style={{ gap: 8 }}>
            <button
              className="vbtn vbtn-danger vbtn-sm"
              disabled={remove.isPending}
              onClick={handleDelete}
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button className="vbtn vbtn-primary" disabled={update.isPending} onClick={submit}>
              Save
            </button>
          </div>
        ) : (
          <span className="vhint">You have view-only access — changes here won't save.</span>
        )}
      </div>

      <div className="vgrid cols-2">
        <div className="vcard" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label className="vlabel">Collection name</label>
            <input
              className="vinput"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="vfield" style={{ marginBottom: 0 }}>
            <label className="vlabel">Locations</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(locations ?? []).map((loc) => (
                <label key={loc.id} className="vrow" style={{ gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={locationIds.includes(loc.id)}
                    onChange={() => toggleLocation(loc.id)}
                  />
                  <span>{loc.name}</span>
                </label>
              ))}
            </div>
          </div>

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
              value={theme.accentColor ?? (theme.dark ? '#ffffff' : '#000000')}
              onChange={(v) => set('accentColor', v)}
            />
          </div>
          <div className="vrow-between">
            <span className="vlabel" style={{ marginBottom: 0 }}>Show logo</span>
            <Toggle on={!!theme.showLogo} onChange={(v) => set('showLogo', v)} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="vcard">
            <div className="veyebrow" style={{ marginBottom: 10 }}>Live preview</div>
            {preview.data ? (
              <>
                <iframe
                  title="Collection preview"
                  srcDoc={preview.data.html}
                  style={{ width: '100%', height: 420, border: 0 }}
                />
                {preview.data.sampleReviews && (
                  <div className="vhint">
                    Sample reviews · replaced with your real ones once captured.
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 420,
                }}
              >
                <Loader2 size={18} className="animate-spin" style={{ color: 'var(--v-muted)' }} />
              </div>
            )}
          </div>

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
        </div>
      </div>
    </>
  );
}
