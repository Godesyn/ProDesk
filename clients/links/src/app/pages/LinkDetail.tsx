/* L3 — Link detail: edit destination/label, customise + export QR, toggle, delete. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import QRCodeStyling from 'qr-code-styling';
import { useTRPC } from '@shared/lib/trpc';
import {
  Icon,
  Seg,
  StatusPill,
  Swatches,
  Toggle,
  QRView,
  buildQrOptions,
  type QrConfig,
} from '../components';
import { fmtDate, num, shortDisplay, shortUrl, validDest, daysUntilDeletion, deletionDateFormatted } from '../lib';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';
import { useLinkToggle } from '../use-link-toggle';
import { useCanEditLinks } from '../use-can-edit';
import { useLinksInvalidate } from '../use-invalidate';
import { PerformanceCard } from './link-performance';
import type { PageProps } from '../types';

const FG_SWATCHES = [
  { name: 'Ink', hex: '#0e0e0c' },
  { name: 'Teal', hex: '#007d66' },
  { name: 'Blue', hex: '#336dfe' },
  { name: 'Plum', hex: '#9b46b4' },
  { name: 'Rust', hex: '#c53829' },
];
const BG_SWATCHES = [
  { name: 'Card', hex: '#fbfaf4' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Paper', hex: '#f4f1e8' },
];

export function LinkDetail({ brandId, go, params, entitlement }: PageProps) {
  const trpc = useTRPC();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = useCanEditLinks();
  const linkId = params.linkId!;

  const { data: link, isLoading } = useQuery(
    trpc.shortLinks.byId.queryOptions({ id: linkId }),
  );

  const { afterLinkChange: invalidate } = useLinksInvalidate();

  const update = useMutation({
    ...trpc.shortLinks.update.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toast('Error: ' + e.message),
  });
  const { setActive, pending: togglePending } = useLinkToggle(
    brandId,
    entitlement,
  );
  const remove = useMutation({
    ...trpc.shortLinks.remove.mutationOptions(),
    onSuccess: () => {
      // Invalidate BEFORE navigating: the links list is a cached infinite query,
      // so without this the deleted row is still there when we land on it.
      invalidate();
      toast('Link deleted.');
      go('links');
    },
    onError: (e) => toast('Error: ' + e.message),
  });

  /* Editable destination + label, seeded from the loaded row. */
  const [dest, setDest] = useState('');
  const [destErr, setDestErr] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  /* In-progress QR config. */
  const [qr, setQr] = useState<QrConfig>({});
  const seeded = useRef(false);

  useEffect(() => {
    if (link && !seeded.current) {
      setDest(link.destinationUrl ?? '');
      setLabel(link.nickname);
      setQr((link.qrConfig as QrConfig) ?? {});
      seeded.current = true;
    }
  }, [link]);

  const qrInstance = useRef<QRCodeStyling | null>(null);
  const qrOptions = useMemo(
    () => buildQrOptions(link?.slug ?? '', qr, 320),
    [link?.slug, qr],
  );

  if (isLoading || !link) {
    return (
      <div>
        <div className="apage-head">
          <button className="backlink" onClick={() => go('links')}>
            <Icon name="back" size={14} />
            Links
          </button>
          <h1>Link</h1>
        </div>
        <div className="skel" style={{ height: 220, borderRadius: 8 }} />
      </div>
    );
  }

  const destDirty = dest.trim() !== link.destinationUrl;
  const labelDirty = label.trim() !== link.nickname && label.trim().length > 0;
  const qrDirty = JSON.stringify(qr) !== JSON.stringify(link.qrConfig ?? {});

  function saveDetails() {
    const dErr = validDest(dest.trim());
    if (dErr) {
      setDestErr(dErr);
      return;
    }
    update.mutate(
      {
        id: link!.id,
        destinationUrl: destDirty ? dest.trim() : undefined,
        nickname: labelDirty ? label.trim() : undefined,
      },
      { onSuccess: () => toast('Saved.') },
    );
  }

  function saveQr() {
    update.mutate(
      { id: link!.id, qrConfig: qr },
      { onSuccess: () => toast('QR design saved.') },
    );
  }

  function copyShort() {
    navigator.clipboard?.writeText(shortUrl(link!.slug));
    toast('Copied ' + shortDisplay(link!.slug));
  }

  async function exportPng() {
    await qrInstance.current?.download({ name: link!.slug, extension: 'png' });
  }
  async function exportSvg() {
    await qrInstance.current?.download({ name: link!.slug, extension: 'svg' });
  }

  /* Performance — shared with the campaign detail screen (link-performance.tsx).
     Rendered in two places because its position depends on the role: an editor
     gets it under the destination form in the left column (so the QR card stays
     beside it), a viewer — who has no form — gets it full-width below. */
  const performanceCard = <PerformanceCard linkId={linkId} />;

  return (
    <div>
      <div className="apage-head">
        <button className="backlink" onClick={() => go('links')}>
          <Icon name="back" size={14} />
          Links
        </button>
        <h1
          className="slug"
          style={{ fontSize: 22, cursor: 'copy' }}
          title="Click to copy the short link"
          onClick={copyShort}
        >
          {shortDisplay(link.slug)}
        </h1>
        <span className="spacer" />
        <button className="abtn abtn-ghost abtn-sm" onClick={copyShort}>
          <Icon name="copy" size={14} />
          Copy
        </button>
        {/* Enabling/disabling a link is an editor action; viewers see status via
            the StatusPill in the anatomy strip below, but no toggle. */}
        {canEdit ? (
          <Toggle
            on={link.isActive}
            disabled={togglePending}
            onChange={(next) => setActive(link.id, next)}
          />
        ) : (
          <StatusPill on={link.isActive} disabledAt={link.disabledAt} createdAt={link.createdAt} />
        )}
      </div>

      {!link.isActive && (
        <div
          style={{
            marginBottom: '1.25rem',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#b45309',
            padding: '0.85rem 1.1rem',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            fontSize: '0.875rem',
          }}
        >
          <div>
            <strong style={{ color: '#92400e' }}>Parked Link</strong> — This link is currently disabled. Inactive links stay parked for 30 days, after which they are permanently deleted and the short URL is released for others to use.
            <div style={{ fontSize: '0.82rem', marginTop: '0.2rem', opacity: 0.9 }}>
              Scheduled for automatic deletion on <strong>{deletionDateFormatted(link.disabledAt, link.createdAt)}</strong> ({daysUntilDeletion(link.disabledAt, link.createdAt)} days remaining).
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              className="abtn abtn-sm abtn-primary"
              style={{ flexShrink: 0 }}
              disabled={togglePending}
              onClick={() => setActive(link.id, true)}
            >
              Re-enable link
            </button>
          )}
        </div>
      )}

      {/* Anatomy */}
      <div className="anatomy">
        <div className="acell">
          <span className="atag">Short link</span>
          <b
            className="slug"
            style={{ cursor: 'copy' }}
            title="Click to copy the short link"
            onClick={copyShort}
          >
            {shortDisplay(link.slug)}
          </b>
          <span>Locks for life once scanned.</span>
        </div>
        <span className="ajoin">points to →</span>
        <div className="acell editable">
          <span className="atag teal">Destination</span>
          <b style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(link.destinationUrl ?? '').replace(/^https?:\/\//, '')}
          </b>
          <span>Editable any time.</span>
        </div>
        <span className="ajoin">·</span>
        <div className="acell">
          <span className="atag">Status</span>
          <b>
            <StatusPill on={link.isActive} disabledAt={link.disabledAt} createdAt={link.createdAt} />
          </b>
          <span>
            {num(link.clickCount)} clicks · created {fmtDate(link.createdAt)}
          </span>
        </div>
      </div>

      <div
        className={canEdit ? 'detail-grid' : undefined}
        // Viewers only see the QR card — drop the two-column grid and centre it
        // so it reads as a focused "here's your code" panel, not a lonely column.
        style={canEdit ? undefined : { maxWidth: 520, margin: '0 auto' }}
      >
        {/* Edit destination + label, with Performance beneath it — editor only.
            The two share one grid cell so the QR card stays on their right. */}
        {canEdit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="dcard">
            <div className="dh">
              <h2>Destination &amp; label</h2>
            </div>
            <div
              className="db"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <div className="afield">
                <label>Destination</label>
                <input
                  className={'ainput' + (destErr ? ' err' : '')}
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
                ) : null}
              </div>
              <div className="afield">
                <label>Label</label>
                <input
                  className="ainput"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="abtn abtn-primary"
                  disabled={
                    (!destDirty && !labelDirty) || update.isPending
                  }
                  onClick={saveDetails}
                >
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  className="abtn abtn-quiet"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Delete link?',
                        description: `${shortDisplay(link.slug)} — this can't be undone.`,
                        confirmLabel: 'Delete',
                        destructive: true,
                      })
                    )
                      remove.mutate({ id: link.id });
                  }}
                >
                  <Icon name="trash" size={14} />
                  Delete
                </button>
              </div>
            </div>
          </div>
          {performanceCard}
        </div>
        )}

        {/* QR customise */}
        <div
          className="dcard"
          style={canEdit ? { position: 'sticky', top: 20 } : undefined}
        >
          <div className="dh">
            <h2>QR code</h2>
            <span className="meta">{canEdit ? 'Restyle & export' : 'Scan or export'}</span>
          </div>
          <div className="db" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="qrstage" style={{ padding: 16 }}>
              <div className="preview">
                <QRView options={qrOptions} instanceRef={qrInstance} />
              </div>
            </div>

            {/* Restyling saves the design (editor action) — viewers just get the
                preview + export below. */}
            {canEdit && (
            <div className="qrcontrols">
              <div className="ctl">
                <label>Foreground</label>
                <Swatches
                  value={qr.foregroundColor ?? '#0e0e0c'}
                  options={FG_SWATCHES}
                  onChange={(hex) => setQr((c) => ({ ...c, foregroundColor: hex }))}
                />
              </div>
              <div className="ctl">
                <label>Background</label>
                <Swatches
                  value={qr.backgroundColor ?? '#fbfaf4'}
                  options={BG_SWATCHES}
                  onChange={(hex) => setQr((c) => ({ ...c, backgroundColor: hex }))}
                />
              </div>
              <div className="ctl">
                <label>Dots</label>
                <Seg
                  value={(qr.dotStyle ?? 'square') as 'square' | 'rounded' | 'dots' | 'classy'}
                  options={[
                    { value: 'square', label: 'Square' },
                    { value: 'rounded', label: 'Rounded' },
                    { value: 'dots', label: 'Dots' },
                    { value: 'classy', label: 'Classy' },
                  ]}
                  onChange={(v) => setQr((c) => ({ ...c, dotStyle: v }))}
                />
              </div>
              <div className="ctl">
                <label>Corners</label>
                <Seg
                  value={(qr.cornerStyle ?? 'square') as 'square' | 'rounded' | 'dot' | 'extra-rounded'}
                  options={[
                    { value: 'square', label: 'Square' },
                    { value: 'rounded', label: 'Rounded' },
                    { value: 'dot', label: 'Dot' },
                    { value: 'extra-rounded', label: 'Extra' },
                  ]}
                  onChange={(v) => setQr((c) => ({ ...c, cornerStyle: v }))}
                />
              </div>
            </div>
            )}

            <div className="dlrow" style={{ justifyContent: 'flex-start' }}>
              {canEdit && (
                <button
                  className="abtn abtn-primary abtn-sm"
                  disabled={!qrDirty || update.isPending}
                  onClick={saveQr}
                >
                  Save design
                </button>
              )}
              <button className="abtn abtn-ghost abtn-sm" onClick={exportPng}>
                <Icon name="download" size={14} />
                PNG
              </button>
              <button className="abtn abtn-ghost abtn-sm" onClick={exportSvg}>
                <Icon name="download" size={14} />
                SVG
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* A viewer has no left column, so Performance sits full-width below. */}
      {!canEdit && <div style={{ marginTop: 22 }}>{performanceCard}</div>}
    </div>
  );
}


