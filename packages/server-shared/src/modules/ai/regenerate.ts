/**
 * Card "Regenerate" — REIMAGINE the human-facing text on an AI action card in a
 * COMPLETELY SEPARATE, single-shot conversation. A user hitting Regenerate is a
 * rejection signal: they disliked the draft and want a fundamentally different
 * take, not a nicer phrasing of the same one. So this never refines in place — it
 * hands the model the brand's profile block (the same identity/voice context the
 * assistant carries, via buildProfileBlock) plus the rejected draft, and asks it
 * to start over: new angle, structure, and framing, with full latitude to change
 * length and wording. It never touches the chat thread's history or the streaming
 * turn loop. Facts stay pinned regardless of how bold the rewrite gets — the exact
 * JSON shape, ids, urls, enums, numbers, colours, and real-world names are copied
 * through unchanged by reconcile(), so only prose is ever reimagined.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { brandKits, brands } from '../../db/schema.js';
import { completeOnce, resolveBrandFamily } from './provider-config.js';
import { buildProfileBlock } from './system-prompt.js';

type Brand = typeof brands.$inferSelect;

/**
 * Keys whose values are identifiers / URLs / enums / structured facts — never
 * "prose" — so the model's rewrite must never change them, even if it returns a
 * different value. Restored from the original after the model responds. Matched
 * anywhere in the payload tree (top-level or nested), case-sensitively.
 */
const PROTECTED_KEYS = new Set<string>([
  // Identifiers, enums, structural / machine fields.
  'id', 'toolUseId', 'brandId', 'agencyId', 'linkId', 'locationId', 'collectionId',
  'priceId', 'placeId', 'assigneeId', 'customerId', 'slug', 'type', 'displayType',
  'stage', 'scope', 'mode', 'isActive', 'lat', 'lng', 'billing', 'requestFields',
  'email', 'customerEmail', 'website', 'destinationUrl', 'url',
  // Brand-asset lists are hex codes / font names, not prose.
  'colors', 'typography',
  // Factual identity + real-world names of people/places/entities: these are
  // facts to preserve, not copy to "improve".
  'businessName', 'legalName', 'contactName', 'phone', 'abn', 'yearFounded', 'address',
  'customerName', 'assigneeName', 'agencyName', 'locationName', 'serviceName',
]);

/**
 * Walk the ORIGINAL payload and graft the model's improvements onto it: accept a
 * rewritten value only where the original was prose (a string, or an array of
 * strings) and the key isn't protected; otherwise keep the original. This
 * guarantees the returned payload has exactly the original's shape and structural
 * fields — the model can only ever change human-readable copy.
 */
function reconcile(original: unknown, improved: unknown, key?: string): unknown {
  if (key && PROTECTED_KEYS.has(key)) return original;

  if (typeof original === 'string') {
    return typeof improved === 'string' && improved.trim() ? improved : original;
  }

  if (Array.isArray(original)) {
    // string[] (e.g. tags/bullets) — accept a same-typed, non-empty replacement.
    if (original.every((v) => typeof v === 'string')) {
      return Array.isArray(improved) && improved.length && improved.every((v) => typeof v === 'string')
        ? improved
        : original;
    }
    // array of objects (e.g. members/locations) — reconcile element-wise by index,
    // never adding or dropping elements.
    if (Array.isArray(improved)) return original.map((el, i) => reconcile(el, improved[i]));
    return original;
  }

  if (original && typeof original === 'object') {
    const imp = improved && typeof improved === 'object' ? (improved as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(original as Record<string, unknown>)) {
      out[k] = reconcile(v, imp[k], k);
    }
    return out;
  }

  // numbers, booleans, null, undefined — kept verbatim.
  return original;
}

function parsePayload(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall back to the first {...} block if the model wrapped it in prose.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Regenerate one action card's content. Returns a payload of the SAME shape as
 * the input with its prose reimagined (facts/ids/enums/numbers copied through);
 * throws if the model returns nothing usable (the caller keeps the existing card
 * unchanged).
 */
export async function regenerateCardContent(opts: {
  db: DB;
  brand: Brand;
  kind: string;
  payload: Record<string, unknown>;
  // Reimagined payloads already produced for this card (gen1, gen2, …). The new
  // generation must differ from the original AND from every one of these, so the
  // user gets a genuinely fresh take each press — never a rehash of a prior one.
  previous?: Record<string, unknown>[];
  userId?: string | null;
  client?: string | null;
}): Promise<Record<string, unknown>> {
  const { db, brand, kind, payload } = opts;
  const previous = opts.previous ?? [];

  // The DEFAULT kit is the brand kit (a brand also holds one kit per signature department).
  const [kit] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brand.id), eq(brandKits.isDefault, true)))
    .limit(1);
  const profile = buildProfileBlock(brand, kit ?? null);

  const system =
    'You are a senior brand copywriter and creative director. The assistant drafted one piece of ' +
    'content for this business, shown below as a JSON "action card" payload — and the user REJECTED ' +
    'it by asking to regenerate. Treat the draft as the wrong direction. Do not refine or rephrase ' +
    'it: rethink it from scratch. Take a genuinely different angle, hook, structure, and framing, ' +
    'and write it fresh so it lands as unmistakably on-brand for the voice, tone, and positioning in ' +
    'the brand profile.\n\n' +
    'Rules:\n' +
    '- Return ONLY a JSON object with the EXACT same keys and structure as the input. No prose, no markdown, no code fences around it.\n' +
    '- Reimagine ONLY human-facing text (names, descriptions, messages, taglines, positioning copy). You have full latitude here: change the wording, structure, order, emphasis, and length freely — do not anchor to the rejected draft.\n' +
    '- Never change identifiers, URLs, slugs, email addresses, enum/type values, numbers, booleans, colours, or fonts — copy them through unchanged.\n' +
    '- Stay truthful: keep every factual specific (real names, prices, dates, claims) accurate and do not invent new ones. Reframing is welcome; fabricating facts is not.\n' +
    (previous.length
      ? '- You have ALREADY produced the alternative takes listed below and the user rejected each one too. Do NOT repeat their angle, structure, wording, or hooks — deliberately go somewhere new that is distinct from all of them.\n'
      : '') +
    (profile ? `\n${profile}\n` : '');

  const user =
    `Action card kind: ${kind}\n\n` +
    'This is the ORIGINAL draft the user rejected. Reimagine it — same JSON keys and structure, ' +
    'reimagined prose:\n' +
    JSON.stringify(payload, null, 2) +
    (previous.length
      ? `\n\nAlternative takes you ALREADY produced (also rejected) — your new version must be clearly different from every one of these:\n${previous
          .map((p, i) => `--- Rejected take ${i + 1} ---\n${JSON.stringify(p, null, 2)}`)
          .join('\n')}`
      : '') +
    '\n\nReturn the full JSON object for a fresh, meaningfully different take:';

  const raw = await completeOnce({
    db,
    source: 'card_regenerate',
    system,
    prompt: user,
    maxTokens: 4000,
    family: await resolveBrandFamily(db, brand.id),
    // Strategy is the one place the model is a TENANT choice — the brand picked
    // this family, so the per-feature override must not quietly replace it.
    ignoreFeatureModel: true,
    brandId: brand.id,
    userId: opts.userId ?? null,
    client: opts.client ?? null,
  });

  const improved = parsePayload(raw);
  if (!improved || typeof improved !== 'object') {
    throw new Error('Regeneration returned no usable content.');
  }
  return reconcile(payload, improved) as Record<string, unknown>;
}
