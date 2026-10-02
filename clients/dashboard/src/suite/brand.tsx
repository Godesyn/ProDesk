/* Prodesk — Brand Kit (brand-hub).
   The brand's living brand kit: logos, colours, type, voice and the surfaces it
   appears on. Ported from the Prodesk Master App Claude Design (foundations/
   brand.jsx) onto real data:
     • identity / palette / type / logos  → `brands` (single source of truth)
     • tagline / voice / extra logo slots  → the brand kit satellite (brandKits)
   The "In use → Signatures" card renders from the SHARED signature generator so
   it is byte-identical to the Signatures app, with a button that opens it. */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { ColorPicker } from '@shared/components/ui/color-picker';
import {
  DEFAULT_SIGNATURE,
  FONT_OPTIONS,
  generateSignatureHtml,
  type SignatureData,
  type TemplateId,
} from '@shared/signatures';
import {
  matchSlot,
  slotUrlFrom,
  type LockupSlot,
} from '@server/modules/logo/layout';
import { Icon } from './icons';
import { Button, pushToast } from './ui';
import { FndHeader, FndModal, FndInput } from './fnd-shared';
import { APPS, type Brand, type SuiteApp } from './data';
import { isAppLive } from './flags';

/* Palette token order stored positionally in brands.colors. */
const PALETTE_TOKENS = [
  { token: 'primary', def: '#1f6f54' },
  { token: 'accent', def: '#8a8a82' },
  { token: 'ink', def: '#191919' },
  { token: 'background', def: '#f6f4ef' },
  { token: 'rule', def: '#e5e1d8' },
];
/* Font slots stored positionally in brands.typography. */
const TYPE_SLOTS = ['Heading', 'Body', 'Mono'] as const;

/* Design-side logo slots. The Primary slot maps to brands.logoUrl; the rest live
   on the brand kit's logoSlots jsonb.

   Each tile is keyed by the LOGO ENGINE's canonical slot name, not by its label.
   Logo Studio's "Push to suite" writes those keys, so keying the tiles anything
   else is why a brand could finish an identity and still find this screen showing
   five empty upload boxes. Reads go through `slotUrlFrom`, which also accepts the
   display names this screen used to write (including the old "Lockup, horizontal",
   which was only ever a second name for the primary lockup). */
const LOGO_SLOTS: { slot: LockupSlot; label: string }[] = [
  { slot: 'primary', label: 'Primary' },
  { slot: 'reversed', label: 'Reversed' },
  { slot: 'mark', label: 'Mark / favicon' },
  { slot: 'stacked', label: 'Lockup, stacked' },
  { slot: 'wordmark', label: 'Wordmark' },
];

/* ── colour helpers (AA contrast note, mirrors the design) ── */
function lum(hex: string): number {
  const h = (hex || '#000').replace('#', '');
  const v =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(v.substr(i, 2), 16) / 255)
    .map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function aaNote(token: string, hex: string, bg: string): string | null {
  if (token === 'background' || token === 'rule') return null;
  return contrast(hex, bg) >= 4.5
    ? 'Passes AA on background'
    : 'Fails AA as text on background. Use for fills only.';
}

