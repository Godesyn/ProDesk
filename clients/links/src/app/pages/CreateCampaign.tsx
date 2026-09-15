/* C2 — New campaign: pick a slug, set the fallback (URL or message), and schedule
 * as many destination windows as you like before creating.
 *
 * Created INACTIVE and free, exactly like a plain link — switching it on from the
 * Campaigns list is what starts the monthly charge. */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@shared/lib/trpc';
import { Icon, Seg } from '../components';
import { autoSlug, money, shortDisplay, slugProblem, validDest } from '../lib';
import { useToast } from '../toast';
import { useLinksInvalidate } from '../use-invalidate';
import type { PageProps } from '../types';
import { WindowRows, type DraftWindow, blankWindow, windowDraftError } from './campaign-windows';

type SlugStatus = 'checking' | 'ok' | string | null;
type FallbackMode = 'url' | 'text';

export function CreateCampaign({ brandId, go }: PageProps) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const { afterCampaignChange: invalidate } = useLinksInvalidate();
  const toast = useToast();

  const { data: pricing } = useQuery(
    trpc.linkCampaigns.pricing.queryOptions({ brandId }),
  );
  const { data: defaultQr } = useQuery(
    trpc.shortLinks.defaultQrConfig.queryOptions({ brandId }),
  );

  const autoRef = useRef<string | null>(null);
  if (autoRef.current === null) autoRef.current = autoSlug([]);

  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'auto' | 'custom'>('auto');
  const [custom, setCustom] = useState('');
  const [customStatus, setCustomStatus] = useState<SlugStatus>(null);
  const [fallbackMode, setFallbackMode] = useState<FallbackMode>('url');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  const [fallbackErr, setFallbackErr] = useState<string | null>(null);
  const [windows, setWindows] = useState<DraftWindow[]>([]);
  const [saving, setSaving] = useState(false);

  const localSlugIssue = mode === 'custom' ? slugProblem(custom, []) : null;

  /* Debounced server-side slug availability check — campaigns share one slug
     namespace with plain links, so this is the same check the link form runs. */
  useEffect(() => {
    if (mode !== 'custom' || !custom || localSlugIssue) {
      setCustomStatus(localSlugIssue || null);
      return;
    }
    setCustomStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await trpcClient.shortLinks.checkSlug.query({ slug: custom });
        setCustomStatus(res.available ? 'ok' : res.reason || 'Not available');
      } catch {
        setCustomStatus('Could not check availability');
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom, mode]);

  const slugOk = mode === 'auto' || (!!custom && customStatus === 'ok');
  const create = useMutation(trpc.linkCampaigns.create.mutationOptions());

  async function submit() {
    if (!label.trim()) {
      toast('Add a label so you can recognise this campaign.');
      return;
    }
    if (!slugOk) return;

    // Exactly one fallback mode, validated for the mode actually chosen.
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

    // Validate every window before sending — a rejected row mid-insert would
    // leave the user re-entering the whole schedule.
    for (const [i, w] of windows.entries()) {
      const err = windowDraftError(w);
      if (err) {
        toast(`Window ${i + 1}: ${err}`);
        return;
      }
    }

    setSaving(true);
    try {
      const row = await create.mutateAsync({
        brandId,
        slug: mode === 'custom' ? custom : autoRef.current!,
        nickname: label.trim(),
        ...(fallbackMode === 'url'
          ? { fallbackUrl: fallbackUrl.trim() }
          : { fallbackText: fallbackText.trim() }),
        windows: windows.map((w) => ({
          label: w.label.trim() || null,
          destinationUrl: w.destinationUrl.trim(),
          startsAt: new Date(w.startsAt),
          endsAt: new Date(w.endsAt),
        })),
        qrConfig: defaultQr ?? undefined,
      });
      invalidate();
      toast('Campaign created.');
      go('campaignDetail', { campaignId: row.id });
    } catch (e) {
      toast('Error: ' + (e instanceof Error ? e.message : 'Could not create campaign'));
    } finally {
      setSaving(false);
    }
  }

  const customErr =
    custom && customStatus && customStatus !== 'ok' && customStatus !== 'checking';
  const rate =
    pricing?.unitAmount != null ? money(pricing.unitAmount, pricing.currency) : null;

  return (
    <div>
      <div className="apage-head">
        <button className="backlink" onClick={() => go('campaigns')}>
          <Icon name="back" size={14} />
          Campaigns
        </button>
        <h1>New campaign</h1>
      </div>

      <div className="abanner">
        <span className="bt">Created switched off.</span>
        <span className="bs">
          Campaigns are free to build. Switching one on is what starts billing
          {rate ? ` — ${rate}/month while it's live` : ''}, and switching it off
          stops the charge.
        </span>
      </div>

      <div className="detail-grid">
        <div className="dcard">
          <div
            className="db"
            style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            <div className="afield">
              <label>Label</label>
              <input
                className="ainput"
                placeholder="Front-window poster · seasonal promos"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <span className="hint">
                A name only you see, so you can find this campaign later.
              </span>
            </div>

            <div className="afield">
              <label>Ending</label>
              <Seg
                value={mode}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: 'custom', label: 'Custom ending' },
                ]}
                onChange={setMode}
              />
              {mode === 'auto' ? (
                <span className="hint">
                  You will get{' '}
                  <span className="slug" style={{ color: 'var(--ink)' }}>
                    {shortDisplay(autoRef.current!)}
                  </span>
                </span>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="slug" style={{ fontSize: 13, color: 'var(--ink-60)' }}>
                      {shortDisplay('')}
                    </span>
                    <input
                      className={'ainput mono' + (customErr ? ' err' : '')}
                      style={{ maxWidth: 220 }}
                      placeholder="promo"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value.toLowerCase())}
                    />
                  </div>
                  <span
                    className="hint"
                    style={{
                      color:
                        custom && customStatus === 'ok'
                          ? 'var(--adeyy-ink)'
                          : customErr
                            ? 'var(--danger)'
                            : undefined,
                    }}
                  >
                    {!custom
                      ? 'Lowercase letters, numbers and hyphens. This is the code you print — it never changes.'
                      : customStatus === 'checking'
                        ? 'Checking availability…'
                        : customStatus === 'ok'
                          ? 'Available.'
                          : customStatus || ''}
                  </span>
                </>
              )}
            </div>

            <div className="afield">
              <label>Between windows</label>
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
                <>
                  <input
                    className={'ainput' + (fallbackErr ? ' err' : '')}
                    placeholder="https://example.com/whats-on"
                    value={fallbackUrl}
                    onChange={(e) => {
                      setFallbackUrl(e.target.value);
                      setFallbackErr(null);
                    }}
                  />
                  <span
                    className="hint"
                    style={{ color: fallbackErr ? 'var(--danger)' : undefined }}
                  >
                    {fallbackErr ??
                      'Where visitors go when no scheduled window is running — your "nothing on right now" page.'}
                  </span>
                </>
              ) : (
                <>
                  <textarea
                    className={'ainput' + (fallbackErr ? ' err' : '')}
                    style={{ minHeight: 90 }}
                    placeholder="No promotions available right now — check back soon."
                    maxLength={500}
                    value={fallbackText}
                    onChange={(e) => {
                      setFallbackText(e.target.value);
                      setFallbackErr(null);
                    }}
                  />
                  <span
                    className="hint"
                    style={{ color: fallbackErr ? 'var(--danger)' : undefined }}
                  >
                    {fallbackErr ??
                      'Shown as a plain page instead of redirecting, when no window is running. Up to 500 characters.'}
                  </span>
                </>
              )}
            </div>

            <div className="afield">
              <label>Scheduled windows</label>
              <span className="hint" style={{ marginBottom: 6 }}>
                While a window is running, the link sends visitors there instead of
                the fallback. Add as many as you need — you can also add them later.
              </span>
              <WindowRows
                windows={windows}
                onChange={setWindows}
                emptyHint="No windows yet — this campaign will always use the fallback above."
              />
              <button
                className="abtn abtn-quiet abtn-sm"
                style={{ alignSelf: 'flex-start', marginTop: 8 }}
                onClick={() => setWindows((ws) => [...ws, blankWindow()])}
              >
                <Icon name="plus" size={14} />
                Add window
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="abtn abtn-primary abtn-lg"
                onClick={submit}
                disabled={saving}
              >
                {saving ? 'Creating…' : 'Create campaign'}
              </button>
              <button className="abtn abtn-quiet" onClick={() => go('campaigns')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
