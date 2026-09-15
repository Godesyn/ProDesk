import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { brands, brandKits } from '../../db/schema.js';

type Brand = typeof brands.$inferSelect;
type BrandKit = typeof brandKits.$inferSelect;

// The static system prompt (role, rules, capabilities, and the Infin8 strategy
// knowledge) lives in system-prompt.md so it can be edited as prose. It is only
// ever shipped in src/ (tsc doesn't copy .md into dist/), so resolve it via the
// package root — the same depth ('../../../') from both src/modules/ai and
// dist/modules/ai, mirroring how lib/env.ts reaches repo-root files.
const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(
  resolve(here, '../../../src/modules/ai/system-prompt.md'),
  'utf8',
);

const BRAND_PROFILE_TOKEN = '{{BRAND_PROFILE}}';
const BILLING_ACCESS_TOKEN = '{{BILLING_ACCESS_NOTICE}}';

// Billing-access notice, chosen per request by the brand OWNER's beta status
// (beta is owner-scoped — it's the owner's flag that actually waives every
// charge, since userHasFeature short-circuits on the owner and per-unit metering
// skips beta owners). Two mutually exclusive variants so a non-beta user's
// assistant has NO knowledge that beta access exists at all.
const BILLING_ACCESS_NON_BETA =
  'Never mention, hint at, or speculate about any beta access program, beta users, or beta exemptions — that concept does not exist for you. If something appears to be free or already unlocked for this brand, simply state that it is included on their current plan.';
const BILLING_ACCESS_BETA =
  "This account has BETA ACCESS: its owner is never actually charged for any feature — every subscription and per-unit paid action is free for them. Keep disclosing pricing exactly as usual — quote the standard price from `list_feature_subscriptions` so the user knows what it would normally cost — but in place of the **Card** line for a paid action, state that, thanks to beta access, no charge will be taken. Always give the supposed price FIRST, then the beta waiver; never skip the price. This applies to this account only: never present beta as a general programme, and never discuss whether other users have it.";

/**
 * Build the brand-specific profile block that gets injected into the static
 * prompt template. Kept stable (no timestamps / per-request data) so the whole
 * prompt caches as a prefix.
 */
export function buildProfileBlock(brand: Brand, kit?: BrandKit | null): string {
  const profile: string[] = [];
  const add = (label: string, v?: string | null) => {
    if (v && v.trim()) profile.push(`- ${label}: ${v.trim()}`);
  };
  const addList = (label: string, v?: string[] | null) => {
    const items = (v ?? []).map((s) => s?.trim()).filter(Boolean);
    if (items.length) profile.push(`- ${label}: ${items.join(', ')}`);
  };
  // Identity
  add('Business name', brand.businessName);
  add('Legal name', brand.legalName);
  add('Industry', brand.industry);
  add('Year founded', brand.yearFounded);
  add('Website', brand.website);
  // Contact
  add('Contact name', brand.contactName);
  add('Contact email', brand.email);
  add('Phone', brand.phone);
  add('Address', brand.address);
  add('ABN', brand.abn);
  // Positioning & voice
  add('Target audience', brand.targetAudience);
  add('Competitors', brand.competitors);
  add('Unique selling proposition', brand.usp);
  add('Brand values', brand.brandValues);
  add('Tone of voice', brand.toneOfVoice);
  add('Key messaging', brand.keyMessaging);
  // Brand assets
  addList('Brand colours', brand.colors);
  addList('Typography', brand.typography);
  // Brand kit — the design/voice the brand uses everywhere it appears. Injected
  // here so the assistant knows it WITHOUT calling a tool. Stable per brand, so
  // it does not break prompt caching.
  if (kit) {
    add('Brand tagline', kit.brandTagline);
    add('Brand display name', kit.brandDisplayName);
    const voice = kit.voice;
    if (voice) {
      addList('Voice — tone', voice.tone);
      addList('Voice — words we use', voice.preferred);
      addList('Voice — words we never use', voice.banned);
      add('Voice — reading level', voice.readingLevel);
      addList('Voice — example lines', voice.examples);
    }
    add('Signature default template', kit.defaultTemplate);
    add('Signature disclaimer', kit.disclaimer);
  }
  // Policies & locations (structured) — summarise titles/labels, not full bodies.
  const policyTitles = (brand.policies ?? []).map((p) => p?.title?.trim()).filter(Boolean);
  if (policyTitles.length) profile.push(`- Policies on file: ${policyTitles.join(', ')}`);
  const locationLabels = (brand.locations ?? [])
    .map((l) => [l?.label?.trim(), l?.address?.trim()].filter(Boolean).join(' — '))
    .filter(Boolean);
  if (locationLabels.length) profile.push(`- Locations: ${locationLabels.join('; ')}`);

  if (!profile.length) return '';
  return `# The brand you assist\n\n${profile.join('\n')}`;
}

/**
 * Build the STATIC part of a brand's system prompt: the markdown template with
 * this brand's profile woven in at the {{BRAND_PROFILE}} marker, and the
 * billing-access notice chosen by `ownerIsBeta` (the brand owner's beta status —
 * see the notice constants above). A non-beta assistant never learns that beta
 * access exists.
 *
 * The enabled-skills section is deliberately NOT included here — it's the one
 * part of the prompt an owner changes at runtime (the Skills checklist), so it's
 * emitted as its own system block via `buildSkillsSection` with its own
 * prompt-cache breakpoint. Keeping it out of this block means toggling a skill
 * no longer busts the cache on this (larger, stable-per-brand) prefix.
 */
export function buildSystemPrompt(
  brand: Brand,
  kit?: BrandKit | null,
  ownerIsBeta = false,
): string {
  const block = buildProfileBlock(brand, kit);
  const notice = ownerIsBeta ? BILLING_ACCESS_BETA : BILLING_ACCESS_NON_BETA;
  const withNotice = TEMPLATE.replace(BILLING_ACCESS_TOKEN, notice);
  const base = withNotice.includes(BRAND_PROFILE_TOKEN)
    ? withNotice.replace(BRAND_PROFILE_TOKEN, block)
    : // No marker in the template — append the profile at the end as a fallback.
      `${withNotice.trimEnd()}${block ? `\n\n${block}` : ''}`;
  return `${base.trimEnd()}\n`;
}

/**
 * The brand's enabled skills (prose playbooks) as their own prompt section,
 * or '' when none are enabled. Emitted as a separate system block after
 * `buildSystemPrompt` so it carries its own cache breakpoint: the owner can
 * switch skills off (varies per brand, changes at runtime), and isolating it
 * keeps a toggle from invalidating the static prefix before it.
 */
export function buildSkillsSection(skillsBlock = ''): string {
  const trimmed = skillsBlock.trim();
  if (!trimmed) return '';
  return `# Your skills\n\nThese are specialised playbooks for particular kinds of work. Follow the relevant one whenever a request calls for it; never name or mention "skills" to the user.\n\n${trimmed}\n`;
}