/** Read a picked file as base64 (sans data-URL prefix) for signatures.upload.file. */
function readFileBase64(
  file: File,
): Promise<{ base64: string; contentType: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        base64: result.split(',')[1] ?? '',
        contentType: file.type || 'application/octet-stream',
        filename: file.name,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function BkChapter({
  n,
  title,
  action,
  onAction,
  children,
}: {
  n: string;
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span
          className="eyebrow"
          style={{ color: 'var(--ink)', whiteSpace: 'nowrap' }}
        >
          {n} · {title}
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--rule-2)' }} />
        {action && (
          <button
            type="button"
            className="pd-textlink"
            style={{
              fontSize: 12,
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            onClick={onAction}
          >
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function BrandKitTool({
  app,
  brand,
  onOpenApp,
}: {
  app: SuiteApp;
  brand: Brand;
  onOpenApp: (a: SuiteApp) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const brandQ = useQuery(trpc.brands.byId.queryOptions({ id: brand.id }));
  const kitQ = useQuery(
    trpc.signatures.brands.get.queryOptions({ brandId: brand.id }),
  );
  const row = brandQ.data ?? null;
  const kit = kitQ.data ?? null;

  const [editSwatch, setEditSwatch] = useState<number | null>(null);
  const [editType, setEditType] = useState(false);
  const [editVoice, setEditVoice] = useState(false);
  const [editCover, setEditCover] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingSlot = useRef<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.brands.byId.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.signatures.brands.get.queryKey() });
  };

  const updateBrandMut = useMutation(trpc.brands.update.mutationOptions());
  const updateLogoMut = useMutation(trpc.brands.updateLogo.mutationOptions());
  const updateKitMut = useMutation(
    trpc.signatures.brands.update.mutationOptions(),
  );
  const uploadMut = useMutation(trpc.signatures.upload.file.mutationOptions());

  const palette = PALETTE_TOKENS.map((t, i) => ({
    ...t,
    hex: row?.colors?.[i] || t.def,
  }));
  const fonts = TYPE_SLOTS.map((slot, i) => ({
    slot,
    family: row?.typography?.[i] || '',
  }));
  const P = Object.fromEntries(palette.map((c) => [c.token, c.hex])) as Record<
    string,
    string
  >;
  const headFamily = fonts[0].family || "'Inter Tight', sans-serif";
  const bodyFamily = fonts[1].family || "'Inter', sans-serif";

  const primaryLogoUrl = row?.logoUrl || null;
  const logoSlots = kit?.logoSlots ?? [];
  /* brands.logoUrl stays authoritative for Primary (that is what the rest of the
     suite renders); every other slot resolves out of the kit in either vocabulary. */
  const slotUrl = (slot: LockupSlot): string | null =>
    slot === 'primary'
      ? primaryLogoUrl || slotUrlFrom(logoSlots, 'primary')
      : slotUrlFrom(logoSlots, slot);

  const tagline = kit?.brandTagline || '';
  const voice = kit?.voice ?? null;
  const kitVersion = kit?.kitVersion ?? 1;
  const kitVersionDate = kit?.kitVersionDate || '';

  // ── mutations ──
  const saveBrand = async (
    data: Partial<{
      colors: string[];
      typography: string[];
      logoUrls: string[];
    }>,
  ) => {
    await updateBrandMut.mutateAsync({ brandId: brand.id, ...data });
    invalidate();
  };

  const saveKit = async (data: Record<string, unknown>) => {
    await updateKitMut.mutateAsync({ brandId: brand.id, data });
    invalidate();
  };

  const pickLogo = (slotIndex: number) => {
    pendingSlot.current = slotIndex;
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const slotIndex = pendingSlot.current;
    pendingSlot.current = null;
    if (!file || slotIndex == null) return;
    if (!/^image\//.test(file.type) && !/\.svg$/i.test(file.name)) {
      pushToast('Logos are image files. Try an SVG or PNG.', 'error');
      return;
    }
    try {
      const payload = await readFileBase64(file);
      const { url, key } = await uploadMut.mutateAsync({
        brandId: brand.id,
        ...payload,
      });
      const slot = LOGO_SLOTS[slotIndex].slot;
      if (slot === 'primary') {
        await updateLogoMut.mutateAsync({
          brandId: brand.id,
          logoUrls: [url, ...(row?.logoUrls ?? [])],
        });
      } else {
        // Drop every alias of this slot, not just an exact key match — otherwise a
        // hand-upload would sit alongside the pushed entry and the two would race.
        const next = [
          ...logoSlots.filter((s) => matchSlot(s.slot) !== slot),
          { slot, url, key },
        ];
        await saveKit({ logoSlots: next });
      }
      invalidate();
      pushToast('Logo saved to your brand kit.', 'success');
    } catch {
      pushToast('Upload failed. Please try again.', 'error');
    }
  };

  // ── signature preview (rendered from the SHARED generator) ──
  const previewData: SignatureData = {
    ...DEFAULT_SIGNATURE,
    fullName: 'Alex Taylor',
    jobTitle: 'Founder',
    company: kit?.name || row?.businessName || brand.name,
    email: `hello@${(row?.website || 'yourbrand.com').replace(/^https?:\/\//, '')}`,
    website: row?.website || '',
    template: (kit?.defaultTemplate as TemplateId) || 'classic',
    primaryColor: kit?.primaryColor || P.primary,
    secondaryColor: kit?.secondaryColor || P.ink,
    fontFamily: kit?.fontFamily || bodyFamily,
    logoUrl: primaryLogoUrl || '',
    showLogo: !!primaryLogoUrl,
    barColor: kit?.barColor || P.accent,
    barTextColor: kit?.barTextColor || '#ffffff',
    brandTagline: tagline || DEFAULT_SIGNATURE.brandTagline,
    disclaimer: kit?.disclaimer || '',
  };
  // Both open in the dashboard's app modal (SuiteApp.openApp).
  const openById = (id: string) => {
    const a = APPS.find((x) => x.id === id);
    if (a) onOpenApp(a);
  };
  const openSignatures = () => openById('signatures');
  const logoStudioLive = isAppLive('logo');
  const openLogoStudio = () => openById('logo');

  const loading = brandQ.isLoading || kitQ.isLoading;

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.svg"
        style={{ display: 'none' }}
        onChange={onFile}
        aria-hidden="true"
      />
      <FndHeader
        app={{
          icon: app.icon || 'brand',
          name: app.name,
          tag: 'Logo, colours, type and voice — used everywhere you appear',
        }}
        brand={brand}
        pill="Source of truth"
        primaryLabel="Edit cover"
        onPrimary={() => setEditCover(true)}
      />

      {loading && (
        <div
          style={{
            padding: '40px 0',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 14,
          }}
        >
          Loading…
        </div>
      )}

      {!loading && (
        <>
          {/* ===== Cover ===== */}
          <div className="pd-bk-cover" style={{ background: P.background }}>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: '0.12em',
                color: P.accent,
                textTransform: 'uppercase',
              }}
            >
              Brand kit · v{kitVersion}
              {kitVersionDate ? ` · ${kitVersionDate}` : ''}
            </div>
            <div style={{ margin: 'auto 0', padding: '36px 0' }}>
              {primaryLogoUrl ? (
                <img
                  src={primaryLogoUrl}
                  alt={`${brand.name} logo`}
                  style={{
                    maxWidth: 'min(420px, 80%)',
                    maxHeight: 110,
                    display: 'block',
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => pickLogo(0)}
                  style={{
                    background: 'none',
                    border: '1px dashed var(--rule-2)',
                    borderRadius: 12,
                    padding: '22px 28px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      fontFamily: headFamily,
                      fontWeight: 700,
                      fontSize: 'clamp(24px, 3.6vw, 40px)',
                      color: P.primary,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {brand.name}
                  </span>
                  <span
                    className="mono"
                    style={{
                      display: 'block',
                      marginTop: 8,
                      fontSize: 10.5,
                      letterSpacing: '0.08em',
                      color: 'var(--ink-3)',
                      textTransform: 'uppercase',
                    }}
                  >
                    No logo yet — upload one
                  </span>
                </button>
              )}
              {tagline ? (
                <div
                  style={{
                    fontFamily: bodyFamily,
                    fontSize: 15,
                    color: P.ink,
                    opacity: 0.65,
                    marginTop: 12,
                  }}
                >
                  {tagline}
                </div>
              ) : (
                <button
                  type="button"
                  className="pd-textlink"
                  style={{ fontSize: 12.5, marginTop: 12 }}
                  onClick={() => setEditCover(true)}
                >
                  Add a tagline
                </button>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span style={{ display: 'flex', gap: 6 }}>
                {palette.slice(0, 3).map((c) => (
                  <span
                    key={c.token}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: c.hex,
                      border: '1px solid rgba(0,0,0,0.08)',
                    }}
                  />
                ))}
              </span>
              <span
                className="mono"
                style={{ fontSize: 10, color: P.ink, opacity: 0.5 }}
              >
                USED EVERYWHERE YOU APPEAR
              </span>
            </div>
          </div>

          {/* ===== 01 Logos ===== */}
          {/*
            The Logos chapter is where a brand notices it has no mark, or an old
            one — so that is where the door to the tool that makes one belongs.
            Logo Studio's "Push to suite" writes straight back into these slots,
            which makes this a genuine round trip rather than a cross-sell.
            The door only appears while the Logo app is live in flags.ts — the
            slots stay uploadable either way.
          */}
          <BkChapter
            n="01"
            title="Logos"
            action={logoStudioLive ? 'Studio' : undefined}
            onAction={logoStudioLive ? openLogoStudio : undefined}
          >
            <div className="pd-bk-logo-grid">
              {LOGO_SLOTS.map(({ slot, label }, i) => {
                const url = slotUrl(slot);
                if (!url) {
                  return (
                    <button
                      key={slot}
                      type="button"
                      className="pd-bk-logo-tile pd-bk-logo-empty"
                      onClick={() => pickLogo(i)}
                    >
                      <Icon
                        name="plus"
                        size={18}
                        style={{ color: 'var(--ink-3)' }}
                      />
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--ink-3)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {label}
                      </span>
                    </button>
                  );
                }
                // The reversed lockup is white ink — it only reads on a dark tile.
                const dark = slot === 'reversed';
                return (
                  <div
                    key={slot}
                    className="pd-bk-logo-tile"
                    style={{ background: dark ? P.primary : P.background }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        minHeight: 44,
                      }}
                    >
                      <img
                        src={url}
                        alt={`${label} logo`}
                        style={{ maxWidth: '100%', maxHeight: 48 }}
                      />
                    </span>
                    <span
                      style={{
                        marginTop: 'auto',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        gap: 8,
                        width: '100%',
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 9.5,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: dark
                            ? 'rgba(255,255,255,0.65)'
                            : 'var(--ink-2)',
                        }}
                      >
                        {label}
                      </span>
                      <button
                        type="button"
                        onClick={() => pickLogo(i)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          flexShrink: 0,
                          fontFamily: 'var(--font)',
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: dark ? '#fff' : 'var(--ink)',
                          textDecoration: 'underline',
                          textUnderlineOffset: 3,
                        }}
                      >
                        Replace
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 12,
                color: 'var(--ink-3)',
                textWrap: 'pretty',
              }}
            >
              The primary logo is your brand logo — it appears on proposals,
              signatures and everywhere else you show up.
            </p>
          </BkChapter>

          {/* ===== 02 Colours ===== */}
          <BkChapter n="02" title="Colours">
            <div className="pd-bk-swatch-row">
              {palette.map((c, i) => (
                <button
                  key={c.token}
                  type="button"
                  className="pd-bk-swatch"
                  onClick={() => setEditSwatch(i)}
                  style={{ flexGrow: i === 0 ? 2.2 : 1 }}
                >
                  <span
                    className="pd-bk-swatch-chip"
                    style={{
                      background: c.hex,
                      border:
                        lum(c.hex) > 0.85 ? '1px solid var(--rule-2)' : 'none',
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        fontWeight: 500,
                        color:
                          lum(c.hex) > 0.55
                            ? '#55524a'
                            : 'rgba(255,255,255,0.9)',
                      }}
                    >
                      {c.hex}
                    </span>
                  </span>
                  <span
                    style={{
                      display: 'block',
                      padding: '8px 2px 0',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {c.token}
                    </span>
                    {aaNote(c.token, c.hex, P.background) && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          color: 'var(--ink-3)',
                          marginTop: 2,
                          textWrap: 'pretty',
                        }}
                      >
                        {aaNote(c.token, c.hex, P.background)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </BkChapter>

          {/* ===== 03 Type ===== */}
          <BkChapter
            n="03"
            title="Type"
            action="Change fonts"
            onAction={() => setEditType(true)}
          >
            <div className="pd-bk-type-grid">
              <div
                className="pd-bk-type-card"
                style={{ background: P.background }}
              >
                <span
                  style={{
                    fontFamily: headFamily,
                    fontWeight: 700,
                    fontSize: 76,
                    lineHeight: 1,
                    color: P.primary,
                    letterSpacing: '-0.02em',
                  }}
                >
                  Aa
                </span>
                <div style={{ marginTop: 'auto' }}>
                  <div
                    style={{
                      fontFamily: headFamily,
                      fontWeight: 700,
                      fontSize: 15,
                      color: P.ink,
                    }}
                  >
                    {fonts[0].family || 'None set'}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: P.ink,
                      opacity: 0.55,
                      marginTop: 2,
                    }}
                  >
                    HEADINGS
                  </div>
                </div>
              </div>
              <div
                className="pd-bk-type-card"
                style={{
                  background: 'var(--white)',
                  border: '1px solid var(--rule-2)',
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: headFamily,
                      fontWeight: 700,
                      fontSize: 22,
                      color: '#191919',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {tagline || 'The quick brown fox'}
                  </div>
                  <p
                    style={{
                      fontFamily: bodyFamily,
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: '#444',
                      margin: '10px 0 0',
                      textWrap: 'pretty',
                    }}
                  >
                    Body is set in {fonts[1].family || 'your body font'}. The
                    quick brown fox jumps over the lazy dog, 0123456789.
                  </p>
                </div>
                <div style={{ marginTop: 'auto' }}>
                  <div
                    style={{
                      fontFamily: bodyFamily,
                      fontWeight: 500,
                      fontSize: 15,
                    }}
                  >
                    {fonts[1].family || 'None set'}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: 'var(--ink-3)',
                      marginTop: 2,
                    }}
                  >
                    BODY · MONO: {(fonts[2].family || 'None set').toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
          </BkChapter>

          {/* ===== 04 Voice ===== */}
          <BkChapter
            n="04"
            title="Voice"
            action="Edit voice"
            onAction={() => setEditVoice(true)}
          >
            <div className="pd-bk-voice-grid">
              <div
                className="pd-bk-voice-quote"
                style={{ background: P.primary }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  HOW WE SOUND
                </span>
                <div
                  style={{
                    fontFamily: headFamily,
                    fontWeight: 600,
                    fontSize: 'clamp(19px, 2.2vw, 26px)',
                    lineHeight: 1.18,
                    color: '#fff',
                    margin: '14px 0 0',
                    textWrap: 'balance',
                  }}
                >
                  &ldquo;
                  {voice?.examples?.[0] || 'Add an example line in Edit voice.'}
                  &rdquo;
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 7,
                    marginTop: 'auto',
                    paddingTop: 18,
                    flexWrap: 'wrap',
                  }}
                >
                  {(voice?.tone ?? []).map((t) => (
                    <span
                      key={t}
                      style={{
                        fontFamily: bodyFamily,
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: P.primary,
                        background: '#fff',
                        borderRadius: 999,
                        padding: '4px 11px',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  background: 'var(--white)',
                  border: '1px solid var(--rule-2)',
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div>
                  <div
                    className="eyebrow"
                    style={{ fontSize: 10, marginBottom: 7 }}
                  >
                    We say
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(voice?.preferred ?? []).map((w) => (
                      <span key={w} className="pd-bk-word">
                        {w}
                      </span>
                    ))}
                    {!voice?.preferred?.length && (
                      <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                        Nothing yet.
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div
                    className="eyebrow"
                    style={{ fontSize: 10, marginBottom: 7 }}
                  >
                    We never say
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(voice?.banned ?? []).map((w) => (
                      <span
                        key={w}
                        className="pd-bk-word"
                        style={{ textDecoration: 'line-through', opacity: 0.6 }}
                      >
                        {w}
                      </span>
                    ))}
                    {!voice?.banned?.length && (
                      <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                        Nothing yet.
                      </span>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 'auto',
                    borderTop: '1px solid var(--rule)',
                    paddingTop: 12,
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
                  >
                    READING LEVEL{' '}
                    {(voice?.readingLevel || 'Not set').toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </BkChapter>

          {/* ===== 05 In use — Signatures rendered from the SHARED generator ===== */}
          <BkChapter n="05" title="In use">
            <div className="pd-bk-use-grid">
              <div className="pd-bk-use-card" style={{ gridColumn: '1 / -1' }}>
                <div
                  style={{
                    background: 'var(--white)',
                    padding: 18,
                    overflowX: 'auto',
                  }}
                >
                  <div
                    style={{ minWidth: 320 }}
                    // Byte-identical to the Signatures app (same @shared/signatures generator).
                    dangerouslySetInnerHTML={{
                      __html: generateSignatureHtml(previewData),
                    }}
                  />
                </div>
                <div
                  className="pd-bk-use-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span>Email signature — live from the Signatures app</span>
                  <button
                    type="button"
                    className="pd-textlink"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                    }}
                    onClick={openSignatures}
                  >
                    Open Signatures
                    <Icon name="arrowRight" size={12} />
                  </button>
                </div>
              </div>
            </div>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 12,
                color: 'var(--ink-3)',
                textWrap: 'pretty',
              }}
            >
              This preview is rendered from the Signatures application itself —
              it is exactly what your team sees there. Change your logo, colours
              or fonts above and it updates with them.
            </p>
          </BkChapter>

          {/* ===== editors ===== */}
          {editSwatch != null && (
            <SwatchEditor
              token={palette[editSwatch].token}
              hex={palette[editSwatch].hex}
              onClose={() => setEditSwatch(null)}
              onSave={async (hex) => {
                const colors = palette.map((c) => c.hex);
                colors[editSwatch] = hex;
                await saveBrand({ colors });
                setEditSwatch(null);
                pushToast(
                  'Colour saved — every surface that uses it updates.',
                  'success',
                );
              }}
            />
          )}
          {editType && (
            <TypeEditor
              current={fonts.map((f) => f.family)}
              onClose={() => setEditType(false)}
              onSave={async (typography) => {
                await saveBrand({ typography });
                setEditType(false);
                pushToast(
                  'Fonts saved. Specimens and signatures now use them.',
                  'success',
                );
              }}
            />
          )}
          {editVoice && (
            <VoiceEditor
              voice={voice}
              onClose={() => setEditVoice(false)}
              onSave={async (v) => {
                await saveKit({ voice: v });
                setEditVoice(false);
                pushToast('Voice saved.', 'success');
              }}
            />
          )}
          {editCover && (
            <CoverEditor
              tagline={tagline}
              onClose={() => setEditCover(false)}
              onSave={async (t) => {
                await saveKit({ brandTagline: t });
                setEditCover(false);
                pushToast(
                  'Saved. The tagline updates everywhere it appears.',
                  'success',
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── editors ── */

function SwatchEditor({
  token,
  hex,
  onSave,
  onClose,
}: {
  token: string;
  hex: string;
  onSave: (hex: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(hex);
  const valid = /^#[0-9a-fA-F]{6}$/.test(val);
  return (
    <FndModal
      title={`Edit ${token}`}
      eyebrow="Colour"
      onClose={onClose}
      width={400}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => valid && onSave(val)}
          >
            Save colour
          </Button>
        </>
      }
    >
      <div
        style={{
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <ColorPicker
          value={valid ? val : '#000000'}
          onChange={setVal}
          ariaLabel="Pick colour"
        />
        <div style={{ flex: 1 }}>
          <FndInput
            label="Hex"
            value={val}
            onChange={setVal}
            placeholder="#1F6F54"
            sub={valid ? null : 'Six digit hex, like #1F6F54.'}
          />
        </div>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: 'var(--ink-3)',
          textWrap: 'pretty',
        }}
      >
        Saving updates every surface that uses this colour — proposals, website,
        signatures, print.
      </p>
    </FndModal>
  );
}

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="eyebrow"
        style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'var(--font)',
          fontSize: 14,
          color: 'var(--ink)',
          background: 'var(--white)',
          border: '1px solid var(--rule-2)',
          borderRadius: 'var(--r-2)',
          padding: '9px 11px',
          appearance: 'auto',
          cursor: 'pointer',
        }}
      >
        <option value="">None set</option>
        {FONT_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TypeEditor({
  current,
  onSave,
  onClose,
}: {
  current: string[];
  onSave: (typography: string[]) => void;
  onClose: () => void;
}) {
  const [heading, setHeading] = useState(current[0] || '');
  const [body, setBody] = useState(current[1] || '');
  const [mono, setMono] = useState(current[2] || '');
  return (
    <FndModal
      title="Change fonts"
      eyebrow="Type"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave([heading, body, mono])}
          >
            Save fonts
          </Button>
        </>
      }
    >
      <FontSelect label="Headings" value={heading} onChange={setHeading} />
      <FontSelect label="Body" value={body} onChange={setBody} />
      <FontSelect label="Mono" value={mono} onChange={setMono} />
      <p style={{ margin: '2px 0 8px', fontSize: 12.5, color: 'var(--ink-3)' }}>
        These fonts load across your brand kit and drive your signatures.
      </p>
    </FndModal>
  );
}

function VoiceEditor({
  voice,
  onSave,
  onClose,
}: {
  voice: {
    tone: string[];
    preferred: string[];
    banned: string[];
    readingLevel: string;
    examples: string[];
  } | null;
  onSave: (voice: {
    tone: string[];
    preferred: string[];
    banned: string[];
    readingLevel: string;
    examples: string[];
  }) => void;
  onClose: () => void;
}) {
  const [tone, setTone] = useState((voice?.tone ?? []).join(', '));
  const [preferred, setPreferred] = useState(
    (voice?.preferred ?? []).join(', '),
  );
  const [banned, setBanned] = useState((voice?.banned ?? []).join(', '));
  const [readingLevel, setReadingLevel] = useState(
    voice?.readingLevel || 'Grade 7',
  );
  const [ex0, setEx0] = useState(voice?.examples?.[0] || '');
  const [ex1, setEx1] = useState(voice?.examples?.[1] || '');
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <FndModal
      title="Edit voice"
      eyebrow="Voice"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              onSave({
                tone: list(tone),
                preferred: list(preferred),
                banned: list(banned),
                readingLevel,
                examples: [ex0, ex1].filter(Boolean),
              })
            }
          >
            Save voice
          </Button>
        </>
      }
    >
      <FndInput
        label="Tone"
        value={tone}
        onChange={setTone}
        placeholder="Warm, Direct"
        sub="Separate with commas."
      />
      <FndInput
        label="Example line one"
        value={ex0}
        onChange={setEx0}
        placeholder="The line that sounds most like you"
      />
      <FndInput label="Example line two" value={ex1} onChange={setEx1} />
      <FndInput
        label="We say"
        value={preferred}
        onChange={setPreferred}
        placeholder="fresh, local"
        sub="Separate with commas."
      />
      <FndInput
        label="We never say"
        value={banned}
        onChange={setBanned}
        placeholder="artisanal, curated"
        sub="Separate with commas."
      />
      <FndInput
        label="Reading level"
        value={readingLevel}
        onChange={setReadingLevel}
        placeholder="Grade 7"
      />
    </FndModal>
  );
}

function CoverEditor({
  tagline,
  onSave,
  onClose,
}: {
  tagline: string;
  onSave: (tagline: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(tagline);
  return (
    <FndModal
      title="Edit cover"
      eyebrow="Brand kit"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(val)}>
            Save
          </Button>
        </>
      }
    >
      <FndInput
        label="Tagline"
        value={val}
        onChange={setVal}
        placeholder="One line that sounds like you"
      />
      <p
        style={{
          margin: '2px 0 8px',
          fontSize: 12.5,
          color: 'var(--ink-3)',
          textWrap: 'pretty',
        }}
      >
        The cover logo is your primary logo from chapter 01 — upload or replace
        it there.
      </p>
    </FndModal>
  );
}
