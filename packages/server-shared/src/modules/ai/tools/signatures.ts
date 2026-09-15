/**
 * Email-signature (SIGKITT) tools: members/seats, brand-level settings, campaigns, analytics.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { signatureCampaignBanners, signatureCampaigns, signatureMembers } from '../../../db/schema.js';
import { brandOwnerId, brandHasFeature, isBetaUser } from '../../feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../../feature-subscriptions/feature-keys.js';
import { countOwnerSignatureMembers, ensureBrandKit, getSignaturesOffer, signaturesBillableUnits } from '../../signatures/billing.js';
import { loadCombinedBrandKitReadOnly } from '../../signatures/brand-kit-view.js';
import { listSignatureMembers, signatureEventTotals, signatureEventsByMember } from '../../signatures/queries.js';
import { obj, HEX_COLOR, getOwnerCardOnFile, cardPhrase, SIGNATURE_MEMBER_FIELDS, SIGNATURE_MEMBER_FIELD_PROPS, SIGNATURE_MEMBER_FIELD_LABELS, SIGNATURE_SETTINGS_FIELD_LABELS, EMAIL_RE, cleanSignatureMember, CREATE_ANYWAY_PROP, findSimilarByName, similarExistsResult } from './helpers.js';
import type { ActionBilling } from './types.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function signatureTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'list_signature_members',
        description: [
          "List THIS brand's email-signature team members (the people who have a signature in the Signatures app — NOT the same as list_staff, which is account/team access). Takes no arguments. Capped at 100 rows, alphabetical.",
          'Each ACTIVE member is a billable SEAT: the brand owner is billed per seat per month with the first seat free (see list_feature_subscriptions for the current per-seat price).',
          'Returns { count, activeCount, members } where members is an array of:',
          '- id: member UUID. Pass this as memberId to update_signature_member.',
          '- fullName, jobTitle, department, email, phone, mobile: the signature contact fields (any may be null).',
          '- isActive: boolean — false means the seat is created but parked (unpaid / awaiting checkout) and does not render or bill.',
          '- createdAt: ISO timestamp.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (also backs tRPC signatures.members.list). Include
        // parked (inactive) seats so the model can report the full roster + which
        // are billable; capped at 100.
        const rows = await listSignatureMembers(db, { brandId, includeInactive: true, limit: 100 });
        return {
          count: rows.length,
          activeCount: rows.filter((r) => r.isActive).length,
          members: rows.map((r) => ({
            id: r.id,
            fullName: r.fullName,
            jobTitle: r.jobTitle,
            department: r.department,
            email: r.email,
            phone: r.phone,
            mobile: r.mobile,
            isActive: r.isActive,
            createdAt: r.createdAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_signature_settings',
        description: [
          "Get THIS brand's signature branding/template settings (the brand-level design every member's signature inherits in the Signatures app). Takes no arguments. Read this before update_signature_settings so you change only what the user asked for.",
          'Returns { initialized: false } if the brand has never opened the Signatures app (defaults apply). Otherwise returns:',
          '- name: the internal workspace name.',
          '- brandDisplayName / brandTagline: the name + tagline rendered on signatures (may be null).',
          '- website, address: contact fields rendered on signatures.',
          '- primaryColor, secondaryColor, barColor, barTextColor: hex colours used by the templates.',
          '- fontFamily: the signature font.',
          '- logoUrl / logoWidth, barLogoUrl, poweredByLabel: logo settings.',
          '- disclaimer: the legal disclaimer text appended to signatures (may be null).',
          '- defaultTemplate: the template new signatures use (e.g. "classic").',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const sb = await loadCombinedBrandKitReadOnly(db, brandId);
        if (!sb) {
          return { initialized: false, note: 'The Signatures workspace has not been opened yet — defaults apply. Settings can still be proposed with update_signature_settings.' };
        }
        return {
          initialized: true,
          name: sb.name,
          brandDisplayName: sb.brandDisplayName,
          brandTagline: sb.brandTagline,
          website: sb.website,
          address: sb.address,
          primaryColor: sb.primaryColor,
          secondaryColor: sb.secondaryColor,
          barColor: sb.barColor,
          barTextColor: sb.barTextColor,
          fontFamily: sb.fontFamily,
          logoUrl: sb.logoUrl,
          logoWidth: sb.logoWidth,
          barLogoUrl: sb.barLogoUrl,
          poweredByLabel: sb.poweredByLabel,
          disclaimer: sb.disclaimer,
          defaultTemplate: sb.defaultTemplate,
        };
      },
    },
    {
      def: {
        name: 'get_signature_analytics',
        description: [
          "Get THIS brand's email-signature engagement analytics — clicks tracked on links inside members' signatures (social icons, banners, website, email, phone). Takes no arguments.",
          'Returns an object:',
          '- total: INTEGER total tracked events (all time).',
          '- byType: array of { eventType, count } — eventType is one of "banner_click", "cta_click", "social_click", "email_click", "phone_click", "website_click", "verdiict_review_click", "verdiict_reviews_click".',
          '- byMember: array (top 10, most-clicked first) of { memberId, memberName, total } — which team members\' signatures drive the most engagement.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared cores (also back tRPC analytics.summary + analytics.byMember).
        const [totals, byMember] = await Promise.all([
          signatureEventTotals(db, { brandId }),
          signatureEventsByMember(db, { brandId, limit: 10 }),
        ]);
        return { total: totals.total, byType: totals.byType, byMember };
      },
    },
    {
      def: {
        name: 'list_signature_campaigns',
        description: [
          "List THIS brand's SIGNATURE campaigns — rotating promotional banners appended to team members' email signatures (with a click-through link and optional start/end dates). NOTE: these are different from LINK campaigns (list_link_campaigns), which are short links whose destination changes by date. If the user says \"campaign\" and it is unclear which they mean, ASK before acting. Takes no arguments. Capped at 50 rows, newest first.",
          'Returns { count, campaigns } where campaigns is an array of:',
          '- id: campaign UUID.',
          '- name: campaign name.',
          '- linkUrl: the click-through URL of the banner (may be null).',
          '- isActive: boolean — whether the campaign is currently enabled.',
          '- startsAt / endsAt: ISO timestamps of the scheduled window (null = no bound).',
          '- rotationMode: "sequential" or "random" — how multiple banners rotate.',
          '- memberName: the single member this campaign is scoped to, or null when it shows on every member\'s signature.',
          '- bannerCount: INTEGER number of banner images uploaded (banners are uploaded in the Signatures app; this tool cannot add images).',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const rows = await db
          .select({
            id: signatureCampaigns.id,
            name: signatureCampaigns.name,
            linkUrl: signatureCampaigns.linkUrl,
            isActive: signatureCampaigns.isActive,
            startsAt: signatureCampaigns.startsAt,
            endsAt: signatureCampaigns.endsAt,
            rotationMode: signatureCampaigns.rotationMode,
            memberName: signatureMembers.fullName,
          })
          .from(signatureCampaigns)
          .leftJoin(signatureMembers, eq(signatureCampaigns.memberId, signatureMembers.id))
          .where(eq(signatureCampaigns.brandId, brandId))
          .orderBy(desc(signatureCampaigns.createdAt))
          .limit(50);
        const ids = rows.map((r) => r.id);
        const bannerCounts = ids.length
          ? await db
              .select({ campaignId: signatureCampaignBanners.campaignId, n: count() })
              .from(signatureCampaignBanners)
              .where(inArray(signatureCampaignBanners.campaignId, ids))
              .groupBy(signatureCampaignBanners.campaignId)
          : [];
        const bannersBy = new Map(bannerCounts.map((b) => [b.campaignId, Number(b.n)]));
        return {
          count: rows.length,
          campaigns: rows.map((r) => ({ ...r, bannerCount: bannersBy.get(r.id) ?? 0 })),
        };
      },
    },
    {
      def: {
        name: 'add_signature_members',
        description: [
          'Propose adding one or MORE email-signature team members (seats) to this brand in a single action — use it for bulk imports too (e.g. from an attached CSV: map the columns to the member fields, then pass every row in ONE call). This surfaces a confirm card; nothing is created until the USER clicks confirm.',
          'THIS IS A PAID ACTION: seats are billed monthly per member beyond the free allowance. The tool computes the exact billing impact (how many of the new seats are billable, the per-seat price, and the card that will be charged) and shows it on the confirm card — but YOU must also state it plainly in your reply, using the pricing-disclosure pattern from your instructions, BEFORE or alongside calling this tool. Never present adding members as free.',
          'Validation, or the call returns { error }: members must be an array of 1–50 entries; each needs a non-empty fullName; email (when given) must be valid. Duplicate emails within the batch, or matching an existing member, are rejected so the same person is not imported twice.',
          'Returns { status: "awaiting_confirmation", billing } on success — billing restates the money impact so you can quote it. NOTHING is created until the user confirms. If the owner is not subscribed yet and has no card on file, confirming opens Stripe Checkout first.',
        ].join('\n'),
        input_schema: obj(
          {
            members: {
              type: 'array',
              items: {
                type: 'object',
                properties: SIGNATURE_MEMBER_FIELD_PROPS,
                required: ['fullName'],
                additionalProperties: false,
              },
              description: 'The members to add (1–50). Provide every field you know; omit unknown fields rather than inventing values.',
            },
          },
          ['members'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const rawMembers = Array.isArray(input.members) ? input.members : [];
        if (rawMembers.length === 0) return { error: 'Provide at least one member to add.' };
        if (rawMembers.length > 50) return { error: 'Add at most 50 members in one action.' };
        const members: Record<string, string>[] = [];
        const batchEmails = new Set<string>();
        for (let i = 0; i < rawMembers.length; i++) {
          const raw = rawMembers[i];
          if (!raw || typeof raw !== 'object') return { error: `Member ${i + 1} must be an object.` };
          const cleaned = cleanSignatureMember(raw as Record<string, unknown>, `Member ${i + 1}`);
          if ('error' in cleaned) return { error: cleaned.error };
          const email = cleaned.member.email?.toLowerCase();
          if (email) {
            if (batchEmails.has(email)) return { error: `Member ${i + 1}: "${email}" appears more than once in this batch.` };
            batchEmails.add(email);
          }
          members.push(cleaned.member);
        }
        // Reject emails that already exist on this brand's roster so a re-run
        // of a CSV import doesn't duplicate people.
        if (batchEmails.size) {
          const existing = await db
            .select({ email: signatureMembers.email })
            .from(signatureMembers)
            .where(eq(signatureMembers.brandId, brandId));
          const existingEmails = new Set(existing.map((e) => e.email?.toLowerCase()).filter(Boolean));
          const dupes = [...batchEmails].filter((e) => existingEmails.has(e));
          if (dupes.length) return { error: `Already on the roster: ${dupes.join(', ')}. Remove them from the batch (use update_signature_member to edit existing members).` };
        }

        // Billing impact: seats are owner-wide, first SIGNATURES_FREE_ALLOWANCE free.
        const ownerId = await brandOwnerId(db, brandId);
        if (!ownerId) return { error: 'Brand owner not found.' };
        const [currentSeats, subscribed, offer, card, exempt] = await Promise.all([
          countOwnerSignatureMembers(db, ownerId),
          brandHasFeature(db, brandId, FEATURE_KEYS.EMAIL_SIGNATURES),
          getSignaturesOffer(db),
          getOwnerCardOnFile(db, brandId),
          isBetaUser(db, ownerId),
        ]);
        const billableNow = signaturesBillableUnits(currentSeats);
        const billableAfter = signaturesBillableUnits(currentSeats + members.length);
        // An exempt owner is never billed — every seat reads as free (and the
        // exemption itself is never named).
        const addedBillable = exempt ? 0 : billableAfter - billableNow;
        const unit = offer?.unitAmount ?? null;
        const currency = offer?.currency ?? 'AUD';
        const monthlyDelta = unit != null ? unit * addedBillable : null;
        const priceText = unit != null ? `$${unit.toFixed(2)} ${currency}/seat/month` : 'the current per-seat monthly rate';
        let summary: string;
        if (exempt) {
          summary = `Adding ${members.length} member${members.length > 1 ? 's' : ''} is included on this brand's current plan — no additional charge.`;
        } else if (addedBillable === 0) {
          summary = `Adding ${members.length} member${members.length > 1 ? 's' : ''} requires no additional charge.`;
        } else {
          const deltaText = monthlyDelta != null ? `$${monthlyDelta.toFixed(2)} ${currency}/month` : `${addedBillable} × ${priceText}`;
          summary = subscribed
            ? `Adding ${members.length} member${members.length > 1 ? 's' : ''} adds ${addedBillable} billable seat${addedBillable > 1 ? 's' : ''} (${deltaText}) to the existing Signatures subscription, charged to ${cardPhrase(card)}.`
            : card
              ? `Adding ${members.length} member${members.length > 1 ? 's' : ''} starts the Signatures subscription: ${addedBillable} billable seat${addedBillable > 1 ? 's' : ''} at ${priceText} (${deltaText}), charged to ${cardPhrase(card)}.`
              : `Adding ${members.length} member${members.length > 1 ? 's' : ''} requires the Signatures subscription (${addedBillable} billable seat${addedBillable > 1 ? 's' : ''} at ${priceText}). No card is on file, so Stripe Checkout will open to collect payment.`;
        }
        const billing: ActionBilling = {
          summary,
          monthlyDelta,
          currency,
          cardBrand: card?.brand ?? null,
          cardLast4: card?.last4 ?? null,
          requiresCheckout: addedBillable > 0 && !subscribed,
        };
        pendingActions.push({
          kind: 'add_signature_members',
          toolUseId,
          payload: {
            members,
            billing,
            // For the confirm step's subscribe-then-add path when the owner
            // isn't subscribed yet.
            priceId: offer?.priceId ?? null,
          },
        });
        return {
          status: 'awaiting_confirmation',
          billing,
          note: `Confirm card surfaced to the user with ${members.length} member(s). NOTHING is created until they confirm. State the billing impact plainly in your reply.`,
        };
      },
    },
    {
      def: {
        name: 'update_signature_member',
        description: [
          "Propose editing an existing email-signature member's details (name, title, contact fields, social links). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Use list_signature_members to find the memberId, and provide ONLY the fields you want to change. Editing a member does not change billing.",
          'Validation, or the call returns { error }: the member must belong to this brand; fullName (when provided) cannot be empty; email (when provided) must be valid — pass an empty string to clear an optional field. Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms.',
        ].join('\n'),
        input_schema: obj(
          {
            memberId: { type: 'string', description: "The member's id (from list_signature_members). Must belong to this brand." },
            ...SIGNATURE_MEMBER_FIELD_PROPS,
          },
          ['memberId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const memberId = String(input.memberId ?? '');
        const [m] = await db
          .select({ id: signatureMembers.id, fullName: signatureMembers.fullName })
          .from(signatureMembers)
          .where(and(eq(signatureMembers.id, memberId), eq(signatureMembers.brandId, brandId)))
          .limit(1);
        if (!m) return { error: 'That signature member does not belong to this brand.' };
        const data: Record<string, string> = {};
        const changes: Record<string, string> = {};
        for (const f of SIGNATURE_MEMBER_FIELDS) {
          const v = input[f];
          if (v === undefined || v === null) continue;
          if (typeof v !== 'string') return { error: `${f} must be text.` };
          const t = v.trim();
          if (f === 'fullName' && !t) return { error: 'fullName cannot be empty.' };
          if (f === 'email' && t && !EMAIL_RE.test(t)) return { error: `"${t}" is not a valid email address.` };
          data[f] = t;
          changes[SIGNATURE_MEMBER_FIELD_LABELS[f] ?? f] = t || '— cleared —';
        }
        if (Object.keys(data).length === 0) return { error: 'Provide at least one field to change.' };
        pendingActions.push({
          kind: 'update_signature_member',
          // Spread the proposed fields to top-level so the confirm card can render
          // them as editable inputs; `data` stays as the authoritative key list.
          toolUseId,
          payload: { memberId, memberName: m.fullName, ...data, data, changes },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_signature_settings',
        description: [
          "Propose updating this brand's signature branding/template settings — the design every member's signature inherits (display name, tagline, colours, font, disclaimer, default template, website/address lines). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Read get_signature_settings first and provide ONLY the fields you want to change. Free — no billing impact.",
          'Validation, or the call returns { error }: at least one field is required; colour fields must be 6-digit hex like "#1a2b3c"; logoWidth must be 40–400. Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. (Logo image uploads are done in the Signatures app, not here.)',
        ].join('\n'),
        input_schema: obj(
          {
            brandDisplayName: { type: 'string', description: 'The brand name rendered on signatures.' },
            brandTagline: { type: 'string', description: 'Tagline rendered under the brand name. Empty string to clear.' },
            website: { type: 'string', description: 'Website URL rendered on signatures.' },
            address: { type: 'string', description: 'Business address rendered on signatures. Empty string to clear.' },
            primaryColor: { type: 'string', description: 'Primary accent colour as 6-digit hex (also recolours the social icons).' },
            secondaryColor: { type: 'string', description: 'Secondary colour as 6-digit hex.' },
            barColor: { type: 'string', description: 'Colour of the signature bottom bar as 6-digit hex.' },
            barTextColor: { type: 'string', description: 'Text colour inside the bar as 6-digit hex.' },
            fontFamily: { type: 'string', description: 'Font family name for signature text (e.g. "Arial", "Georgia").' },
            logoWidth: { type: 'integer', description: 'Rendered logo width in pixels (40–400).' },
            disclaimer: { type: 'string', description: 'Legal disclaimer text appended below the signature. Empty string to clear.' },
            defaultTemplate: { type: 'string', description: 'The default signature template key (e.g. "classic").' },
          },
          [],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const COLOR_FIELDS = ['primaryColor', 'secondaryColor', 'barColor', 'barTextColor'] as const;
        const TEXT_FIELDS = ['brandDisplayName', 'brandTagline', 'website', 'address', 'fontFamily', 'disclaimer', 'defaultTemplate'] as const;
        const data: Record<string, string | number> = {};
        const changes: Record<string, string> = {};
        for (const f of COLOR_FIELDS) {
          const v = input[f];
          if (v === undefined) continue;
          if (typeof v !== 'string' || !HEX_COLOR.test(v)) return { error: `${f} must be a 6-digit hex colour like "#1a2b3c".` };
          data[f] = v;
          changes[SIGNATURE_SETTINGS_FIELD_LABELS[f] ?? f] = v;
        }
        for (const f of TEXT_FIELDS) {
          const v = input[f];
          if (v === undefined || v === null) continue;
          if (typeof v !== 'string') return { error: `${f} must be text.` };
          data[f] = v.trim();
          changes[SIGNATURE_SETTINGS_FIELD_LABELS[f] ?? f] = v.trim() || '— cleared —';
        }
        if (input.logoWidth !== undefined) {
          const w = Number(input.logoWidth);
          if (!Number.isFinite(w) || w < 40 || w > 400) return { error: 'logoWidth must be between 40 and 400 pixels.' };
          data.logoWidth = Math.round(w);
          changes[SIGNATURE_SETTINGS_FIELD_LABELS.logoWidth] = String(Math.round(w));
        }
        if (Object.keys(data).length === 0) return { error: 'Provide at least one setting to change.' };
        pendingActions.push({
          kind: 'update_signature_settings',
          toolUseId,
          payload: { data, changes },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'create_signature_campaign',
        description: [
          'Propose creating a SIGNATURE campaign — a rotating promotional banner appended to team members\' email signatures, with a click-through link and an optional schedule. NOTE: this is different from a LINK campaign (create_link_campaign), which is a short link whose destination changes by date — if the user asks to "create a campaign" and it is unclear which type they mean, ASK first. This surfaces a confirm card; the campaign is only created when the USER clicks confirm. Free — no billing impact. Banner IMAGES are uploaded afterwards in the Signatures app.',
          'DUPLICATE GUARD: if the brand already has a SIMILAR signature campaign, the tool returns { status: "similar_exists", similar } instead of proposing anything — do NOT create; tell the user what exists and ask whether they want a new one anyway (then re-call with createAnyway: true) or to reuse the existing one.',
          'Validation, or the call returns { error }: name is required (1–255 chars); linkUrl (when given) must be a valid URL; startsAt/endsAt (when given) must be ISO dates with endsAt after startsAt; memberId (when given) must be one of this brand\'s signature members. Returns { status: "awaiting_confirmation" } on success — nothing is created until the user confirms.',
        ].join('\n'),
        input_schema: obj(
          {
            name: { type: 'string', description: 'The campaign name (1–255 characters), e.g. "Spring Promo".' },
            linkUrl: { type: 'string', description: 'The URL the banner clicks through to (must be a valid URL).' },
            startsAt: { type: 'string', description: 'Optional ISO date/time the campaign starts showing (e.g. "2026-08-01"). Omit to start immediately.' },
            endsAt: { type: 'string', description: 'Optional ISO date/time the campaign stops showing. Omit for no end date.' },
            memberId: { type: 'string', description: "Optional member id (from list_signature_members) to scope the banner to ONE member's signature. Omit to show it on every member's signature." },
            rotationMode: { type: 'string', description: 'How multiple banners rotate: "sequential" (default) or "random".', enum: ['sequential', 'random'] },
            ...CREATE_ANYWAY_PROP,
          },
          ['name'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const campName = String(input.name ?? '').trim();
        if (!campName) return { error: 'A campaign name is required.' };
        if (campName.length > 255) return { error: 'The campaign name must be 255 characters or fewer.' };
        // Unless the user already confirmed, surface any SIMILAR existing campaign
        // so the model can ask before creating a likely-duplicate.
        if (input.createAnyway !== true) {
          const existing = await db
            .select({ id: signatureCampaigns.id, name: signatureCampaigns.name })
            .from(signatureCampaigns)
            .where(eq(signatureCampaigns.brandId, brandId))
            .limit(200);
          const similar = findSimilarByName(campName, existing);
          if (similar.length) {
            return similarExistsResult('signature campaign', similar, 'To reuse an existing one instead, direct the user to it in the Signatures app.');
          }
        }
        const payload: Record<string, unknown> = { name: campName };
        const changes: Record<string, string> = { Name: campName };
        if (input.linkUrl !== undefined && input.linkUrl !== null && String(input.linkUrl).trim()) {
          const u = String(input.linkUrl).trim();
          try { new URL(u); } catch { return { error: 'linkUrl is not a valid URL.' }; }
          payload.linkUrl = u;
          changes['Click-through URL'] = u;
        }
        const parseDate = (v: unknown, label: string): Date | { error: string } | null => {
          if (v === undefined || v === null || String(v).trim() === '') return null;
          const d = new Date(String(v));
          if (Number.isNaN(d.getTime())) return { error: `${label} is not a valid date.` };
          return d;
        };
        const startsAt = parseDate(input.startsAt, 'startsAt');
        if (startsAt && 'error' in startsAt) return startsAt;
        const endsAt = parseDate(input.endsAt, 'endsAt');
        if (endsAt && 'error' in endsAt) return endsAt;
        if (startsAt && endsAt && endsAt <= startsAt) return { error: 'endsAt must be after startsAt.' };
        if (startsAt) { payload.startsAt = startsAt.toISOString(); changes['Starts'] = startsAt.toISOString().slice(0, 10); }
        if (endsAt) { payload.endsAt = endsAt.toISOString(); changes['Ends'] = endsAt.toISOString().slice(0, 10); }
        if (input.rotationMode !== undefined) {
          const rm = String(input.rotationMode);
          if (rm !== 'sequential' && rm !== 'random') return { error: 'rotationMode must be "sequential" or "random".' };
          payload.rotationMode = rm;
          changes['Rotation'] = rm;
        }
        if (input.memberId !== undefined && input.memberId !== null && String(input.memberId).trim()) {
          const memberId = String(input.memberId).trim();
          const [m] = await db
            .select({ id: signatureMembers.id, fullName: signatureMembers.fullName })
            .from(signatureMembers)
            .where(and(eq(signatureMembers.id, memberId), eq(signatureMembers.brandId, brandId)))
            .limit(1);
          if (!m) return { error: 'That memberId is not one of this brand\'s signature members.' };
          payload.memberId = m.id;
          changes['Scoped to member'] = m.fullName;
        }
        // Resolve the brand's signature workspace up-front (idempotent lazy
        // provisioning, same as the signatures routers) so the confirm step has
        // the id it needs without a second round-trip.
        payload.signatureBrandId = await ensureBrandKit(db, brandId);
        pendingActions.push({ kind: 'create_signature_campaign', toolUseId, payload: { ...payload, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm. Remind the user to upload the banner image(s) in the Signatures app afterwards.' };
      },
    },
  ];
}
