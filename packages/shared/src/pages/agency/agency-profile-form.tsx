import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { PhoneInput } from '../../components/ui/phone-input';
import { ACCENT_SWATCHES, DEFAULT_ACCENT_HEX, onAccent, shadeRamp } from '../../lib/accent-swatches';
import { useAccentTheme } from '../../theme/accent-theme';
import { cn } from '../../lib/utils';
import { urlError, normalizeUrlOrUndefined } from '../../lib/url';
import { DISCIPLINES } from './constants';
import { Field, FormSection, Chip } from './form-bits';

const MAX_SUBSTAGES = 10;

export interface AgencyProfileDraft {
  businessName: string;
  legalName: string;
  businessEmail: string;
  username: string;
  website: string;
  phone: string;
  address: string;
  abn: string;
  description: string;
  shortDescription: string;
  disciplines: string[];
  infin8Substages: string[];
  facebookUrl: string;
  xUrl: string;
  instagramUrl: string;
  accentColor: string;
}

export function emptyAgencyDraft(): AgencyProfileDraft {
  return {
    businessName: '', legalName: '', businessEmail: '', username: '', website: '', phone: '', address: '', abn: '',
    description: '', shortDescription: '', disciplines: [], infin8Substages: [],
    facebookUrl: '', xUrl: '', instagramUrl: '', accentColor: '',
  };
}

export function draftFromAgency(a: any): AgencyProfileDraft {
  const social = a.social ?? {};
  const ui = a.uiPreferences ?? {};
  return {
    businessName: a.businessName ?? '',
    legalName: a.legalName ?? '',
    businessEmail: a.businessEmail ?? '',
    username: a.username ?? '',
    website: a.website ?? '',
    phone: a.phone ?? '',
    address: a.address ?? '',
    abn: a.abn ?? '',
    description: a.description ?? '',
    shortDescription: a.shortDescription ?? '',
    disciplines: a.disciplines ?? [],
    infin8Substages: a.infin8Substages ?? [],
    facebookUrl: social.facebookUrl ?? '',
    xUrl: social.xUrl ?? '',
    instagramUrl: social.instagramUrl ?? '',
    accentColor: typeof ui.accentColor === 'string' ? ui.accentColor : '',
  };
}

/** Map a draft into the agencies.create/update payload shape. */
export function profilePayload(d: AgencyProfileDraft) {
  const social =
    d.facebookUrl || d.xUrl || d.instagramUrl
      ? { facebookUrl: normalizeUrlOrUndefined(d.facebookUrl), xUrl: normalizeUrlOrUndefined(d.xUrl), instagramUrl: normalizeUrlOrUndefined(d.instagramUrl) }
      : undefined;
  return {
    businessName: d.businessName,
    legalName: d.legalName || undefined,
    businessEmail: d.businessEmail || undefined,
    username: d.username || undefined,
    website: normalizeUrlOrUndefined(d.website),
    phone: d.phone || undefined,
    address: d.address || undefined,
    abn: d.abn || undefined,
    description: d.description || undefined,
    shortDescription: d.shortDescription || undefined,
    disciplines: d.disciplines,
    infin8Substages: d.infin8Substages,
    social,
    uiPreferences: d.accentColor ? { accentColor: d.accentColor } : undefined,
  };
}

/**
 * URL validator for website + all social links. Accepts bare domains (the
 * scheme is auto-added by {@link normalizeUrl}). Returns an error string or
 * null; empty is allowed since these fields are optional.
 */
export const websiteError = urlError;

/** True when website or any social link is filled but invalid — gates submit. */
export function hasInvalidUrl(d: AgencyProfileDraft): boolean {
  return [d.website, d.facebookUrl, d.xUrl, d.instagramUrl].some((u) => websiteError(u) !== null);
}

/**
 * Slugify a business name into a subdomain candidate — mirrors the Flutter
 * agency_profile_form autofill: spaces→hyphens, strip non-alphanumerics,
 * collapse/trim hyphens, lowercase.
 */
