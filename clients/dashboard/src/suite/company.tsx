/* Prodesk — Company info (info-hub), wired to the live brand record.
   Restructured to the "Prodesk Master App" design-system layout: a two-column
   grid of read-cards (Identity · Contact · Locations · Policies) and a
   full-width Positioning card. Each panel edits via a modal and persists
   immediately to the brand record. */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { uploadFile } from '@shared/lib/storage';
import { StorageBucket } from '@shared/lib/storage-buckets';
import { Button, pushToast } from './ui';
import {
  FndHeader,
  FndSection,
  FndField,
  FndInput,
  FndTextarea,
  FndModal,
} from './fnd-shared';
import { PlacesAddressInput } from './places';
import { PhoneInput } from '@shared/components/ui/phone-input';
import type { Brand, SuiteApp } from './data';

interface Policy {
  id: string;
  title: string;
  body: string;
}
interface Location {
  id: string;
  label: string;
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  hours?: string;
  phone?: string;
}

interface Form {
  businessName: string;
  legalName: string;
  abn: string;
  industry: string;
  yearFounded: string;
  email: string;
  phone: string;
  website: string;
  contactName: string;
  address: string;
  usp: string;
  targetAudience: string;
  competitors: string;
  brandValues: string;
  toneOfVoice: string;
  keyMessaging: string;
  policies: Policy[];
  locations: Location[];
}

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const s = (v: unknown) => (typeof v === 'string' ? v : '');

/** Debounce a fast-changing value so we don't fire an availability query per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* Brand logo card — upload/replace the company logo. Mirrors the prodesk
   profile-hero flow: pick a file, upload to storage, persist via brands.updateLogo.
   On success it invalidates brands.byId + brands.mine so the sidebar switcher,
   collapsed-rail favicon and search all pick up the new logo immediately. */
