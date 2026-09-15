/* L2 — Create link. Live slug check + create via the shortLinks router. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@shared/lib/trpc';
import { Icon, Seg, QrPreview } from '../components';
import { autoSlug, shortDisplay, slugProblem, validDest } from '../lib';
import { useToast } from '../toast';
import { useLinksInvalidate } from '../use-invalidate';
import type { PageProps } from '../types';

type SlugStatus = null | 'checking' | 'ok' | string;

export function CreateLink({ brandId, go }: PageProps) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const { afterLinkChange: invalidate } = useLinksInvalidate();
  const toast = useToast();

  const { data: linksPage } = useQuery(
    trpc.shortLinks.list.queryOptions({ brandId, limit: 100 }),
  );
  // Brand's default QR design — seeds the preview and the new link's qrConfig.
  const { data: defaultQr } = useQuery(
    trpc.shortLinks.defaultQrConfig.queryOptions({ brandId }),
  );
  const existing = useMemo(
    () => (linksPage?.items ?? []).map((l) => l.slug),
    [linksPage],
  );
  const autoRef = useRef<string | null>(null);
  if (autoRef.current === null) autoRef.current = autoSlug([]);

  const [dest, setDest] = useState('');
  const [destErr, setDestErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'auto' | 'custom'>('auto');
  const [custom, setCustom] = useState('');
  const [customStatus, setCustomStatus] = useState<SlugStatus>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const localSlugIssue =
    mode === 'custom' ? slugProblem(custom, existing) : null;

  /* Debounced server-side slug availability check. */
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

  const previewSlug =
    mode === 'custom' && custom && customStatus === 'ok'
      ? custom
      : autoRef.current!;
  const slugOk = mode === 'auto' || (!!custom && customStatus === 'ok');

  const create = useMutation(trpc.shortLinks.create.mutationOptions());

  async function submit() {
    const dErr = validDest(dest.trim());
    if (dErr) {
      setDestErr(dErr);
      return;
    }
    if (!slugOk) return;
    if (!label.trim()) {
      toast('Add a label so you can recognise this link.');
      return;
    }
    setSaving(true);
    try {
      const row = await create.mutateAsync({
        brandId,
        slug: mode === 'custom' ? custom : autoRef.current!,
        destinationUrl: dest.trim(),
        nickname: label.trim(),
        qrConfig: defaultQr ?? undefined,
      });
      invalidate();
      toast('Link created.');
      go('detail', { linkId: row.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create link';
      toast('Error: ' + msg);
    } finally {
      setSaving(false);
    }
  }

  const customErr =
    custom && customStatus && customStatus !== 'ok' && customStatus !== 'checking';

  return (
    <div>
      <div className="apage-head">
        <button className="backlink" onClick={() => go('links')}>
          <Icon name="back" size={14} />
          Links
        </button>
        <h1>New link</h1>
      </div>

      <div className="detail-grid">
        <div className="dcard">
          <div
            className="db"
            style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            <div className="afield">
              <label>Destination</label>
              <input
                className={'ainput' + (destErr ? ' err' : '')}
                placeholder="https://the-long-link-you-want-people-to-reach.com/page"
                value={dest}
                onChange={(e) => {
                  setDest(e.target.value);
                  setDestErr(null);
                }}
              />
              {destErr ? (
                <span className="hint" style={{ color: 'var(--danger)' }}>
                  {destErr}
                </span>
              ) : (
                <span className="hint">
                  Where the link points right now. You can change this whenever
                  you like.
                </span>
              )}
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
                      placeholder="winter-menu"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value.toLowerCase())}
                    />
                    {customStatus === 'checking' ? (
                      <span className="mutetext" style={{ fontSize: 12 }}>
                        Checking…
                      </span>
                    ) : null}
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
                      ? 'Lowercase letters, numbers and hyphens.'
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
              <label>Label</label>
              <input
                className="ainput"
                placeholder="Window sticker · bookings"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <span className="hint">
                A name only you see, so you can find this link later.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="abtn abtn-primary abtn-lg"
                onClick={submit}
                disabled={saving}
              >
                {saving ? 'Creating…' : 'Create link'}
              </button>
              <button className="abtn abtn-quiet" onClick={() => go('links')}>
                Cancel
              </button>
            </div>
          </div>
        </div>

        <div className="dcard" style={{ position: 'sticky', top: 20 }}>
          <div className="dh">
            <h2>Its QR code</h2>
            <span className="meta">One per link</span>
          </div>
          <div
            className="db"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div
              style={{
                border: '1px solid var(--border-1)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <QrPreview slug={previewSlug} size={280} config={defaultQr ?? undefined} />
            </div>
            <span
              className="slug"
              style={{ fontSize: 13, fontWeight: 700, textAlign: 'center' }}
            >
              {shortDisplay(previewSlug)}
            </span>
            <span
              className="mutetext"
              style={{ fontSize: 12, textAlign: 'center' }}
            >
              Generated with the default design. Restyle and export it from the
              link page after creating.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