function slugifyUsername(s: string): string {
  return s
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Debounce a value. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The shared agency profile form — ports agency_profile_form.dart + sub-widgets:
 * business identity, subdomain (live availability), contact, descriptions,
 * disciplines (multi-select incl. custom), Infin8 sub-stages, socials, accent.
 */
export function AgencyProfileForm({ value, onChange, excludeAgencyId }: { value: AgencyProfileDraft; onChange: (d: AgencyProfileDraft) => void; excludeAgencyId?: string }) {
  const trpc = useTRPC();
  const set = <K extends keyof AgencyProfileDraft>(k: K, v: AgencyProfileDraft[K]) => onChange({ ...value, [k]: v });

  // Until the user focuses the subdomain / legal-name fields, keep them mirrored
  // off the business name (subdomain slugified, legal name verbatim). Once a
  // field is touched we stop overwriting it. Seeded as touched when the draft
  // already carries a value (e.g. editing an existing agency).
  const [usernameTouched, setUsernameTouched] = useState(() => value.username.trim().length > 0);
  const [legalNameTouched, setLegalNameTouched] = useState(() => value.legalName.trim().length > 0);

  function onBusinessNameChange(name: string) {
    const next: AgencyProfileDraft = { ...value, businessName: name };
    if (!usernameTouched) next.username = slugifyUsername(name);
    if (!legalNameTouched) next.legalName = name;
    onChange(next);
  }

  const debouncedUsername = useDebounced(value.username, 400);
  const debouncedName = useDebounced(value.businessName, 400);

  const usernameCheck = useQuery({
    ...trpc.agencies.checkUsername.queryOptions({ username: debouncedUsername, excludeAgencyId }),
    enabled: debouncedUsername.trim().length > 0,
  });
  const nameCheck = useQuery({
    ...trpc.agencies.checkBusinessName.queryOptions({ businessName: debouncedName, excludeAgencyId }),
    enabled: debouncedName.trim().length > 1,
  });

  const [customDiscipline, setCustomDiscipline] = useState('');

  // Disciplines (admin-editable, server-sourced) — the global list every agency
  // picks from. Sourced from globalSettings.disciplines so approved custom
  // disciplines show up here; falls back to the static defaults until seeded.
  const disciplinesQuery = useQuery(trpc.agencies.disciplines.queryOptions());
  const disciplineOptions = disciplinesQuery.data?.length ? disciplinesQuery.data : DISCIPLINES;

  // Infin8 taxonomy (admin-editable, server-sourced) — grouped substage picker.
  const infin8 = useQuery(trpc.agencies.infin8Stages.queryOptions());

  function toggleDiscipline(disc: string) {
    set('disciplines', value.disciplines.includes(disc) ? value.disciplines.filter((x) => x !== disc) : [...value.disciplines, disc]);
  }
  function addCustomDiscipline() {
    const d = customDiscipline.trim();
    if (!d || value.disciplines.includes(d)) return;
    set('disciplines', [...value.disciplines, d]);
    setCustomDiscipline('');
  }
  function toggleSubstage(substage: string) {
    if (value.infin8Substages.includes(substage)) {
      set('infin8Substages', value.infin8Substages.filter((x) => x !== substage));
    } else if (value.infin8Substages.length >= MAX_SUBSTAGES) {
      toast.warning(`You can only select up to ${MAX_SUBSTAGES} Infin8 substages.`);
    } else {
      set('infin8Substages', [...value.infin8Substages, substage]);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <FormSection title="Business identity">
        <Field label="Business name" htmlFor="ag-name" error={value.businessName && nameCheck.data && !nameCheck.data.available ? nameCheck.data.reason : null}>
          <div className="relative">
            <Input id="ag-name" value={value.businessName} onChange={(e) => onBusinessNameChange(e.target.value)} />
            <AvailabilityIcon loading={nameCheck.isFetching} available={nameCheck.data?.available} show={debouncedName.trim().length > 1} />
          </div>
        </Field>
        <Field label="Legal name" htmlFor="ag-legal"><Input id="ag-legal" value={value.legalName} onFocus={() => setLegalNameTouched(true)} onChange={(e) => { setLegalNameTouched(true); set('legalName', e.target.value); }} /></Field>
        <Field
          label="Subdomain (username)"
          htmlFor="ag-username"
          hint="3–20 lowercase letters. This becomes your tenant subdomain."
          error={value.username && usernameCheck.data && !usernameCheck.data.available ? usernameCheck.data.reason : null}
        >
          <div className="relative">
            <Input id="ag-username" value={value.username} onFocus={() => setUsernameTouched(true)} onChange={(e) => { setUsernameTouched(true); set('username', e.target.value.toLowerCase()); }} placeholder="youragency" />
            <AvailabilityIcon loading={usernameCheck.isFetching} available={usernameCheck.data?.available} show={debouncedUsername.trim().length > 0} />
          </div>
        </Field>
      </FormSection>

      <FormSection title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business email" htmlFor="ag-email"><Input id="ag-email" type="email" value={value.businessEmail} onChange={(e) => set('businessEmail', e.target.value)} /></Field>
          <Field label="Phone" htmlFor="ag-phone"><PhoneInput id="ag-phone" value={value.phone} onChange={(v) => set('phone', v)} /></Field>
        </div>
        <Field label="Website" htmlFor="ag-web" error={websiteError(value.website)}><Input id="ag-web" value={value.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business address" htmlFor="ag-address" hint="Shown on tax invoices."><Input id="ag-address" value={value.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, suburb, state, postcode" /></Field>
          <Field label="ABN" htmlFor="ag-abn" hint="Australian Business Number — shown on tax invoices."><Input id="ag-abn" value={value.abn} onChange={(e) => set('abn', e.target.value)} /></Field>
        </div>
      </FormSection>

      <FormSection title="About">
        <Field label="Short description" htmlFor="ag-short" hint="One line shown in listings.">
          <Input id="ag-short" value={value.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="ag-desc">
          <textarea id="ag-desc" className="min-h-[88px] rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm" value={value.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Disciplines" description="What your agency does. Add custom ones — they're sent to the platform for review.">
        <div className="flex flex-wrap gap-2">
          {disciplineOptions.map((disc) => <Chip key={disc} active={value.disciplines.includes(disc)} onClick={() => toggleDiscipline(disc)}>{disc}</Chip>)}
          {value.disciplines.filter((d) => !disciplineOptions.includes(d)).map((d) => <Chip key={d} active onClick={() => toggleDiscipline(d)}>{d}</Chip>)}
        </div>
        <div className="flex items-center gap-2">
          <Input className="max-w-xs" placeholder="Add a custom discipline" value={customDiscipline} onChange={(e) => setCustomDiscipline(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomDiscipline())} />
          <Button variant="ghost" size="sm" onClick={addCustomDiscipline}>Add</Button>
        </div>
      </FormSection>

      <FormSection
        title="Infin8 substages"
        description={`Choose the substages most relevant to what your agency offers (select 1–${MAX_SUBSTAGES}). ${value.infin8Substages.length}/${MAX_SUBSTAGES} selected.`}
      >
        {infin8.isLoading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                {Array.from({ length: 6 }).map((__, j) => <div key={j} className="h-7 w-28 animate-pulse rounded-[var(--radius-pill)] bg-inset" />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {(infin8.data ?? []).map((group) => (
              <div key={group.stage}>
                <div className="text-eyebrow mb-2 text-ink-60">{group.stage}</div>
                <div className="flex flex-wrap gap-2">
                  {group.substages.map((sub) => (
                    <Chip key={sub} active={value.infin8Substages.includes(sub)} onClick={() => toggleSubstage(sub)}>{sub}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="Social">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Facebook" htmlFor="ag-fb" error={websiteError(value.facebookUrl)}><Input id="ag-fb" value={value.facebookUrl} onChange={(e) => set('facebookUrl', e.target.value)} placeholder="https://facebook.com/…" /></Field>
          <Field label="X" htmlFor="ag-x" error={websiteError(value.xUrl)}><Input id="ag-x" value={value.xUrl} onChange={(e) => set('xUrl', e.target.value)} placeholder="https://x.com/…" /></Field>
          <Field label="Instagram" htmlFor="ag-ig" error={websiteError(value.instagramUrl)}><Input id="ag-ig" value={value.instagramUrl} onChange={(e) => set('instagramUrl', e.target.value)} placeholder="https://instagram.com/…" /></Field>
        </div>
      </FormSection>

      <FormSection title="Branding" description="Pick an accent — buttons, highlights, and selections across your tenant use shades of this colour.">
        <BrandingAccentPicker value={value.accentColor} onChange={(hex) => set('accentColor', hex)} />
      </FormSection>
    </div>
  );
}

/**
 * Accent swatch picker — preset palette + live shade preview. Ports the Flutter
 * profile_theme_color_card (kAccentSwatches), defaulting to Forest when unset.
 */
function BrandingAccentPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const selected = (value || DEFAULT_ACCENT_HEX).toLowerCase();
  const setPreviewAccent = useAccentTheme();

  // Preview the current selection across the whole app live. On unmount (leaving
  // the form without saving) clear the preview so the saved theme returns; after
  // a save the active-agency query updates and that becomes the new saved theme.
  useEffect(() => {
    setPreviewAccent(value || DEFAULT_ACCENT_HEX);
  }, [value, setPreviewAccent]);
  useEffect(() => () => setPreviewAccent(null), [setPreviewAccent]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        {ACCENT_SWATCHES.map((s) => {
          const isSelected = s.hex.toLowerCase() === selected;
          return (
            <button
              key={s.hex}
              type="button"
              title={s.name}
              onClick={() => onChange(s.hex)}
              style={{ backgroundColor: s.hex, boxShadow: isSelected ? `0 0 0 2px var(--color-card), 0 0 0 4px ${s.hex}` : undefined }}
              className={cn('press grid h-10 w-10 place-items-center rounded-full transition-transform', isSelected && 'scale-105')}
            >
              {isSelected && <Check className="h-5 w-5" style={{ color: onAccent(s.hex) }} />}
            </button>
          );
        })}
      </div>
      <div className="flex h-4 overflow-hidden rounded-[var(--radius-sm)] ring-1 ring-[color:var(--color-border-hairline)]">
        {shadeRamp(selected).map((shade, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: shade }} />
        ))}
      </div>
    </div>
  );
}

function AvailabilityIcon({ loading, available, show }: { loading: boolean; available?: boolean; show: boolean }) {
  if (!show) return null;
  return (
    <span className="absolute right-3 top-1/2 -translate-y-1/2">
      {loading ? <Loader2 className="h-4 w-4 animate-spin text-ink-40" /> : available ? <Check className="h-4 w-4 text-success" /> : <X className="h-4 w-4 text-danger" />}
    </span>
  );
}

/** Whether a draft passes the availability checks (used to gate submit). */
export function isProfileSubmittable(d: AgencyProfileDraft, usernameOk: boolean | undefined, nameOk: boolean | undefined): boolean {
  if (!d.businessName.trim()) return false;
  if (d.businessName.trim().length > 1 && nameOk === false) return false;
  if (d.username.trim() && usernameOk === false) return false;
  if (hasInvalidUrl(d)) return false;
  return true;
}