function CompanyLogo({
  brandId,
  logoUrl,
  businessName,
}: {
  brandId: string;
  logoUrl: string;
  businessName: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const updateLogo = useMutation({
    ...trpc.brands.updateLogo.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: trpc.brands.byId.queryKey({ id: brandId }),
      });
      qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      pushToast('Logo updated.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(
        StorageBucket.Uploads,
        `brands/${brandId}`,
        file,
      );
      await updateLogo.mutateAsync({ brandId, logoUrls: [url] });
    } catch (err) {
      pushToast(
        `Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error',
      );
    } finally {
      setUploading(false);
    }
  }

  const mono =
    (businessName || 'Brand')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'B';

  return (
    <div className="pd-eco-card" style={{ marginBottom: 14 }}>
      <FndSection title="Brand logo" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span
            style={{
              width: 72,
              height: 72,
              borderRadius: 'var(--r-3)',
              flexShrink: 0,
              overflow: 'hidden',
              border: '1px solid var(--rule-2)',
              background: 'var(--paper-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span
                style={{ fontWeight: 800, fontSize: 22, color: 'var(--ink-3)' }}
              >
                {mono}
              </span>
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 13,
                color: 'var(--ink-2)',
                textWrap: 'pretty',
              }}
            >
              Shown across the suite — the brand switcher, the collapsed nav
              favicon, and everywhere {businessName || 'your brand'} appears.
              PNG, JPG or SVG.
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon="image"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading
                ? 'Uploading…'
                : logoUrl
                  ? 'Change logo'
                  : 'Upload logo'}
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onPick}
        />
      </FndSection>
    </div>
  );
}

export function CompanyTool({ app, brand }: { app: SuiteApp; brand: Brand }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandQ = useQuery(trpc.brands.byId.queryOptions({ id: brand.id }));
  const [f, setF] = useState<Form | null>(null);
  // "identity" | "contact" | "positioning" | "newLocation" | location id | "newPolicy" | policy id
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    const b = brandQ.data as Record<string, unknown> | null | undefined;
    if (!b) return;
    setF({
      businessName: s(b.businessName),
      legalName: s(b.legalName),
      abn: s(b.abn),
      industry: s(b.industry),
      yearFounded: s(b.yearFounded),
      email: s(b.email),
      phone: s(b.phone),
      website: s(b.website),
      contactName: s(b.contactName),
      address: s(b.address),
      usp: s(b.usp),
      targetAudience: s(b.targetAudience),
      competitors: s(b.competitors),
      brandValues: s(b.brandValues),
      toneOfVoice: s(b.toneOfVoice),
      keyMessaging: s(b.keyMessaging),
      policies: Array.isArray(b.policies) ? (b.policies as Policy[]) : [],
      locations: Array.isArray(b.locations) ? (b.locations as Location[]) : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandQ.data]);

  const save = useMutation({
    ...trpc.brands.update.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: trpc.brands.byId.queryKey({ id: brand.id }),
      });
      qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      pushToast('Company info saved.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });

  if (!f) {
    return (
      <div>
        <FndHeader
          app={{
            icon: app.icon || 'building',
            name: app.name,
            tag: 'The facts everything pulls from',
          }}
          brand={brand}
          pill="Source of truth"
        />
        <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  /* Optimistically update local state and persist the whole record. If the save
     fails — e.g. brands.update rejects a duplicate business name with a CONFLICT
     (the shared brand+agency namespace is unique) — roll the local form back to
     what it was so the UI never keeps an unsaved value. The toast is surfaced by
     the mutation-level onError above. */
  const persist = (next: Form) => {
    const prev = f;
    setF(next);
    save.mutate(
      {
        brandId: brand.id,
        businessName: next.businessName || undefined,
        legalName: next.legalName,
        abn: next.abn,
        industry: next.industry,
        yearFounded: next.yearFounded,
        email: next.email,
        contactName: next.contactName,
        website: next.website,
        phone: next.phone,
        address: next.address,
        usp: next.usp,
        targetAudience: next.targetAudience,
        competitors: next.competitors,
        brandValues: next.brandValues,
        toneOfVoice: next.toneOfVoice,
        keyMessaging: next.keyMessaging,
        policies: next.policies.filter((p) => p.title.trim()),
        locations: next.locations.filter(
          (l) => l.label.trim() || l.address.trim(),
        ),
      },
      { onError: () => setF(prev) },
    );
  };

  return (
    <div>
      <FndHeader
        app={{
          icon: app.icon || 'building',
          name: app.name,
          tag: 'The facts everything pulls from',
        }}
        brand={brand}
        primaryLabel="Add location"
        onPrimary={() => setEditing('newLocation')}
        ghostLabel="Add policy"
        onGhost={() => setEditing('newPolicy')}
      />

      {/* brand logo — full width, above the fact grid */}
      <CompanyLogo
        brandId={brand.id}
        logoUrl={s(
          (brandQ.data as Record<string, unknown> | null | undefined)?.logoUrl,
        )}
        businessName={f.businessName}
      />

      <div className="pd-cmp-grid">
        {/* identity */}
        <div className="pd-eco-card">
          <FndSection
            title="Identity"
            action="Edit"
            onAction={() => setEditing('identity')}
            style={{ marginBottom: 0 }}
          >
            <FndField label="Business name" value={f.businessName} />
            <FndField label="Legal / registered name" value={f.legalName} />
            <FndField label="ABN" value={f.abn} />
            <FndField label="Industry" value={f.industry} />
            <FndField label="Year founded" value={f.yearFounded} />
          </FndSection>
        </div>

        {/* contact */}
        <div className="pd-eco-card">
          <FndSection
            title="Contact"
            action="Edit"
            onAction={() => setEditing('contact')}
            style={{ marginBottom: 0 }}
          >
            <FndField label="Email" value={f.email} />
            <FndField label="Phone" value={f.phone} />
            <FndField label="Website" value={f.website} />
            <FndField label="Primary contact" value={f.contactName} />
            <FndField label="Registered address" value={f.address} />
          </FndSection>
        </div>

        {/* locations */}
        <div className="pd-eco-card">
          <FndSection
            title={`Locations · ${f.locations.length}`}
            style={{ marginBottom: 0 }}
          >
            {f.locations.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
                No locations yet. Use “Add location” to add your trading
                addresses.
              </p>
            )}
            {f.locations.map((l) => (
              <div
                key={l.id}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {l.label || 'Untitled location'}
                  </span>
                  <button
                    type="button"
                    className="pd-textlink"
                    style={{ fontSize: 12 }}
                    onClick={() => setEditing(l.id)}
                  >
                    Edit
                  </button>
                </div>
                {l.address && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--ink-2)',
                      marginTop: 3,
                    }}
                  >
                    {l.address}
                  </div>
                )}
                {(l.hours || l.phone) && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      marginTop: 3,
                    }}
                  >
                    {[l.hours, l.phone].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </FndSection>
        </div>

        {/* policies */}
        <div className="pd-eco-card">
          <FndSection
            title={`Policies · ${f.policies.length}`}
            style={{ marginBottom: 0 }}
          >
            {f.policies.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
                No policies yet — add cancellation, refund or privacy terms with
                “Add policy”.
              </p>
            )}
            {f.policies.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {p.title || 'Untitled policy'}
                  </span>
                  <button
                    type="button"
                    className="pd-textlink"
                    style={{ fontSize: 12 }}
                    onClick={() => setEditing(p.id)}
                  >
                    Edit
                  </button>
                </div>
                {p.body && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: 13,
                      color: 'var(--ink-2)',
                      lineHeight: 1.5,
                      textWrap: 'pretty',
                    }}
                  >
                    {p.body}
                  </p>
                )}
              </div>
            ))}
          </FndSection>
        </div>

        {/* positioning — full width */}
        <div className="pd-eco-card" style={{ gridColumn: '1 / -1' }}>
          <FndSection
            title="Positioning"
            action="Edit"
            onAction={() => setEditing('positioning')}
            style={{ marginBottom: 0 }}
          >
            <FndField label="Unique selling proposition" value={f.usp} />
            <FndField label="Target audience" value={f.targetAudience} />
            <FndField label="Competitors" value={f.competitors} />
            <FndField label="Brand values" value={f.brandValues} />
            <FndField label="Tone of voice" value={f.toneOfVoice} />
            <FndField label="Key messaging" value={f.keyMessaging} />
          </FndSection>
        </div>
      </div>

      {/* ===== editors ===== */}
      {editing === 'identity' && (
        <CmpIdentityEditor
          f={f}
          brandId={brand.id}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            persist({ ...f, ...patch });
            setEditing(null);
          }}
        />
      )}
      {editing === 'contact' && (
        <CmpContactEditor
          f={f}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            persist({ ...f, ...patch });
            setEditing(null);
          }}
        />
      )}
      {editing === 'positioning' && (
        <CmpPositioningEditor
          f={f}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            persist({ ...f, ...patch });
            setEditing(null);
          }}
        />
      )}
      {(editing === 'newLocation' ||
        f.locations.some((l) => l.id === editing)) && (
        <CmpLocationEditor
          loc={f.locations.find((l) => l.id === editing)}
          onClose={() => setEditing(null)}
          onDelete={
            editing !== 'newLocation'
              ? () => {
                  persist({
                    ...f,
                    locations: f.locations.filter((l) => l.id !== editing),
                  });
                  setEditing(null);
                }
              : undefined
          }
          onSave={(vals) => {
            const next =
              editing === 'newLocation'
                ? {
                    ...f,
                    locations: [...f.locations, { id: uid('loc'), ...vals }],
                  }
                : {
                    ...f,
                    locations: f.locations.map((l) =>
                      l.id === editing ? { ...l, ...vals } : l,
                    ),
                  };
            persist(next);
            setEditing(null);
          }}
        />
      )}
      {(editing === 'newPolicy' ||
        f.policies.some((p) => p.id === editing)) && (
        <CmpPolicyEditor
          pol={f.policies.find((p) => p.id === editing)}
          onClose={() => setEditing(null)}
          onDelete={
            editing !== 'newPolicy'
              ? () => {
                  persist({
                    ...f,
                    policies: f.policies.filter((p) => p.id !== editing),
                  });
                  setEditing(null);
                }
              : undefined
          }
          onSave={(vals) => {
            const next =
              editing === 'newPolicy'
                ? {
                    ...f,
                    policies: [...f.policies, { id: uid('pol'), ...vals }],
                  }
                : {
                    ...f,
                    policies: f.policies.map((p) =>
                      p.id === editing ? { ...p, ...vals } : p,
                    ),
                  };
            persist(next);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CmpIdentityEditor({
  f,
  brandId,
  onClose,
  onSave,
}: {
  f: Form;
  brandId: string;
  onClose: () => void;
  onSave: (patch: Partial<Form>) => void;
}) {
  const trpc = useTRPC();
  const [v, setV] = useState({
    businessName: f.businessName,
    legalName: f.legalName,
    abn: f.abn,
    industry: f.industry,
    yearFounded: f.yearFounded,
  });
  const set = (k: keyof typeof v) => (val: string) =>
    setV((cur) => ({ ...cur, [k]: val }));

  // Business name is unique across the shared brand+agency namespace. Check
  // availability live as the user types (like the create-brand form) so a
  // collision is caught before save — excludeBrandId keeps the brand's own
  // current name from reading as taken. Only checked once the name actually
  // differs from what's already saved.
  const trimmedName = v.businessName.trim();
  const nameChanged =
    trimmedName.toLowerCase() !== f.businessName.trim().toLowerCase();
  const debouncedName = useDebounced(trimmedName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({
      businessName: debouncedName,
      excludeBrandId: brandId,
    }),
    enabled: nameChanged && debouncedName.length > 1,
  });
  const nameEmpty = trimmedName.length === 0;
  const nameTaken = nameChanged && !!nameCheck.data && !nameCheck.data.available;
  const checking = nameChanged && debouncedName.length > 1 && nameCheck.isFetching;
  // Block save while empty, taken, or still resolving a changed name — mirrors
  // the server's CONFLICT guard so the user isn't left with a rejected value.
  const canSave = !nameEmpty && !nameTaken && !checking;
  return (
    <FndModal
      title="Edit identity"
      eyebrow="Company"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => canSave && onSave(v)}
            disabled={!canSave}
          >
            Save
          </Button>
        </>
      }
    >
      <FndInput
        label="Business name"
        value={v.businessName}
        onChange={set('businessName')}
      />
      {nameEmpty ? (
        <p style={{ margin: '-6px 0 12px', color: 'var(--color-danger)', fontSize: 12 }}>
          A business name is required.
        </p>
      ) : nameTaken ? (
        <p style={{ margin: '-6px 0 12px', color: 'var(--color-danger)', fontSize: 12 }}>
          {nameCheck.data?.reason ?? 'This business name is already taken.'}
        </p>
      ) : checking ? (
        <p style={{ margin: '-6px 0 12px', color: 'var(--ink-3)', fontSize: 12 }}>
          Checking availability…
        </p>
      ) : null}
      <FndInput
        label="Legal / registered name"
        value={v.legalName}
        onChange={set('legalName')}
      />
      <div className="pd-form-2col">
        <FndInput label="ABN" value={v.abn} onChange={set('abn')} />
        <FndInput
          label="Year founded"
          value={v.yearFounded}
          onChange={set('yearFounded')}
        />
      </div>
      <FndInput
        label="Industry"
        value={v.industry}
        onChange={set('industry')}
      />
    </FndModal>
  );
}

function CmpContactEditor({
  f,
  onClose,
  onSave,
}: {
  f: Form;
  onClose: () => void;
  onSave: (patch: Partial<Form>) => void;
}) {
  const [v, setV] = useState({
    email: f.email,
    phone: f.phone,
    website: f.website,
    contactName: f.contactName,
    address: f.address,
  });
  const set = (k: keyof typeof v) => (val: string) =>
    setV((cur) => ({ ...cur, [k]: val }));
  return (
    <FndModal
      title="Edit contact"
      eyebrow="Company"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(v)}>
            Save
          </Button>
        </>
      }
    >
      <div className="pd-form-2col">
        <FndInput
          label="Email"
          value={v.email}
          onChange={set('email')}
          type="email"
        />
        <FndInput label="Phone" value={v.phone} onChange={set('phone')} />
      </div>
      <FndInput label="Website" value={v.website} onChange={set('website')} />
      <FndInput
        label="Primary contact"
        value={v.contactName}
        onChange={set('contactName')}
      />
      <FndInput
        label="Registered address"
        value={v.address}
        onChange={set('address')}
      />
    </FndModal>
  );
}

function CmpPositioningEditor({
  f,
  onClose,
  onSave,
}: {
  f: Form;
  onClose: () => void;
  onSave: (patch: Partial<Form>) => void;
}) {
  const [v, setV] = useState({
    usp: f.usp,
    targetAudience: f.targetAudience,
    competitors: f.competitors,
    brandValues: f.brandValues,
    toneOfVoice: f.toneOfVoice,
    keyMessaging: f.keyMessaging,
  });
  const set = (k: keyof typeof v) => (val: string) =>
    setV((cur) => ({ ...cur, [k]: val }));
  return (
    <FndModal
      title="Edit positioning"
      eyebrow="Company"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(v)}>
            Save
          </Button>
        </>
      }
    >
      <FndTextarea
        label="Unique selling proposition"
        value={v.usp}
        onChange={set('usp')}
        rows={2}
      />
      <FndTextarea
        label="Target audience"
        value={v.targetAudience}
        onChange={set('targetAudience')}
        rows={2}
      />
      <FndTextarea
        label="Competitors"
        value={v.competitors}
        onChange={set('competitors')}
        rows={2}
      />
      <FndTextarea
        label="Brand values"
        value={v.brandValues}
        onChange={set('brandValues')}
        rows={2}
      />
      <FndTextarea
        label="Tone of voice"
        value={v.toneOfVoice}
        onChange={set('toneOfVoice')}
        rows={2}
      />
      <FndTextarea
        label="Key messaging"
        value={v.keyMessaging}
        onChange={set('keyMessaging')}
        rows={2}
      />
    </FndModal>
  );
}

/* ---- Opening-hours picker --------------------------------------------------
   "Simple days + one time range": pick the open weekdays and a single open/close
   time that applies to all of them. Serialised into the existing free-text
   `hours` string (no schema change) in a format this same picker can parse back
   on edit, e.g. "Mon, Tue, Wed, Thu, Fri · 9:00 AM – 5:00 PM". Legacy free-text
   values that don't match simply hydrate an empty picker. */
const HOURS_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmt12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return '';
  const h = Number(m[1]);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${ampm}`;
}

function parse12(label: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function formatHours(days: string[], open: string, close: string): string {
  if (!days.length || !open || !close) return '';
  return `${days.join(', ')} · ${fmt12(open)} – ${fmt12(close)}`;
}

// New locations open with sensible defaults pre-filled: Mon–Fri, 9am–5pm.
const DEFAULT_HOURS = formatHours(
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  '09:00',
  '17:00',
);

function parseHours(str: string): {
  days: string[];
  open: string;
  close: string;
} {
  const res = { days: [] as string[], open: '', close: '' };
  if (!str) return res;
  const [daysPart, timesPart] = str.split('·');
  if (daysPart)
    res.days = daysPart
      .split(',')
      .map((d) => d.trim())
      .filter((d) => HOURS_DAYS.includes(d));
  if (timesPart) {
    const [o, c] = timesPart.split('–').map((t) => t.trim());
    res.open = parse12(o ?? '');
    res.close = parse12(c ?? '');
  }
  return res;
}

const hoursTimeStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'var(--font)',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--rule-2)',
  borderRadius: 'var(--r-2)',
  padding: '8px 11px',
  outline: 'none',
};

function FndHoursPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const init = parseHours(value);
  const [days, setDays] = useState<string[]>(init.days);
  const [open, setOpen] = useState(init.open);
  const [close, setClose] = useState(init.close);

  const toggleDay = (day: string) => {
    const next = days.includes(day)
      ? days.filter((d) => d !== day)
      : [...days, day].sort(
          (a, b) => HOURS_DAYS.indexOf(a) - HOURS_DAYS.indexOf(b),
        );
    setDays(next);
    onChange(formatHours(next, open, close));
  };

  return (
    <div style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="eyebrow"
        style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
      >
        Opening hours
      </span>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}
      >
        {HOURS_DAYS.map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              aria-pressed={on}
              style={{
                border: '1px solid',
                borderColor: on ? 'var(--ink)' : 'var(--rule-2)',
                borderRadius: 'var(--r-2)',
                padding: '6px 11px',
                fontSize: 12.5,
                cursor: 'pointer',
                fontFamily: 'var(--font)',
                fontWeight: on ? 600 : 500,
                background: on ? 'var(--ink)' : 'var(--white)',
                color: on ? 'var(--paper)' : 'var(--ink-2)',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div className="pd-form-2col">
        <label style={{ display: 'block' }}>
          <span
            className="eyebrow"
            style={{
              display: 'block',
              fontSize: 10,
              marginBottom: 5,
              color: 'var(--ink-3)',
            }}
          >
            Opens
          </span>
          <input
            type="time"
            value={open}
            onChange={(e) => {
              setOpen(e.target.value);
              onChange(formatHours(days, e.target.value, close));
            }}
            style={hoursTimeStyle}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span
            className="eyebrow"
            style={{
              display: 'block',
              fontSize: 10,
              marginBottom: 5,
              color: 'var(--ink-3)',
            }}
          >
            Closes
          </span>
          <input
            type="time"
            value={close}
            onChange={(e) => {
              setClose(e.target.value);
              onChange(formatHours(days, open, e.target.value));
            }}
            style={hoursTimeStyle}
          />
        </label>
      </div>
      {/* "HH:MM" is zero-padded 24h, so a lexicographic compare orders times correctly. */}
      {open && close && close <= open && (
        <span
          style={{
            display: 'block',
            fontSize: 11.5,
            color: 'var(--color-danger)',
            marginTop: 6,
          }}
        >
          Closing time must be after opening time.
        </span>
      )}
    </div>
  );
}

/* ---- Location field validation -------------------------------------------- */
// Hours are valid unless an open AND close are both set and out of order.
function hoursInOrder(str: string): boolean {
  const { open, close } = parseHours(str);
  return !(open && close && close <= open);
}
// Phone is optional; when entered, the digit count must look like a real number.
// E.164 caps the total at 15 digits (incl. country code); 8 is a sane floor.
function phoneSizeOk(str: string): boolean {
  const p = (str ?? '').trim();
  if (!p) return true;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function CmpLocationEditor({
  loc,
  onClose,
  onSave,
  onDelete,
}: {
  loc?: Location;
  onClose: () => void;
  onSave: (vals: Omit<Location, 'id'>) => void;
  onDelete?: () => void;
}) {
  const [v, setV] = useState<Omit<Location, 'id'>>({
    label: loc?.label ?? '',
    address: loc?.address ?? '',
    placeId: loc?.placeId,
    lat: loc?.lat,
    lng: loc?.lng,
    hours: loc?.hours ?? DEFAULT_HOURS,
    phone: loc?.phone ?? '',
  });
  const hoursOk = hoursInOrder(v.hours ?? '');
  const phoneOk = phoneSizeOk(v.phone ?? '');
  const valid = !!(v.label.trim() || v.address.trim()) && hoursOk && phoneOk;
  return (
    <FndModal
      title={loc ? `Edit ${loc.label || 'location'}` : 'Add a location'}
      eyebrow="Locations"
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button
              type="button"
              className="pd-textlink"
              style={{
                fontSize: 12.5,
                color: 'var(--color-danger)',
                marginRight: 'auto',
              }}
              onClick={onDelete}
            >
              Remove
            </button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => valid && onSave(v)}
          >
            Save
          </Button>
        </>
      }
    >
      <FndInput
        label="Label"
        value={v.label}
        onChange={(x) => setV((cur) => ({ ...cur, label: x }))}
        placeholder="e.g. Roastery & HQ"
      />
      <PlacesAddressInput
        label="Address"
        value={v.address}
        onPick={(p) =>
          setV((cur) => ({
            ...cur,
            address: p.address,
            placeId: p.placeId,
            lat: p.lat,
            lng: p.lng,
          }))
        }
      />
      <FndHoursPicker
        value={v.hours ?? ''}
        onChange={(x) => setV((cur) => ({ ...cur, hours: x }))}
      />
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span
          className="eyebrow"
          style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
        >
          Phone
        </span>
        <PhoneInput
          value={v.phone ?? ''}
          onChange={(x) => setV((cur) => ({ ...cur, phone: x }))}
        />
        {!phoneOk && (
          <span
            style={{
              display: 'block',
              fontSize: 11.5,
              color: 'var(--color-danger)',
              marginTop: 4,
            }}
          >
            Enter a valid phone number (8–15 digits).
          </span>
        )}
      </label>
    </FndModal>
  );
}

function CmpPolicyEditor({
  pol,
  onClose,
  onSave,
  onDelete,
}: {
  pol?: Policy;
  onClose: () => void;
  onSave: (vals: Omit<Policy, 'id'>) => void;
  onDelete?: () => void;
}) {
  const [v, setV] = useState<Omit<Policy, 'id'>>({
    title: pol?.title ?? '',
    body: pol?.body ?? '',
  });
  const valid = !!v.title.trim();
  return (
    <FndModal
      title={pol ? `Edit ${pol.title || 'policy'}` : 'Add a policy'}
      eyebrow="Policies"
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button
              type="button"
              className="pd-textlink"
              style={{
                fontSize: 12.5,
                color: 'var(--color-danger)',
                marginRight: 'auto',
              }}
              onClick={onDelete}
            >
              Remove
            </button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => valid && onSave(v)}
          >
            Save
          </Button>
        </>
      }
    >
      <FndInput
        label="Title"
        value={v.title}
        onChange={(x) => setV((cur) => ({ ...cur, title: x }))}
        placeholder="e.g. Refunds"
      />
      <FndTextarea
        label="Detail"
        value={v.body}
        onChange={(x) => setV((cur) => ({ ...cur, body: x }))}
        rows={4}
      />
    </FndModal>
  );
}
