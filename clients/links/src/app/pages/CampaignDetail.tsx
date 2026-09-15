/* C3 — Campaign detail: see what the link serves right now, edit the fallback, and
 * add/edit/remove the scheduled destination windows.
 *
 * "Now serving" and the date preview both come from the SERVER's resolver, not a
 * client re-implementation, so this screen always agrees with the redirector. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon, Seg, StatusPill, Toggle } from '../components';
import { fmtDateTime, num, shortDisplay, shortUrl, validDest } from '../lib';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';
import { useLinkToggle } from '../use-link-toggle';
import { useCanEditLinks } from '../use-can-edit';
import { useLinksInvalidate } from '../use-invalidate';
import { PerformanceCard } from './link-performance';
import type { PageProps } from '../types';
import {
  WindowRows,
  blankWindow,
  toLocalInput,
  windowDraftError,
  type DraftWindow,
} from './campaign-windows';

export function CampaignDetail({ brandId, go, params, entitlement }: PageProps) {
  const trpc = useTRPC();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = useCanEditLinks();
  const campaignId = params.campaignId!;

  const { data: campaign, isLoading } = useQuery(
    trpc.linkCampaigns.byId.queryOptions({ id: campaignId }),
  );

  const { afterCampaignChange: invalidate } = useLinksInvalidate();

  const update = useMutation({
    ...trpc.linkCampaigns.update.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toast('Error: ' + e.message),
  });
  const addWindow = useMutation({
    ...trpc.linkCampaigns.addWindow.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toast('Error: ' + e.message),
  });
  const updateWindow = useMutation({
    ...trpc.linkCampaigns.updateWindow.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toast('Error: ' + e.message),
  });
  const removeWindow = useMutation({
    ...trpc.linkCampaigns.removeWindow.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toast('Error: ' + e.message),
  });
  const remove = useMutation({
    ...trpc.linkCampaigns.remove.mutationOptions(),
    onSuccess: () => {
      // Invalidate BEFORE navigating: the campaigns list is a cached infinite
      // query, so without this the deleted row is still there when we land on it.
      invalidate();
      toast('Campaign deleted.');
      go('campaigns');
    },
    onError: (e) => toast('Error: ' + e.message),
  });
  const { setActive, pending: togglePending } = useLinkToggle(brandId, entitlement);

  /* Fallback editor, seeded from the loaded row. */
  const [fallbackMode, setFallbackMode] = useState<'url' | 'text'>('url');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  const [label, setLabel] = useState('');
  const [fallbackErr, setFallbackErr] = useState<string | null>(null);
  /* Draft rows the user has added but not yet saved (persisted rows are edited
     in place through updateWindow). */
  const [drafts, setDrafts] = useState<DraftWindow[]>([]);
  const seeded = useRef(false);

  useEffect(() => {
    if (campaign && !seeded.current) {
      setLabel(campaign.nickname);
      setFallbackMode(campaign.fallbackText ? 'text' : 'url');
      setFallbackUrl(campaign.destinationUrl ?? '');
      setFallbackText(campaign.fallbackText ?? '');
      seeded.current = true;
    }
  }, [campaign]);

  /* Preview: what does this campaign serve at an arbitrary instant? Runs the same
     server resolver, so it's the real answer rather than a guess.

     Seeded to MIDNIGHT (00:00) local time tomorrow — the same instant
     blankWindow() defaults a new window to, so the field opens on a whole day
     that hasn't started rather than an arbitrary time the user has to clear.
     Still allowed to go empty: clearing a datetime-local yields '', which
     disables the query and shows the hint again. */
  const [previewAt, setPreviewAt] = useState(() => blankWindow().startsAt);
  const { data: preview } = useQuery({
    ...trpc.linkCampaigns.preview.queryOptions({
      id: campaignId,
      at: previewAt ? new Date(previewAt) : new Date(),
    }),
    enabled: !!previewAt,
  });

  /* The saved windows, in editor shape. */
  const persisted = useMemo<DraftWindow[]>(
    () =>
      (campaign?.windows ?? []).map((w) => ({
        id: w.id,
        label: w.label ?? '',
        destinationUrl: w.destinationUrl,
        startsAt: toLocalInput(w.startsAt),
        endsAt: toLocalInput(w.endsAt),
      })),
    [campaign?.windows],
  );

  /* Local edits to saved windows. Held here (not written per keystroke) so typing
     a URL doesn't fire a mutation per character — the user saves each row
     explicitly, and `editedWindows` re-seeds whenever the server data changes. */
  const [editedWindows, setEditedWindows] = useState<DraftWindow[]>([]);
  useEffect(() => {
    setEditedWindows(persisted);
  }, [persisted]);

  /** Rows whose local edits differ from what's saved. */
  const dirtyWindowIds = useMemo(() => {
    const byId = new Map(persisted.map((w) => [w.id, w]));
    return new Set(
      editedWindows
        .filter((w) => {
          const before = byId.get(w.id);
          return (
            before &&
            (w.label !== before.label ||
              w.destinationUrl !== before.destinationUrl ||
              w.startsAt !== before.startsAt ||
              w.endsAt !== before.endsAt)
          );
        })
        .map((w) => w.id),
    );
  }, [editedWindows, persisted]);

  if (isLoading || !campaign) {
    return (
      <div>
        <div className="apage-head">
          <button className="backlink" onClick={() => go('campaigns')}>
            <Icon name="back" size={14} />
            Campaigns
          </button>
          <h1>Campaign</h1>
        </div>
        <div className="skel" style={{ height: 220, borderRadius: 8 }} />
      </div>
    );
  }

  const labelDirty = label.trim() !== campaign.nickname && label.trim().length > 0;
  const fallbackDirty =
    fallbackMode === 'url'
      ? fallbackUrl.trim() !== (campaign.destinationUrl ?? '')
      : fallbackText.trim() !== (campaign.fallbackText ?? '');

  function saveDetails() {
    if (!campaign) return;
    if (fallbackMode === 'url') {
      const err = validDest(fallbackUrl.trim());
      if (err) {
        setFallbackErr(err);
        return;
      }
    } else if (!fallbackText.trim()) {
      setFallbackErr('Add the message visitors should see between windows.');
      return;
    }
    update.mutate(
      {
        id: campaign!.id,
        nickname: labelDirty ? label.trim() : undefined,
        // Send only the chosen mode's field — the server clears the other one, so
        // a campaign is always exactly one of URL / text.
        ...(fallbackMode === 'url'
          ? { fallbackUrl: fallbackUrl.trim() }
          : { fallbackText: fallbackText.trim() }),
      },
      { onSuccess: () => toast('Saved.') },
    );
  }

  /** Persist one edited row that already exists server-side. */
  function saveWindow(w: DraftWindow) {
    const err = windowDraftError(w);
    if (err) {
      toast(err);
      return;
    }
    updateWindow.mutate(
      {
        windowId: w.id!,
        label: w.label.trim() || null,
        destinationUrl: w.destinationUrl.trim(),
        startsAt: new Date(w.startsAt),
        endsAt: new Date(w.endsAt),
      },
      { onSuccess: () => toast('Window updated.') },
    );
  }

  /** Persist a brand-new draft row. */
  function createWindow(w: DraftWindow, draftIndex: number) {
    if (!campaign) return;
    const err = windowDraftError(w);
    if (err) {
      toast(err);
      return;
    }
    addWindow.mutate(
      {
        campaignId: campaign!.id,
        label: w.label.trim() || null,
        destinationUrl: w.destinationUrl.trim(),
        startsAt: new Date(w.startsAt),
        endsAt: new Date(w.endsAt),
      },
      {
        onSuccess: () => {
          setDrafts((ds) => ds.filter((_, j) => j !== draftIndex));
          toast('Window added.');
        },
      },
    );
  }

  const now = campaign.current;

  return (
    <div>
      <div className="apage-head">
        <button className="backlink" onClick={() => go('campaigns')}>
          <Icon name="back" size={14} />
          Campaigns
        </button>
        <h1
          className="slug"
          style={{ fontSize: 22, cursor: 'copy' }}
          title="Click to copy the short link"
          onClick={() => {
            navigator.clipboard?.writeText(shortUrl(campaign.slug));
            toast('Copied ' + shortDisplay(campaign.slug));
          }}
        >
          {shortDisplay(campaign.slug)}
        </h1>
        <span className="spacer" />
        {canEdit ? (
          <Toggle
            on={campaign.isActive}
            disabled={togglePending}
            onChange={(next) => setActive(campaign.id, next, 'campaign')}
          />
        ) : (
          <StatusPill
            on={campaign.isActive}
            disabledAt={campaign.disabledAt}
            createdAt={campaign.createdAt}
          />
        )}
      </div>

      {/* What a visitor gets right now — the single most important fact here.
          `plain` because these are four evenly-weighted cells with no .ajoin
          separators between them; the default .anatomy track list reserves
          content-sized columns for those joins. */}
      <div className="anatomy plain">
        <div className="acell">
          <span className="atag">Now serving</span>
          <b>
            {!now ? (
              <span style={{ color: 'var(--danger)' }}>Nothing configured</span>
            ) : now.type === 'text' ? (
              `Message: ${now.text}`
            ) : (
              now.url
            )}
          </b>
        </div>
        <div className="acell">
          <span className="atag">Source</span>
          <b>
            {campaign.activeWindowId
              ? `Scheduled window${now && now.type === 'redirect' && now.label ? ` · ${now.label}` : ''}`
              : now?.type === 'text'
                ? 'Fallback message'
                : 'Fallback URL'}
          </b>
        </div>
        <div className="acell">
          <span className="atag">Next change</span>
          <b>{campaign.nextChangeAt ? fmtDateTime(campaign.nextChangeAt) : '—'}</b>
        </div>
        <div className="acell">
          <span className="atag">Clicks</span>
          <b>{num(campaign.clickCount)}</b>
        </div>
      </div>

      <div className="detail-grid">
        {/* Fallback + label */}
        <div className="dcard">
          <div className="dh">
            <h2>Between windows</h2>
            <span className="meta">The default when nothing is scheduled</span>
          </div>
          <div
            className="db"
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div className="afield">
              <label>Label</label>
              <input
                className="ainput"
                value={label}
                disabled={!canEdit}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="afield">
              <label>Fallback</label>
              <Seg
                value={fallbackMode}
                options={[
                  { value: 'url', label: 'Send somewhere' },
                  { value: 'text', label: 'Show a message' },
                ]}
                onChange={(v) => {
                  setFallbackMode(v);
                  setFallbackErr(null);
                }}
              />
              {fallbackMode === 'url' ? (
                <input
                  className={'ainput' + (fallbackErr ? ' err' : '')}
                  placeholder="https://example.com/whats-on"
                  value={fallbackUrl}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setFallbackUrl(e.target.value);
                    setFallbackErr(null);
                  }}
                />
              ) : (
                <textarea
                  className={'ainput' + (fallbackErr ? ' err' : '')}
                  style={{ minHeight: 90 }}
                  maxLength={500}
                  placeholder="No promotions available right now — check back soon."
                  value={fallbackText}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setFallbackText(e.target.value);
                    setFallbackErr(null);
                  }}
                />
              )}
              <span
                className="hint"
                style={{ color: fallbackErr ? 'var(--danger)' : undefined }}
              >
                {fallbackErr ??
                  (fallbackMode === 'url'
                    ? 'Visitors are redirected here whenever no window is running.'
                    : 'Shown as a plain page instead of redirecting, whenever no window is running.')}
              </span>
            </div>

            {canEdit && (
              <button
                className="abtn abtn-primary"
                style={{ alignSelf: 'flex-start' }}
                disabled={(!labelDirty && !fallbackDirty) || update.isPending}
                onClick={saveDetails}
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        </div>

        {/* Preview at an arbitrary date */}
        <div className="dcard">
          <div className="dh stack">
            <h2>Preview a date</h2>
            <span className="meta">Check the schedule before it runs</span>
          </div>
          <div className="db" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="ainput"
              type="datetime-local"
              value={previewAt}
              onChange={(e) => setPreviewAt(e.target.value)}
            />
            {!previewAt ? (
              <span className="hint">
                Pick a date and time to see exactly where this link would send
                someone then.
              </span>
            ) : !preview ? (
              <span className="mutetext">Checking…</span>
            ) : !preview.resolution ? (
              <span style={{ color: 'var(--danger)' }}>
                Nothing would be served at that time.
              </span>
            ) : preview.resolution.type === 'text' ? (
              <div>
                <span className="achip" style={{ marginRight: 6 }}>
                  Message
                </span>
                {preview.resolution.text}
              </div>
            ) : (
              /* Chip and URL as a flex row with a min-width:0 text cell: inline
                 they shared a line and the unbreakable URL overflowed the card. */
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span
                  className={'achip' + (preview.activeWindowId ? ' active' : '')}
                  style={{ flexShrink: 0 }}
                >
                  {preview.activeWindowId
                    ? preview.resolution.label || 'Scheduled'
                    : 'Fallback'}
                </span>
                <span className="tdest" style={{ minWidth: 0 }}>
                  {preview.resolution.url}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Windows */}
      <div className="dcard" style={{ marginTop: 22 }}>
        <div className="dh">
          <h2>Scheduled windows</h2>
          <span className="meta">
            {campaign.windows.length} window
            {campaign.windows.length === 1 ? '' : 's'} · latest start wins on overlap
          </span>
        </div>
        <div className="db" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <WindowRows
            windows={editedWindows}
            activeWindowId={campaign.activeWindowId}
            readOnly={!canEdit}
            emptyHint="No windows yet — this campaign always uses its fallback."
            // Edits are local until saved — see editedWindows/dirtyWindowIds.
            onChange={setEditedWindows}
            onRemove={async (w) => {
              if (
                await confirm({
                  title: 'Remove this window?',
                  description:
                    'Those dates will fall back to the campaign default instead.',
                  confirmLabel: 'Remove window',
                  destructive: true,
                })
              ) {
                removeWindow.mutate({ windowId: w.id! });
              }
            }}
          />

          {/* One save per edited row — nothing is written while the user types. */}
          {canEdit && dirtyWindowIds.size > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {editedWindows
                .filter((w) => w.id && dirtyWindowIds.has(w.id))
                .map((w, i) => (
                  <button
                    key={w.id}
                    className="abtn abtn-primary abtn-sm"
                    disabled={updateWindow.isPending}
                    onClick={() => saveWindow(w)}
                  >
                    {updateWindow.isPending
                      ? 'Saving…'
                      : `Save ${w.label.trim() || `window ${i + 1}`}`}
                  </button>
                ))}
              <button
                className="abtn abtn-quiet abtn-sm"
                onClick={() => setEditedWindows(persisted)}
              >
                Discard changes
              </button>
            </div>
          )}

          {canEdit && drafts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="atag">New</span>
              <WindowRows windows={drafts} onChange={setDrafts} />
              <div style={{ display: 'flex', gap: 8 }}>
                {drafts.map((w, i) => (
                  <button
                    key={i}
                    className="abtn abtn-primary abtn-sm"
                    disabled={addWindow.isPending}
                    onClick={() => createWindow(w, i)}
                  >
                    {addWindow.isPending ? 'Adding…' : `Save window ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <button
              className="abtn abtn-quiet abtn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setDrafts((ds) => [...ds, blankWindow()])}
            >
              <Icon name="plus" size={14} />
              Add window
            </button>
          )}
        </div>
      </div>

      {/* Performance — same card as a plain link's detail screen. A campaign IS a
          short_links row, so its clicks are counted and broken down identically. */}
      <div style={{ marginTop: 22 }}>
        <PerformanceCard
          linkId={campaignId}
          emptyHint="No clicks in this window yet — nothing has hit this campaign's link."
        />
      </div>

      {canEdit && (
        <div style={{ marginTop: 22 }}>
          <button
            className="abtn abtn-quiet"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Delete campaign?',
                  description: `${shortDisplay(campaign.slug)} and its ${campaign.windows.length} scheduled window${campaign.windows.length === 1 ? '' : 's'} — this can't be undone.`,
                  confirmLabel: 'Delete',
                  destructive: true,
                })
              ) {
                remove.mutate({ id: campaign.id });
              }
            }}
          >
            <Icon name="trash" size={14} />
            Delete campaign
          </button>
        </div>
      )}
    </div>
  );
}
