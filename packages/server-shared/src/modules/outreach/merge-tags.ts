/**
 * OUTREACH MERGE TAGS — the one place a `{{tag}}` is defined, filled or checked.
 *
 * Dependency-free on purpose. The sequence editor in `packages/shared` imports
 * this module directly (`@server/modules/outreach/merge-tags`), which is what
 * keeps the operator's preview and the lead we actually upload from drifting
 * apart — they were two hand-maintained lists before, and they had already
 * disagreed about three tags.
 *
 * THE RULE: a tag that reaches a stranger's inbox must never be empty. Smartlead
 * substitutes blindly — an unset field becomes an empty string, so `Hi
 * {{first_name}},` ships as `Hi ,`. Since we are the ones writing the lead, the
 * fix belongs at UPLOAD time: every tag below is written with a fallback, so a
 * template degrades gracefully by construction rather than by the operator
 * remembering to write around a null.
 */

/** A tag the template may use, and what fills it when the prospect has nothing. */
export interface MergeTag {
  /** The literal token, braces included, as it appears in a template body. */
  tag: string;
  /** The field name Smartlead knows it by — the token without its braces. */
  key: string;
  /** Operator-facing name in the tag picker. */
  label: string;
  /**
   * What this becomes for a prospect with no value. Empty string means "no
   * grammatical fallback exists" — see `NUMERIC_TAGS`.
   */
  fallback: string;
  /** Extra context under the tag picker, where the tag needs explaining. */
  hint?: string;
}

/**
 * The tags a template may use. Anything else won't resolve at send time, which
 * is why `findUnknownTags` rejects it before the sequence reaches Smartlead.
 *
 * Fallbacks are written to read inside a sentence, not to announce themselves:
 * "I had a look at your website" is what a person would have typed anyway, so
 * the prospect can't tell the personalisation missed.
 */
export const MERGE_TAGS: readonly MergeTag[] = [
  {
    tag: '{{first_name}}',
    key: 'first_name',
    label: 'First name',
    fallback: 'there',
    hint: 'Google Maps lists businesses, not people, so this is always the fallback — "Hi there,".',
  },
  {
    tag: '{{company_name}}',
    key: 'company_name',
    label: 'Business name',
    fallback: 'your business',
  },
  { tag: '{{website}}', key: 'website', label: 'Website', fallback: 'your website' },
  { tag: '{{location}}', key: 'location', label: 'Location', fallback: 'your area' },
  {
    tag: '{{hook}}',
    key: 'hook',
    label: 'Review opener',
    fallback: 'how your Google reviews are tracking',
    hint: 'e.g. "you are on 11 Google reviews at 4.2 stars — the typical dentist in Inner West is on 84"',
  },
  {
    tag: '{{reviews}}',
    key: 'reviews',
    label: 'Google review count',
    fallback: '',
    hint: 'Blank when the scrape returned no count. Prefer {{hook}} — it is a whole sentence and always reads.',
  },
  {
    tag: '{{rating}}',
    key: 'rating',
    label: 'Google star rating',
    fallback: '',
    hint: 'Blank for a business with no reviews yet. Prefer {{hook}}.',
  },
  {
    tag: '{{detail}}',
    key: 'detail',
    label: 'Personalisation detail',
    fallback: 'the work you do',
  },
] as const;

/**
 * The two tags that can still render blank, and the reason they are exempt.
 *
 * Every other tag slots a noun phrase into a sentence, so a fallback noun
 * phrase keeps the grammar intact. These two slot a NUMBER — "you're on
 * {{reviews}} reviews" — and there is no number we can invent that isn't a
 * claim about a business we just failed to measure. Rather than lie, they stay
 * blank and the editor warns. `{{hook}}` is the safe way to put those figures in
 * a sentence, because it is composed server-side and refuses to speak when the
 * data doesn't support it.
 */
export const NUMERIC_TAGS: readonly string[] = ['reviews', 'rating'];

/** Every `{{tag}}` occurrence in a body, braces stripped. */
const TAG_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

const BY_KEY = new Map(MERGE_TAGS.map((t) => [t.key, t]));

/** The fallback for a tag, or empty string for one that has none. */
export function fallbackFor(key: string): string {
  return BY_KEY.get(key)?.fallback ?? '';
}

/**
 * Tags used in a body that aren't in `MERGE_TAGS` — i.e. typos.
 *
 * `{{buisness_name}}` used to save cleanly and then send a literal `{{...}}` to
 * every prospect on the list, because nothing between the textarea and
 * Smartlead ever looked. Returned deduped and in first-seen order so the error
 * message reads the way the operator's body does.
 */
export function findUnknownTags(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TAG_PATTERN)) {
    const key = m[1];
    if (!BY_KEY.has(key)) seen.add(`{{${key}}}`);
  }
  return [...seen];
}

/** Known tags used in a body that can still render blank — worth warning about. */
export function findBlankableTags(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TAG_PATTERN)) {
    const key = m[1];
    if (BY_KEY.has(key) && NUMERIC_TAGS.includes(key)) seen.add(`{{${key}}}`);
  }
  return [...seen];
}

/** What we know about a prospect, in the shape both the pusher and the preview have. */
export interface MergeSource {
  businessName?: string | null;
  website?: string | null;
  /** The scraped street address — what Smartlead calls `location`. */
  address?: string | null;
  hook?: string | null;
  detail?: string | null;
  reviewsCount?: number | null;
  /** Numeric from the scrape, string from the `numeric` column. Both accepted. */
  rating?: number | string | null;
}

/** Every merge key resolved to the string the recipient will actually see. */
export type MergeValues = Record<string, string>;

function text(v: string | null | undefined, key: string): string {
  const trimmed = (v ?? '').trim();
  return trimmed || fallbackFor(key);
}

/**
 * Resolve one prospect into the values every `{{tag}}` will take.
 *
 * The single source of truth for BOTH sides of the promise: the lead we upload
 * to Smartlead, and the preview the operator signs off. When they were computed
 * separately the preview faked `first_name` from the first word of the business
 * name — so the screen showed "Hi Sydney," while every recipient got "Hi ,".
 */
export function resolveMergeValues(p: MergeSource): MergeValues {
  const rating =
    p.rating === null || p.rating === undefined
      ? ''
      : typeof p.rating === 'number'
        ? p.rating.toFixed(1)
        : (Number.parseFloat(p.rating) || 0).toFixed(1);

  return {
    // No person's name exists anywhere in the pipeline — Maps returns
    // businesses. This is the fallback for every lead, and that is the honest
    // outcome rather than a gap: "Hi there," is what a person writing to an
    // info@ address types anyway.
    first_name: fallbackFor('first_name'),
    company_name: text(p.businessName, 'company_name'),
    website: text(p.website, 'website'),
    location: text(p.address, 'location'),
    hook: text(p.hook, 'hook'),
    detail: text(p.detail, 'detail'),
    reviews: p.reviewsCount === null || p.reviewsCount === undefined ? '' : String(p.reviewsCount),
    rating,
  };
}

/**
 * Render a body the way Smartlead will.
 *
 * An unknown tag is left intact rather than blanked, so a typo that slipped past
 * `findUnknownTags` — an older sequence, saved before the check existed — is
 * visible in the preview instead of vanishing into a hole.
 */
export function renderTemplate(body: string, values: MergeValues): string {
  return body.replace(TAG_PATTERN, (whole, key: string) => (key in values ? values[key] : whole));
}
