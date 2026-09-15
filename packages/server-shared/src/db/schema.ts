import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  bigint,
  integer,
  doublePrecision,
  numeric,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type { GeoJsonArea } from '../lib/geojson.js';

/* ──────────────────────────────────────────────────────────────────────────
 * Column helpers
 *   money — exact decimal for currency amounts (NEVER float).
 *   pct   — exact decimal for commission percentages.
 *   ts    — timezone-aware timestamp.
 * ────────────────────────────────────────────────────────────────────────── */
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const pct = (name: string) => numeric(name, { precision: 6, scale: 3 });
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

/* ──────────────────────────────────────────────────────────────────────────
 * ENUMS
 * ────────────────────────────────────────────────────────────────────────── */

export const userRole = pgEnum('user_role', [
  'brandOwner',
  'agencyOwner',
  'individualContractor',
  'agencyStaff',
  'brandStaff',
  'superAdmin',
]);

export const staffType = pgEnum('staff_type', [
  'agency',
  'brand',
  'contractor',
]);
export const staffStatus = pgEnum('staff_status', [
  'pending',
  'active',
  'removed',
]);

// FEATURE SUBSCRIPTIONS (modules/feature-subscriptions) — admin-defined
// subscription products that unlock product features. Completely separate from
// Marketplace Subscriptions (the per-purchase Stripe billing in modules/billing).
export const featureSubscriptionInterval = pgEnum(
  'feature_subscription_interval',
  ['week', 'month'],
);
// Mirrors the subset of Stripe Subscription.status we care about.
export const featureSubscriptionStatus = pgEnum('feature_subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'unpaid',
]);

/** Granular staff permissions (typed; previously free-text). */
export const staffPermission = pgEnum('staff_permission', [
  'agencyDashboard',
  'brandDashboard',
  'clients',
  'catalog',
  'agencyProjects',
  'brandProjects',
  'manageResources',
  'documents',
  'resources',
  'brandGuidelines',
  'invoice',
  'subscriptions',
  'bankAccount',
  'staffManagement',
  'rolesAndCommissions',
  'manageContractors',
  'proposals',
  'infin8',
  // DEPRECATED: `businessInfo` was overloaded across both contexts. It is split
  // into `agencyBusinessInfo` (agency's own Info Hub template library) and
  // `brandBusinessInfo` (a brand's own Info Hub). Kept in the enum only because
  // Postgres can't cleanly drop an enum value; existing rows were migrated.
  'businessInfo',
  'agencyBusinessInfo',
  'brandBusinessInfo',
  'agencyInfo',
  // DEPRECATED legacy "all chat" permission — no longer offered or honored (the
  // three granular chatWith* permissions replace it; existing rows were migrated).
  // Kept in the enum only because Postgres can't cleanly drop an enum value.
  'chat',
  'chatWithContractors',
  'chatWithStaffs',
  'chatWithBrands',
  // Added for Flutter parity (kanban workflow + project board + agencies access).
  'projectBoard',
  'production',
  'addBrief',
  'allocatePeople',
  'approveDeliverable',
  'moveToInternalApproval',
  'fromClientApprovalToCompleted',
  'agencies',
  // Brand staff tab access: Payments (/payments) and Subscriptions (/subscriptions).
  // `subscriptions` already exists above (agency context) and is reused for brands.
  'payments',
  // Brand staff tab access: Links & QR (/links). `links` is the EDITOR permission
  // (create/edit/enable/delete short links); `linksViewer` is read-only
  // (view links, analytics) — see the shortLinks router.
  'links',
  'linksViewer',
  // Brand staff tab access: Reviews (/reviews — the Verdiict review-capture tool).
  // `reviews` is the EDITOR permission (manage locations, platforms, win tags,
  // embeds, collections, review requests, directory profile); `reviewsViewer` is
  // read-only (view locations, the reviews log, analytics) — see reviews router.
  'reviews',
  'reviewsViewer',
  // Read-only counterpart of `payments` for the Payments (EziQuotes) tool —
  // view proposals/payers/analytics without create/send/refund rights. `payments`
  // (above) doubles as the tool's EDITOR permission.
  'paymentsViewer',
  // Brand staff tab access: Signatures (/signatures — the SIGKITT email-signature
  // builder). `signatures` is the single MANAGE permission (brands, members,
  // campaigns, saved signatures, analytics) — signatures has no viewer role
  // (the short-lived `signaturesViewer` value was dropped in migration 0057).
  'signatures',
  // Brand staff tab access: Logo Studio (/logo — the AI logo builder + brand-genesis
  // engine). `logo` is the single MANAGE permission (design a mark, edit it, build the
  // brand system, export assets). Added in migration 0074. Brand owners always pass.
  'logo',
]);

export const connectionStatus = pgEnum('connection_status', [
  'pendingInvite',
  'pendingApplication',
  'active',
  'rejected',
  'revoked',
]);

// ServiceType — 1:1 with Flutter `service_type.dart` (see lib/service-type.ts).
export const serviceType = pgEnum('service_type', [
  'subscription',
  'oneOffService',
  'recurringService',
  'oneOffProductShips',
  'recurringProductShips',
  'digitalProduct',
  'section',
]);
// DeliverableFrequency — 1:1 with Flutter `deliverable_frequency.dart`.
export const deliverableFrequency = pgEnum('deliverable_frequency', [
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

export const proposalStatus = pgEnum('proposal_status', [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'rejected',
  // Deprecated: proposals are never marked `paid` — `accepted` is the terminal
  // billable state (set once the purchase is paid) and payment state lives on
  // the purchase. The value is retained because Postgres can't cleanly drop an
  // enum value; migration 0007 migrates any existing `paid` rows to `accepted`.
  'paid',
  'expired',
  'changeRequested',
  // Non-billable proposal: submitting creates projects internally without
  // sending to a client (Flutter ProposalStatus.internal + isBillable=false).
  'internal',
  // Payer/quote statuses (WS2 — kind='payer' rows only). Additive; marketplace
  // proposals never take these values. Mirror payment_proposal_status.
  'engaged',
  'declined',
  'archived',
  'active',
  'past_due',
  'disputed',
  'refunded',
  'partially_refunded',
  'cancelled',
]);
export const proposalItemType = pgEnum('proposal_item_type', [
  'service',
  'heading',
  'custom',
]);

export const purchaseType = pgEnum('purchase_type', [
  'marketplace',
  'proposal',
]);
export const purchaseStatus = pgEnum('purchase_status', [
  'pending',
  'pendingPayment',
  'paid',
  'processing',
  'completed',
  'failed',
]);

export const projectStatus = pgEnum('project_status', [
  'clientBrief',
  'upcoming',
  'brief',
  'allocate',
  'production',
  'internalApproval',
  'revision',
  'clientApproval',
  'completed',
]);
export const assigneeType = pgEnum('assignee_type', [
  'none',
  'staff',
  'contractor',
]);
export const deliverableType = pgEnum('deliverable_type', [
  'text',
  'document',
  'image',
]);
export const deliverableStatus = pgEnum('deliverable_status', [
  'pending',
  'approved',
  'rejected',
]);
/** Which side of a brand↔agency interaction authored a record. */
export const partySide = pgEnum('party_side', ['brand', 'agency', 'sales']);

// invoice_status enum REMOVED — invoice status is now fully derived at read
// time from the linked payout (docs/invoices.md §7). The DB enum type remains
// in Postgres (can't cleanly drop a previously-used enum) but is unused by code.

export const payoutStatus = pgEnum('payout_status', [
  'upcoming',
  'pending',
  'processing',
  'paid',
  'failed',
  'dispatched',
  'processingByPaypal',
  'processingByWire',
  'processingByStripe',
  'received',
  // Deliberately taken out of circulation: never dispatches, never revived by
  // the cron. Every dispatch selector is an allowlist and `dispatchPayout`
  // early-returns on any status but `pending`, so this is inert by construction.
  'stopped',
]);
// `agency` = the payout is received by the agency itself (its own bank account),
// so the beneficiary is `beneficiaryAgencyId` rather than a user. `owner` is the
// legacy per-user agency-owner role, kept for backward-compat with old rows.
export const payoutAs = pgEnum('payout_as', [
  'admin',
  'owner',
  'staff',
  'contractor',
  'agency',
]);
export const payoutMethod = pgEnum('payout_method', [
  'stripe',
  'paypal',
  'wire',
]);

export const threadType = pgEnum('thread_type', [
  'all',
  'you',
  'brandAgencyStaff',
  'agencyStaff',
  'brandStaff',
  'brandAgencyPersonal',
  'agencyPersonal',
  'brandPersonal',
  'agencyContractorPersonal',
  'platformAdmin',
  'interAgency',
  // Per-brand AI assistant thread. One per brand (brands.chatbotThreadId),
  // shared across the brand team; replies stream from Claude.
  'ai',
  // ── The consumer messenger (chat.prodesk.com) ────────────────────────────
  // Every type above is DERIVED from an org relationship and created for you by
  // an event. These two are the opposite: a person picks another person.
  //   direct  a 1:1 between two users, found by email address
  //   group   N arbitrary users, created by one of them
  // They are in ALL_THREAD_TYPES but in NO identity predicate — see
  // modules/chat/thread-types.ts#CONSUMER_THREAD_TYPES for why that is what
  // keeps them out of the workspace thread list.
  'direct',
  'group',
]);
export const messageType = pgEnum('message_type', [
  'system',
  'text',
  'image',
  'video',
  'document',
]);

export const taskType = pgEnum('task_type', [
  'staffInvitation',
  'agencyApproval',
  'proposalPending',
  'proposalAccepted',
  'clientApprovalRequest',
  'agencyWorkflowAction',
  'connectionRequest',
  'componentApproval',
  'proposalChangeRequested',
  'disciplineRequest',
  'resourceApproval',
  'manual',
]);
export const taskCategory = pgEnum('task_category', [
  'inbox',
  'todo',
  'completed',
  'archived',
]);

export const meetingStatus = pgEnum('meeting_status', [
  'scheduled',
  'cancelled',
  'completed',
]);

/**
 * Transactional-email channels a user can unsubscribe from. Full parity with the
 * production Flutter `UnsubscribeChannel` (functions/src/modules/email/email_functions.ts)
 * — keep in sync with UNSUBSCRIBE_CHANNELS in modules/email/mailer.ts.
 */
export const notificationChannel = pgEnum('notification_channel', [
  'staff_invite',
  'agency_invite',
  'request_completion',
  'proposal',
  'payment_failed',
  'digital_product',
  'cancel_subscription',
  'verification',
  'task',
  'chat',
  'partial_refund',
  'cancellation_request',
  'brand_added_you',
  'referral_invite',
]);

/* ──────────────────────────────────────────────────────────────────────────
 * IDENTITY
 * ────────────────────────────────────────────────────────────────────────── */

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // == Supabase auth.users.id
  email: text('email').notNull().unique(),
  role: userRole('role'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  profileUrl: text('profile_url'),
  selectedAgencyId: uuid('selected_agency_id').references(
    (): any => agencies.id,
    { onDelete: 'set null' },
  ),
  selectedBrandId: uuid('selected_brand_id').references((): any => brands.id, {
    onDelete: 'set null',
  }),
  referredByUserId: uuid('referred_by_user_id').references(
    (): any => users.id,
    { onDelete: 'set null' },
  ),
  referredByAgencyId: uuid('referred_by_agency_id').references(
    (): any => agencies.id,
    { onDelete: 'set null' },
  ),
  isEmailVerified: boolean('is_email_verified').default(false).notNull(),
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  // Can someone who types this exact address into the messenger find you?
  // Default true is exactly today's behaviour — staff.invite and
  // connections.inviteContractor already resolve users by email — but the
  // messenger makes that resolvable-ness visible, so it becomes a setting the
  // person owns. Turning it off is INDISTINGUISHABLE from having no account:
  // chat.discoverByEmail returns the identical response for both, or the
  // opt-out leaks the very fact it exists to hide.
  discoverableByEmail: boolean('discoverable_by_email').default(true).notNull(),
  // Beta access flag (granted by super admins, or self-serve via
  // `/signup?beta=<code>`). A beta user is treated as entitled to EVERY
  // feature-subscription feature — current and future — without paying (see
  // modules/feature-subscriptions/entitlements). It's an entitlement bypass, not
  // a subscription row, so new features unlock for them automatically and
  // there's nothing to bill.
  isBetaUser: boolean('is_beta_user').default(false).notNull(),
  // The cohort a self-serve beta signup joined (`?beta=v1`), null for a manual
  // super-admin grant. The cohort only supplies the DURATION; the deadline below
  // is what actually gates access, so extending one user never moves the cohort.
  betaVersionId: uuid('beta_version_id').references(
    (): any => betaVersions.id,
    {
      onDelete: 'set null',
    },
  ),
  betaStartedAt: timestamp('beta_started_at', { withTimezone: true }),
  // When the beta bypass stops. NULL = unlimited (the legacy hand-toggled grant);
  // a timestamp in the past means `isBetaUser()` resolves false and every paid
  // gate closes. Extensions push this later — see beta_extensions.
  betaEndsAt: timestamp('beta_ends_at', { withTimezone: true }),
  // Set when the user has seen the "your beta ended, here's what you'd pay"
  // takeover. Until then every frontend shows it full-screen on load; afterwards
  // it degrades to the persistent banner.
  betaExpiryAcknowledgedAt: timestamp('beta_expiry_acknowledged_at', {
    withTimezone: true,
  }),
  // Set for users migrated from Firebase Auth, whose password hash could not be
  // carried over. On their first password-login attempt the app emails them a
  // recovery code and routes them to set a new password; cleared once they do.
  requiresPasswordReset: boolean('requires_password_reset')
    .default(false)
    .notNull(),
  // App-owned 4-digit recovery OTP (we email + verify it ourselves; Supabase's
  // own OTP can't be < 6 digits). SHA-256 of `${code}:${userId}` — never the raw
  // code. Short expiry + attempt cap guard a 4-digit code against brute force.
  resetOtpHash: text('reset_otp_hash'),
  resetOtpExpiresAt: timestamp('reset_otp_expires_at', { withTimezone: true }),
  resetOtpAttempts: integer('reset_otp_attempts').default(0).notNull(),
  stripeAccountId: text('stripe_account_id'),
  // Stripe CUSTOMER id (distinct from stripeAccountId, which is a Connect payout
  // account). One reusable customer per user for Feature Subscriptions billing
  // (modules/feature-subscriptions) — set on first feature-subscription checkout.
  stripeCustomerId: text('stripe_customer_id'),
  bankAccountLinked: boolean('bank_account_linked').default(false).notNull(),
  activePayoutMethod: payoutMethod('active_payout_method'),
  payoutMethods: jsonb('payout_methods')
    .$type<Record<string, unknown>>()
    .default({}),
  uiPreferences: jsonb('ui_preferences')
    .$type<Record<string, unknown>>()
    .default({}),
  customData: jsonb('custom_data').$type<Record<string, unknown>>().default({}),
  googleCalendarLinked: boolean('google_calendar_linked')
    .default(false)
    .notNull(),
  // Google OAuth tokens for Calendar/Meet (server-only). { accessToken, refreshToken, expiryDate(ms) }.
  googleCalendarToken: jsonb('google_calendar_token').$type<{
    accessToken?: string;
    refreshToken?: string;
    expiryDate?: number;
  }>(),
  lastTasksViewedAt: timestamp('last_tasks_viewed_at', { withTimezone: true }),
  // Presence heartbeat — written by the client every ~30s while the app is
  // foregrounded; the chat-digest worker treats a recent value as "online" and
  // skips the email (mirrors Flutter PresenceService + isUserOnline).
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contractors = pgTable(
  'contractors',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    email: text('email'),
    bio: text('bio'),
    tagline: text('tagline'),
    skills: text('skills').array(),
    hourlyRate: money('hourly_rate'),
    isAvailable: boolean('is_available').default(true).notNull(),
    resumeUrl: text('resume_url'),
    resumeFileName: text('resume_file_name'),
    websiteUrl: text('website_url'),
    linkedinUrl: text('linkedin_url'),
    portfolioItems: jsonb('portfolio_items').$type<unknown[]>().default([]),
    experienceItems: jsonb('experience_items').$type<unknown[]>().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('contractors_skills_idx').using('gin', t.skills)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * ORGANIZATIONS
 * ────────────────────────────────────────────────────────────────────────── */

export const agencies = pgTable(
  'agencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    businessName: text('business_name').notNull(),
    // When set, this agency is the auto-created "shadow" of a brand (one per
    // brand). Its businessName mirrors the parent brand and it is hidden from
    // the context selector. Derived agencies are excluded from the shared
    // brand/agency business-name namespace (they don't stake an independent
    // claim). `(): any` breaks the brands↔agencies circular type reference.
    derivedFromBrandId: uuid('derived_from_brand_id').references(
      (): any => brands.id,
      { onDelete: 'set null' },
    ),
    legalName: text('legal_name'),
    businessEmail: text('business_email'),
    username: text('username'),
    website: text('website'),
    phone: text('phone'),
    address: text('address'),
    abn: text('abn'),
    logoUrl: text('logo_url'),
    description: text('description'),
    shortDescription: text('short_description'),
    disciplines: text('disciplines').array(),
    services: text('services').array(),
    // `emailVerified` (was `isVerified`): the agency confirmed its business email.
    emailVerified: boolean('is_verified').default(false).notNull(),
    isSalesAgency: boolean('is_sales_agency').default(false).notNull(),
    // `platformVerified` (was `isDefault`): a Prodesk-curated/default agency — drives the verified mark beside the agency name.
    platformVerified: boolean('is_default').default(false).notNull(),
    rejectionReason: text('rejection_reason'),
    // Commission-redirect flags: route each commission type to the agency bank account instead of staff/contractor.
    // NOTE: the "sales" flag redirects the SALESPERSON commission (a producing-agency
    // staff cut carved out of the agency's 50% share) — NOT the 30% agency-sales
    // commission, which is always paid to a separate sender/referred-by agency.
    redirectBriefingCommissionToBankAccount: boolean(
      'redirect_briefing_commission_to_bank_account',
    )
      .default(false)
      .notNull(),
    redirectProductionCommissionToBankAccount: boolean(
      'redirect_production_commission_to_bank_account',
    )
      .default(false)
      .notNull(),
    redirectSalesPersonCommissionToBankAccount: boolean(
      'redirect_sales_person_commission_to_bank_account',
    )
      .default(false)
      .notNull(),
    redirectInternalApprovalCommissionToBankAccount: boolean(
      'redirect_internal_approval_commission_to_bank_account',
    )
      .default(false)
      .notNull(),
    briefingDesigneeId: uuid('briefing_designee_id'),
    allocationDesigneeId: uuid('allocation_designee_id'),
    approvalDesigneeId: uuid('approval_designee_id'),
    salesStaffIds: uuid('sales_staff_ids').array(),
    salesPersonCommissions: jsonb('sales_person_commissions')
      .$type<Record<string, number>>()
      .default({}),
    productionManagerCommission: pct('production_manager_commission'),
    briefingManagerCommission: pct('briefing_manager_commission'),
    internalApprovalCommission: pct('internal_approval_commission'),
    infin8Substages: text('infin8_substages').array(),
    social: jsonb('social').$type<{
      facebookUrl?: string;
      xUrl?: string;
      instagramUrl?: string;
    }>(),
    ammortizedProjectCount: integer('ammortized_project_count').default(0),
    stripeAccountId: text('stripe_account_id'),
    bankAccountLinked: boolean('bank_account_linked').default(false).notNull(),
    activePayoutMethod: payoutMethod('active_payout_method'),
    payoutMethods: jsonb('payout_methods')
      .$type<Record<string, unknown>>()
      .default({}),
    uiPreferences: jsonb('ui_preferences')
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Case-insensitive uniqueness — subdomains are not case-sensitive.
    uniqueIndex('agencies_username_lower_idx').on(sql`lower(${t.username})`),
    index('agencies_owner_idx').on(t.ownerId),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    businessName: text('business_name').notNull(),
    legalName: text('legal_name'),
    email: text('email'),
    contactName: text('contact_name'),
    website: text('website'),
    phone: text('phone'),
    address: text('address'),
    // Australian Business Number — shown on tax invoices where the brand is the
    // from/to party (parity with Flutter BrandModel.abn). Agencies already carry
    // `abn`; brands were missing it, leaving brand invoices without an ABN line.
    abn: text('abn'),
    industry: text('industry'),
    yearFounded: text('year_founded'),
    targetAudience: text('target_audience'),
    competitors: text('competitors'),
    usp: text('usp'),
    brandValues: text('brand_values'),
    toneOfVoice: text('tone_of_voice'),
    keyMessaging: text('key_messaging'),
    logoUrl: text('logo_url'),
    logoUrls: text('logo_urls').array(),
    // Per-brand default QR design, seeded onto new short links (Links & QR
    // Settings → Default QR design). Same shape as shortLinks.qrConfig.
    defaultLinkQrConfig: jsonb('default_link_qr_config').$type<{
      logoUrl?: string;
      foregroundColor?: string;
      backgroundColor?: string;
      cornerStyle?: 'square' | 'rounded' | 'dots' | 'dot' | 'extra-rounded';
      dotStyle?: 'square' | 'rounded' | 'dots' | 'classy';
    }>(),
    colors: text('colors').array(),
    typography: text('typography').array(),
    policies: jsonb('policies')
      .$type<{ id: string; title: string; body: string }[]>()
      .default([])
      .notNull(),
    locations: jsonb('locations')
      .$type<
        {
          id: string;
          label: string;
          address: string;
          placeId?: string;
          lat?: number;
          lng?: number;
          hours?: string;
          phone?: string;
        }[]
      >()
      .default([])
      .notNull(),
    favouriteServiceIds: uuid('favourite_service_ids').array(),
    referralToken: text('referral_token'),
    // The agency auto-created from this brand (one per brand). Mirrors the
    // brand's businessName and is hidden from the context selector. Reciprocal
    // of agencies.derivedFromBrandId. `(): any` breaks the circular type ref.
    derivedToAgencyId: uuid('derived_to_agency_id').references(
      (): any => agencies.id,
      { onDelete: 'set null' },
    ),
    // The brand's dedicated AI assistant thread (chat_threads.type = 'ai').
    // Created on brand creation / backfilled; lets us point straight at it.
    chatbotThreadId: uuid('chatbot_thread_id').references(
      (): any => chatThreads.id,
      { onDelete: 'set null' },
    ),
    // Segment 1 of a signature share link: /team/<signatureSlug>/<department>.
    // PERSISTED rather than derived from a name, so renaming the brand or its
    // brand kit can't 404 signatures already sitting in people's inboxes.
    // Globally unique (migration 0090) — it's the first segment of a public URL.
    // NULL = not minted yet; the signatures app mints it on first use, so the
    // rest of the suite can keep creating brands without knowing about it.
    signatureSlug: text('signature_slug'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('brands_owner_idx').on(t.ownerId),
    uniqueIndex('brands_signature_slug_unique').on(sql`lower(${t.signatureSlug})`),
  ],
);

// (brand_products removed — the brand-owned product catalogue was UI-unused;
// brands publish via agency `services` through their derived agency, and
// payment_products carries an optional link to that services catalog.)

export const userAgencies = pgTable(
  'user_agencies',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.agencyId] }),
    index('user_agencies_agency_idx').on(t.agencyId),
  ],
);

export const userBrands = pgTable(
  'user_brands',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.brandId] }),
    index('user_brands_brand_idx').on(t.brandId),
  ],
);

/** Per-brand notepad content (1-to-1 with brands for the Growth Strategy workspace notepad). */
export const brandNotes = pgTable(
  'brand_notes',
  {
    brandId: uuid('brand_id')
      .primaryKey()
      .references(() => brands.id, { onDelete: 'cascade' }),
    content: text('content').default('').notNull(),
    // Standing brand context the owner writes once and the AI assistant always
    // attaches (like an identity), so they needn't repeat it every message.
    context: text('context').default('').notNull(),
    // Ids of AI skills this brand has turned OFF (see modules/ai/skills). Storing
    // the disabled set — not the enabled set — means the default (null/empty) is
    // "every skill on", and skills added later switch on automatically.
    disabledSkills: text('disabled_skills').array(),
    // Which AI provider family the brand chose (e.g. 'anthropic' | 'gemini').
    // Null = use the default (first enabled family). Only honoured when more than
    // one family is enabled; the brand picker is hidden otherwise.
    selectedAiProvider: text('selected_ai_provider'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('brand_notes_brand_idx').on(t.brandId)],
);

export const brandNotesRelations = relations(brandNotes, ({ one }) => ({
  brand: one(brands, {
    fields: [brandNotes.brandId],
    references: [brands.id],
  }),
}));

/* ──────────────────────────────────────────────────────────────────────────
 * STAFF — typed permissions + integrity-checked org reference
 * ────────────────────────────────────────────────────────────────────────── */

export const staff = pgTable(
  'staff',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    type: staffType('type').notNull(),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'cascade',
    }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => users.id),
    displayName: text('display_name'),
    permissions: staffPermission('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::staff_permission[]`),
    status: staffStatus('status').default('pending').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('staff_agency_idx').on(t.agencyId),
    index('staff_brand_idx').on(t.brandId),
    index('staff_user_idx').on(t.userId),
    // A staff record belongs to exactly one organization (an agency OR a brand).
    check('staff_one_org', sql`num_nonnulls(${t.agencyId}, ${t.brandId}) = 1`),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * CONNECTIONS
 * ────────────────────────────────────────────────────────────────────────── */

export const brandAgencyConnections = pgTable(
  'brand_agency_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('brand_agency_uniq').on(t.brandId, t.agencyId),
    index('brand_agency_agency_idx').on(t.agencyId),
  ],
);

export const brandAgencyConnectionRequests = pgTable(
  'brand_agency_connection_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('brand_agency_req_uniq').on(t.brandId, t.agencyId)],
);

export const agencyContractorConnections = pgTable(
  'agency_contractor_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    // Null while the row is an email-only invite to someone without an account
    // yet; filled in (and pendingEmail cleared) when they sign up & redeem the
    // invite link. See connections.inviteContractor + contractor.create.
    contractorId: uuid('contractor_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    // Set only for email-only pendingInvite rows (no account yet).
    pendingEmail: text('pending_email'),
    status: connectionStatus('status').default('pendingInvite').notNull(),
    initiatedByUserId: uuid('initiated_by_user_id').references(() => users.id),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    // One connection per (agency, contractor). NULL contractor_id rows (email
    // invites) are excluded — Postgres treats NULLs as distinct, but we make it
    // explicit so multiple email invites never collide on the contractor key.
    uniqueIndex('agency_contractor_uniq')
      .on(t.agencyId, t.contractorId)
      .where(sql`${t.contractorId} is not null`),
    // One outstanding email invite per (agency, email).
    uniqueIndex('agency_contractor_email_uniq')
      .on(t.agencyId, t.pendingEmail)
      .where(sql`${t.pendingEmail} is not null`),
    index('agency_contractor_contractor_idx').on(t.contractorId),
    index('agency_contractor_status_idx').on(t.agencyId, t.status),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * CATALOG
 * ────────────────────────────────────────────────────────────────────────── */

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    type: serviceType('type').default('oneOffService').notNull(),
    price: money('price'),
    upfrontFee: money('upfront_fee'),
    recurringFee: money('recurring_fee'),
    upfrontDeliveryFee: money('upfront_delivery_fee'),
    recurringDeliveryFee: money('recurring_delivery_fee'),
    imageUrl: text('image_url'),
    imagePath: text('image_path'), // storage key, for delete-on-replace
    imageAspectRatio: doublePrecision('image_aspect_ratio'),
    videoUrl: text('video_url'),
    videoPath: text('video_path'), // storage key, for delete-on-replace
    stage: text('stage'),
    subStage: text('sub_stage'),
    disciplines: text('disciplines').array(),
    allowBuyNow: boolean('allow_buy_now').default(true).notNull(),
    allowBookMeeting: boolean('allow_book_meeting').default(false).notNull(),
    allowSalesProposal: boolean('allow_sales_proposal').default(true).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    deliverableFrequency: deliverableFrequency('deliverable_frequency'),
    repeatsEvery: integer('repeats_every'),
    sortOrder: integer('sort_order').default(0),
    digitalProductFileUrl: text('digital_product_file_url'),
    digitalProductFileName: text('digital_product_file_name'),
    customFields: jsonb('custom_fields').$type<unknown[]>().default([]),
    assignedStaff: jsonb('assigned_staff').$type<unknown[]>().default([]),
    options: jsonb('options').$type<unknown[]>().default([]),
    variants: jsonb('variants').$type<unknown[]>().default([]),
    addons: jsonb('addons').$type<unknown[]>().default([]),
    upfrontProjectConfig: jsonb('upfront_project_config').$type<unknown>(),
    recurringProjectConfig: jsonb('recurring_project_config').$type<unknown>(),
    salesPersonCommissions: jsonb('sales_person_commissions')
      .$type<Record<string, number>>()
      .default({}),
    productionManagerCommission: pct('production_manager_commission'),
    briefingManagerCommission: pct('briefing_manager_commission'),
    internalApprovalCommission: pct('internal_approval_commission'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // Live-catalog reads filter agency + active + not-deleted; partial index keeps it tight.
    index('services_agency_live_idx')
      .on(t.agencyId, t.sortOrder)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Catalog section headings. A heading is a label the agency drops between
 * services to group its "Organized" catalog view — it is NOT a service, so it
 * lives in its own table instead of polluting `services` with section rows (the
 * old Flutter `type='section'` / `isHeading` approach). Headings and services
 * share ONE per-agency `sortOrder` sequence, so the organize dialog interleaves
 * them and `services.reorder` writes each id back to its own table.
 */
export const serviceHeadings = pgTable(
  'service_headings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('service_headings_agency_idx')
      .on(t.agencyId, t.sortOrder)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const packages = pgTable(
  'packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    imagePath: text('image_path'),
    imageAspectRatio: doublePrecision('image_aspect_ratio'),
    videoUrl: text('video_url'),
    videoPath: text('video_path'),
    disciplines: text('disciplines').array(),
    allowBuyNow: boolean('allow_buy_now').default(true).notNull(),
    allowBookMeeting: boolean('allow_book_meeting').default(false).notNull(),
    allowSalesProposal: boolean('allow_sales_proposal').default(true).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0),
    items: jsonb('items').$type<unknown[]>().default([]),
    assignedStaff: jsonb('assigned_staff').$type<unknown[]>().default([]),
    salesPersonCommissions: jsonb('sales_person_commissions')
      .$type<Record<string, number>>()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('packages_agency_live_idx')
      .on(t.agencyId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * PROPOSALS  (items / phases / documents / comments are now first-class tables)
 * ────────────────────────────────────────────────────────────────────────── */

/* Payer/quote enums — hoisted here (ahead of `proposals`) because the unified
 * proposals table (WS2) references them for its payer-kind columns; they are
 * ALSO used by the payment_* tables far below. Declared once, before first use
 * (block-scoped consts can't be referenced before declaration — TDZ). */
export const proposalKind = pgEnum('proposal_kind', ['marketplace', 'payer']);
export const paymentModelKind = pgEnum('payment_model', [
  'one_off',
  'subscription',
  'pay_plan',
  'payment_plan',
  'dual_option',
]);
export const paymentCurrency = pgEnum('payment_currency', [
  'AUD',
  'USD',
  'GBP',
  'EUR',
  'NZD',
  'CAD',
  'SGD',
]);
export const paymentBuilderMode = pgEnum('payment_builder_mode', [
  'blocks',
  'classic',
  'quick',
  'standard',
]);
export const paymentTier = pgEnum('payment_tier', ['send', 'close', 'recover']);
export const paymentRateLockReason = pgEnum('payment_rate_lock_reason', [
  'recover_commitment',
  'admin_override',
]);
export const paymentCommercialIntent = pgEnum('payment_commercial_intent', [
  'ongoing_service',
  'fixed_engagement',
  'hybrid',
]);

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id').references(() => agencies.id),
    brandId: uuid('brand_id').references(() => brands.id),
    title: text('title'),
    description: text('description'),
    totalAmount: money('total_amount').default('0').notNull(),
    proposalSentById: uuid('proposal_sent_by_id').references(() => users.id),
    proposalSentByAgencyId: uuid('proposal_sent_by_agency_id').references(
      () => agencies.id,
    ),
    createdBySalesAgencyId: uuid('created_by_sales_agency_id').references(
      () => agencies.id,
    ),
    status: proposalStatus('status').default('draft').notNull(),
    // false → non-billable: submitting creates projects internally (no client send).
    isBillable: boolean('is_billable').default(true).notNull(),
    agencyIds: uuid('agency_ids').array(),
    agencySnapshot: jsonb('agency_snapshot').$type<Record<string, unknown>>(),
    brandSnapshot: jsonb('brand_snapshot').$type<Record<string, unknown>>(),
    termsAndConditions: text('terms_and_conditions'),
    paymentTerms: text('payment_terms'),
    validityDays: integer('validity_days'),
    internalNotes: text('internal_notes'),
    clientNotes: text('client_notes'),
    changeRequestNote: text('change_request_note'),
    // Brand's chosen instalment plan from the billing sidebar (PaymentPlanConfigModel);
    // null = Pay in Full. Persisted so the choice survives refresh and flows into the purchase.
    selectedPaymentPlan: jsonb('selected_payment_plan').$type<unknown>(),
    paymentMethod: text('payment_method'),
    paymentReference: text('payment_reference'),
    invoiceNumber: text('invoice_number'),

    // ── Payer/quote merge (WS2) ──────────────────────────────────────────────
    // Discriminator: 'marketplace' = the native agency proposal above;
    // 'payer' = a merged EziQuotes quote. All columns below are payer-only and
    // stay NULL/default for marketplace rows. Names + nullability mirror the old
    // payment_proposals so the payments routers/frontend keep identical I/O.
    kind: proposalKind('kind').default('marketplace').notNull(),
    // Recipient of a payer proposal: an external CRM contact (payment_clients).
    // A proposal's recipient is brandId (platform brand) XOR recipientContactId.
    // FK thunks are lazy, so referencing payment_clients (declared far below) is fine.
    recipientContactId: uuid('recipient_contact_id').references(
      () => paymentClients.id,
      {
        onDelete: 'set null',
      },
    ),
    templateId: uuid('template_id').references(() => paymentTemplates.id, {
      onDelete: 'set null',
    }),
    builderMode: paymentBuilderMode('builder_mode').default('blocks').notNull(),
    quickSetId: uuid('quick_set_id').references(() => paymentQuickSets.id, {
      onDelete: 'set null',
    }),
    slug: text('slug').unique(),
    personalisedIntro: text('personalised_intro'),
    internalNote: text('internal_note'),
    structure: jsonb('structure')
      .notNull()
      .default(sql`'[]'::jsonb`),
    paymentModel: paymentModelKind('payment_model')
      .default('one_off')
      .notNull(),
    paymentConfig: jsonb('payment_config').default(sql`'{}'::jsonb`),
    totalCents: integer('total_cents').notNull().default(0),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    currency: paymentCurrency('currency').default('AUD').notNull(),
    fxRateAtSend: text('fx_rate_at_send'),
    stripeCustomerId: text('stripe_customer_id'),
    stripePaymentMethodId: text('stripe_payment_method_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    pipedriveDealId: integer('pipedrive_deal_id'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    chaseToken: text('chase_token'),
    chaseTokenExpiry: timestamp('chase_token_expiry', { withTimezone: true }),
    engagedAt: timestamp('engaged_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    viewCount: integer('view_count').default(0).notNull(),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    maxScrollDepth: integer('max_scroll_depth').default(0).notNull(),
    winScore: integer('win_score').default(0).notNull(),
    signatureData: text('signature_data'),
    signatureIp: text('signature_ip'),
    signedPdfUrl: text('signed_pdf_url'),
    signedPdfKey: text('signed_pdf_key'),
    appliedFeePercentage: numeric('applied_fee_percentage', {
      precision: 4,
      scale: 2,
    }),
    appliedTier: paymentTier('applied_tier'),
    rateLockReason: paymentRateLockReason('rate_lock_reason'),
    inConversationSince: timestamp('in_conversation_since', {
      withTimezone: true,
    }),
    sequencesPaused: boolean('sequences_paused').default(false).notNull(),
    commercialIntent: paymentCommercialIntent('commercial_intent')
      .default('ongoing_service')
      .notNull(),
    commercialIntentLabel: text('commercial_intent_label'),
    allowPayerCancel: boolean('allow_payer_cancel').default(true).notNull(),
    allowPayerPause: boolean('allow_payer_pause').default(false).notNull(),
    allowPayerPayoutFull: boolean('allow_payer_payout_full')
      .default(false)
      .notNull(),
    allowPayerSkip: boolean('allow_payer_skip').default(false).notNull(),
    allowPayerCardUpdate: boolean('allow_payer_card_update')
      .default(true)
      .notNull(),
    minTermCompletionRequired: boolean('min_term_completion_required')
      .default(false)
      .notNull(),
    commitmentPeriodMonths: integer('commitment_period_months'),
    earlyPayoutDiscountPct: numeric('early_payout_discount_pct', {
      precision: 4,
      scale: 2,
    }),
    maxSkipsPerYear: integer('max_skips_per_year').default(2).notNull(),
    maxPauseDaysPerYear: integer('max_pause_days_per_year')
      .default(60)
      .notNull(),
    maxDeferralsPerPlan: integer('max_deferrals_per_plan').default(2).notNull(),
    contentOverrides: jsonb('content_overrides')
      .$type<Record<string, string> | null>()
      .default(null),
    dualOptionDiscountPct: numeric('dual_option_discount_pct', {
      precision: 5,
      scale: 2,
    }),
    dualOptionDiscountLabel: text('dual_option_discount_label'),
    acceptedOption: text('accepted_option'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('proposals_agency_status_idx').on(t.agencyId, t.status),
    index('proposals_brand_status_idx').on(t.brandId, t.status),
    index('proposals_kind_idx').on(t.kind),
    index('proposals_recipient_contact_idx').on(t.recipientContactId),
  ],
);

export const proposalPhases = pgTable(
  'proposal_phases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    startDelayDays: integer('start_delay_days').default(0),
  },
  (t) => [index('proposal_phases_proposal_idx').on(t.proposalId)],
);

export const proposalItems = pgTable(
  'proposal_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    phaseId: uuid('phase_id').references(() => proposalPhases.id, {
      onDelete: 'set null',
    }),
    type: proposalItemType('type').default('service').notNull(),
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    packageId: uuid('package_id').references(() => packages.id, {
      onDelete: 'set null',
    }),
    agencyId: uuid('agency_id').references(() => agencies.id),
    description: text('description'),
    headingText: text('heading_text'),
    amount: money('amount').default('0').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    upfrontFee: money('upfront_fee'),
    upfrontDeliveryFee: money('upfront_delivery_fee'),
    recurringDeliveryFee: money('recurring_delivery_fee'),
    isRecurring: boolean('is_recurring').default(false).notNull(),
    billingCycle: text('billing_cycle'),
    serviceType: serviceType('service_type'),
    deliverableFrequency: deliverableFrequency('deliverable_frequency'),
    repeatsEvery: integer('repeats_every'),
    projectDurationDays: integer('project_duration_days'),
    isOptional: boolean('is_optional').default(false).notNull(),
    isExcludedByBrand: boolean('is_excluded_by_brand').default(false).notNull(),
    removalProposedByBrand: boolean('removal_proposed_by_brand')
      .default(false)
      .notNull(),
    selectedVariantId: text('selected_variant_id'),
    selectedOptions: jsonb('selected_options')
      .$type<Record<string, string>>()
      .default({}),
    selectedAddons: jsonb('selected_addons').$type<unknown[]>().default([]),
    commissions: jsonb('commissions').$type<Record<string, number>>(),
    // Upfront/recurring project configs carried from the custom-item dialog
    // (ports Flutter `ProposalItem.upfrontProjectConfig`/`recurringProjectConfig`).
    upfrontProjectConfig: jsonb('upfront_project_config').$type<unknown>(),
    recurringProjectConfig: jsonb('recurring_project_config').$type<unknown>(),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [
    index('proposal_items_proposal_idx').on(t.proposalId),
    index('proposal_items_service_idx').on(t.serviceId),
  ],
);

export const proposalDocuments = pgTable(
  'proposal_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    fileName: text('file_name'),
    fileType: text('file_type'),
    fileSize: integer('file_size'),
    uploadedAt: createdAt(),
  },
  (t) => [index('proposal_documents_proposal_idx').on(t.proposalId)],
);

export const proposalComments = pgTable(
  'proposal_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    authorName: text('author_name'),
    authorRole: partySide('author_role'),
    message: text('message').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('proposal_comments_proposal_idx').on(t.proposalId, t.createdAt),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * PURCHASES
 * ────────────────────────────────────────────────────────────────────────── */

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id').references(() => brands.id),
    userId: uuid('user_id').references(() => users.id),
    type: purchaseType('type').default('marketplace').notNull(),
    status: purchaseStatus('status').default('pending').notNull(),
    isInternal: boolean('is_internal').default(false).notNull(),
    errorMessage: text('error_message'),
    proposalId: uuid('proposal_id').references(() => proposals.id),
    proposalSentById: uuid('proposal_sent_by_id').references(() => users.id),
    proposalSentByAgencyId: uuid('proposal_sent_by_agency_id').references(
      () => agencies.id,
    ),
    customFieldResponses: jsonb('custom_field_responses')
      .$type<Record<string, unknown>>()
      .default({}),
    paymentPlans: jsonb('payment_plans').$type<unknown[]>().default([]),
    selectedPaymentPlan: jsonb('selected_payment_plan').$type<unknown>(),
    amount: jsonb('amount').$type<Record<string, unknown>>(),
    totalAmount: money('total_amount').default('0').notNull(), // denormalized for reporting
    agencyCommission: money('agency_commission'),
    affiliateCommission: money('affiliate_commission'),
    prodeskCommission: money('prodesk_commission'),
    // The 30% agency-sales rate frozen at purchase time (paid to the sender/
    // referred-by agency). Distinct from the salesperson commission.
    salesAgencyCommission: money('sales_agency_commission'),
    paymentCount: integer('payment_count').default(0).notNull(),
    paymentReceived: money('payment_received').default('0').notNull(),
    stripeSessionId: text('stripe_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    // Saved so a delayed recurring phase can add its subscription item (or open a
    // new subscription) off-session when the phase activates.
    stripeCustomerId: text('stripe_customer_id'),
    stripeUrl: text('stripe_url'),
    viewableToBrand: boolean('viewable_to_brand').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    index('purchases_brand_idx').on(t.brandId),
    index('purchases_user_idx').on(t.userId),
    index('purchases_status_idx').on(t.status),
    uniqueIndex('purchases_stripe_session_uniq')
      .on(t.stripeSessionId)
      .where(sql`${t.stripeSessionId} is not null`),
  ],
);

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    packageId: uuid('package_id').references(() => packages.id, {
      onDelete: 'set null',
    }),
    agencyId: uuid('agency_id').references(() => agencies.id),
    proposalItemId: uuid('proposal_item_id'),
    projectId: uuid('project_id'),
    serviceName: text('service_name'),
    serviceType: serviceType('service_type'),
    description: text('description'),
    headingText: text('heading_text'),
    amount: jsonb('amount').$type<Record<string, unknown>>(),
    lineTotal: money('line_total').default('0').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    projectDurationDays: integer('project_duration_days'),
    deliverableFrequency: deliverableFrequency('deliverable_frequency'),
    digitalProductFileUrl: text('digital_product_file_url'),
    digitalProductFileName: text('digital_product_file_name'),
    isRecurring: boolean('is_recurring').default(false).notNull(),
    isOptional: boolean('is_optional').default(false).notNull(),
    isExcludedByBrand: boolean('is_excluded_by_brand').default(false).notNull(),
    selectedVariantId: text('selected_variant_id'),
    selectedOptions: jsonb('selected_options')
      .$type<Record<string, string>>()
      .default({}),
    selectedAddons: jsonb('selected_addons').$type<unknown[]>().default([]),
    // ── Frozen snapshot carried onto each spawned project (purchase_fulfillment
    // parity). Without these the project loses its commission/config/cycle data.
    repeatsEvery: integer('repeats_every'),
    commissions: jsonb('commissions').$type<Record<string, number>>(),
    salesPersonCommissions: jsonb('sales_person_commissions')
      .$type<Record<string, number>>()
      .default({}),
    upfrontProjectConfig: jsonb('upfront_project_config').$type<unknown>(),
    recurringProjectConfig: jsonb('recurring_project_config').$type<unknown>(),
    upfrontDeliveryFee: money('upfront_delivery_fee'),
    recurringDeliveryFee: money('recurring_delivery_fee'),
    // Phase scheduling snapshot (proposal phases): a delayed phase starts its
    // project `upcoming` and defers its Stripe billing by `startDelayDays`.
    phaseId: uuid('phase_id'),
    startDelayDays: integer('start_delay_days'),
    // The Stripe subscription ITEM created for this recurring item, so a single
    // project can be cancelled (subscriptionItems.del) without killing the whole
    // subscription. Mirrored onto the spawned project.
    stripeSubscriptionItemId: text('stripe_subscription_item_id'),
    sortOrder: integer('sort_order').default(0).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    index('purchase_items_purchase_idx').on(t.purchaseId),
    index('purchase_items_service_idx').on(t.serviceId),
  ],
);

/**
 * Pending (unpaid) purchases. A checkout writes the FULL purchase snapshot here
 * — never into `purchases` — so the `purchases` table only ever holds purchases
 * that have actually been paid for (or internal, non-billable ones, which are
 * created there directly). On the Stripe `checkout.session.completed` webhook the
 * snapshot is copied into `purchases` + `purchase_items` under the SAME id and
 * this row is deleted (see modules/billing/pending-purchase.ts). The `data` blob
 * is the canonical snapshot: `{ purchase: <purchases insert minus id>, items:
 * [<purchase_items insert minus purchaseId, with a pre-generated id> ] }` — item
 * ids are minted at checkout because they're embedded into Stripe product
 * metadata and must survive promotion. Nothing reads the blob's inner fields for
 * filtering except `data->>'proposalId'` (proposal re-checkout cleanup).
 */
export const pendingPurchases = pgTable('pending_purchases', {
  id: uuid('id').defaultRandom().primaryKey(),
  data: jsonb('data')
    .$type<{
      purchase: Omit<typeof purchases.$inferInsert, 'id'>;
      items: Array<
        Omit<typeof purchaseItems.$inferInsert, 'purchaseId'> & { id: string }
      >;
    }>()
    .notNull(),
  createdAt: createdAt(),
});

/* ──────────────────────────────────────────────────────────────────────────
 * PROJECTS  (deliverables / revisions / notes are now first-class tables)
 * ────────────────────────────────────────────────────────────────────────── */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title'),
    taskTitle: text('task_title'),
    description: text('description'),
    purchaseId: uuid('purchase_id').references(() => purchases.id),
    // The source purchase item (snapshot link). Used to resolve this project's
    // Stripe subscription item for per-project cancellation.
    purchaseItemId: uuid('purchase_item_id'),
    stripeSubscriptionItemId: text('stripe_subscription_item_id'),
    brandId: uuid('brand_id').references(() => brands.id),
    // A free-text brand name, kept so internal/complimentary projects can name
    // their client even when no registered brand exists (brandId is null). The
    // Kanban card prefixes the task title with the resolved brand name.
    brandName: text('brand_name'),
    agencyId: uuid('agency_id').references(() => agencies.id),
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    serviceName: text('service_name'),
    serviceType: serviceType('service_type'),
    packageId: uuid('package_id').references(() => packages.id, {
      onDelete: 'set null',
    }),
    packageName: text('package_name'),
    proposalSentById: uuid('proposal_sent_by_id').references(() => users.id),
    proposalSentByAgencyId: uuid('proposal_sent_by_agency_id').references(
      () => agencies.id,
    ),
    status: projectStatus('status').default('upcoming').notNull(),
    assigneeType: assigneeType('assignee_type').default('none').notNull(),
    productionAssigneeId: uuid('production_assignee_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    // When the current assignee was allocated (contractor "Assigned … ago").
    // Re-stamped on every (re-)allocation; cleared when unassigned.
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    viewableToBrand: boolean('viewable_to_brand').default(true).notNull(),
    isInternal: boolean('is_internal').default(false).notNull(),
    amount: jsonb('amount').$type<Record<string, unknown>>(),
    contractorBudget: money('contractor_budget'),
    contractorBudgetNote: text('contractor_budget_note'),
    estimatedContractorDurationInHours: doublePrecision(
      'estimated_contractor_duration_in_hours',
    ),
    briefContext: text('brief_context'),
    tags: text('tags').array(),
    attachments: text('attachments').array(),
    briefDocuments: jsonb('brief_documents').$type<unknown[]>().default([]),
    // Brand Workspace shared text posts (brand↔agency, hidden from contractors).
    // Each entry: { id, authorId, authorName, source, content, createdAt }.
    brandWorkspaceNotes: jsonb('brand_workspace_notes')
      .$type<unknown[]>()
      .default([]),
    customFieldResponses: jsonb('custom_field_responses')
      .$type<unknown[]>()
      .default([]),
    paymentPlans: jsonb('payment_plans').$type<unknown[]>().default([]),
    selectedPaymentPlan: jsonb('selected_payment_plan').$type<unknown>(),
    commissions: jsonb('commissions').$type<Record<string, number>>(),
    selectedVariantId: text('selected_variant_id'),
    selectedOptions: jsonb('selected_options').$type<Record<string, string>>(),
    selectedAddons: jsonb('selected_addons').$type<unknown[]>().default([]),
    upfrontProjectConfig: jsonb('upfront_project_config').$type<unknown>(),
    recurringProjectConfig: jsonb('recurring_project_config').$type<unknown>(),
    deliverableFrequency: deliverableFrequency('deliverable_frequency'),
    repeatsEvery: integer('repeats_every'),
    cycleCount: integer('cycle_count').default(0),
    revisionCount: integer('revision_count').default(0),
    clientRevisionCount: integer('client_revision_count').default(0),
    // Legacy/inline revision display + refund flow (revisions are also a first-class table).
    revisionNote: text('revision_note'),
    revisionComments: text('revision_comments').array(),
    revisionAttachmentUrl: text('revision_attachment_url'),
    revisionAttachmentUrls: text('revision_attachment_urls').array(),
    proposedRefundAmount: money('proposed_refund_amount'),
    upfrontDeliveryFee: money('upfront_delivery_fee'),
    recurringDeliveryFee: money('recurring_delivery_fee'),
    deadline: timestamp('deadline', { withTimezone: true }),
    nextCycleAt: timestamp('next_cycle_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    approvalMethod: text('approval_method'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sortOrder: text('sort_order').default('a0').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    softDeleteExpiry: timestamp('soft_delete_expiry', { withTimezone: true }),
    softDeleteToken: text('soft_delete_token'), // brand-confirm-via-email token
    completionExpiry: timestamp('completion_expiry', { withTimezone: true }),
    completionToken: text('completion_token'), // brand-one-click-complete-via-email token
  },
  (t) => [
    index('projects_brand_status_idx')
      .on(t.brandId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('projects_agency_status_idx')
      .on(t.agencyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('projects_assignee_idx')
      .on(t.productionAssigneeId)
      .where(sql`${t.deletedAt} is null`),
    index('projects_purchase_idx').on(t.purchaseId),
    // Recurring-cycle cron scans due projects.
    index('projects_next_cycle_idx')
      .on(t.nextCycleAt)
      .where(sql`${t.nextCycleAt} is not null`),
    // Kanban board's primary access path: scope to one agency/brand, ordered by
    // updatedAt DESC. These let Postgres serve the scope + sort from one index
    // scan instead of scanning the (…, status) index and sorting afterwards.
    index('projects_agency_updated_idx')
      .on(t.agencyId, t.updatedAt.desc())
      .where(sql`${t.deletedAt} is null`),
    index('projects_brand_updated_idx')
      .on(t.brandId, t.updatedAt.desc())
      .where(sql`${t.deletedAt} is null`),
    // Sales-agency board branch (includeSalesAgency): projects a sales agency
    // sold but another agency fulfills, matched on proposalSentByAgencyId.
    index('projects_proposal_agency_idx')
      .on(t.proposalSentByAgencyId)
      .where(sql`${t.proposalSentByAgencyId} is not null`),
    // Service-type filter chip, applied within an agency/brand scope.
    index('projects_agency_service_type_idx')
      .on(t.agencyId, t.serviceType)
      .where(sql`${t.deletedAt} is null`),
    // pg_trgm GIN indexes backing the board's case-insensitive `ILIKE '%q%'`
    // search. A leading-wildcard ILIKE can't use a btree, so without these the
    // search scans every in-scope project's text; these accelerate it as the
    // completed column grows unbounded over an agency's lifetime. The columns
    // are effectively immutable after project creation, so the GIN indexes are
    // NOT re-maintained on the frequent status-drag updates (which only touch
    // status/sortOrder/updatedAt). Requires `CREATE EXTENSION pg_trgm`.
    index('projects_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('projects_task_title_trgm_idx').using(
      'gin',
      t.taskTitle.op('gin_trgm_ops'),
    ),
    index('projects_service_name_trgm_idx').using(
      'gin',
      t.serviceName.op('gin_trgm_ops'),
    ),
    index('projects_package_name_trgm_idx').using(
      'gin',
      t.packageName.op('gin_trgm_ops'),
    ),
    index('projects_brand_name_trgm_idx').using(
      'gin',
      t.brandName.op('gin_trgm_ops'),
    ),
    index('projects_description_trgm_idx').using(
      'gin',
      t.description.op('gin_trgm_ops'),
    ),
  ],
);

export const projectDeliverables = pgTable(
  'project_deliverables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: deliverableType('type').default('document').notNull(),
    content: text('content'),
    fileName: text('file_name'),
    description: text('description'),
    status: deliverableStatus('status').default('pending').notNull(),
    source: partySide('source'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    // The deliverable cycle this row belongs to (1-based, mirrors
    // projects.cycleCount at upload time). A value ABOVE the project's current
    // cycle is work STAGED for a future cycle; it becomes live when that cycle
    // opens. Null (legacy rows) is treated as the current cycle.
    cycle: integer('cycle'),
    // Manual display order within a project (drag-to-reorder in the
    // manage-deliverables dialog). New rows append after existing ones; the
    // uploadedAt timestamp is the stable tiebreaker.
    sortOrder: integer('sort_order').default(0).notNull(),
    uploadedAt: createdAt(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('project_deliverables_project_idx').on(t.projectId),
    // "Deliverables awaiting review" dashboards.
    index('project_deliverables_pending_idx')
      .on(t.projectId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const projectRevisions = pgTable(
  'project_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    content: text('content'),
    attachmentUrls: text('attachment_urls').array(),
    authorId: uuid('author_id').references(() => users.id),
    authorName: text('author_name'),
    authorRole: partySide('author_role'),
    source: partySide('source'),
    // Deliverable cycle the feedback was given in (1-based; null = legacy,
    // treated as the current cycle).
    cycle: integer('cycle'),
    createdAt: createdAt(),
  },
  (t) => [index('project_revisions_project_idx').on(t.projectId, t.createdAt)],
);

/**
 * Per-cycle record for CYCLING projects (recurringService /
 * recurringProductShips). Rows exist for:
 *   • COMPLETED cycles — snapshotted by the recycle engine the moment a cycle
 *     rolls over (briefContext/briefDocuments frozen, completedAt stamped), so
 *     history survives the live fields being overwritten for the new cycle.
 *   • FUTURE cycles — created when the agency pre-writes a brief for an
 *     upcoming cycle; the engine promotes it onto the project when that cycle
 *     opens (startedAt stamped).
 * The CURRENT cycle's brief lives on the projects row itself, as before.
 */
export const projectCycles = pgTable(
  'project_cycles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    cycleNumber: integer('cycle_number').notNull(),
    briefContext: text('brief_context'),
    briefDocuments: jsonb('brief_documents').$type<unknown[]>().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('project_cycles_project_cycle_uniq').on(
      t.projectId,
      t.cycleNumber,
    ),
  ],
);

export const projectNotes = pgTable(
  'project_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    authorId: uuid('author_id').references(() => users.id),
    authorName: text('author_name'),
    authorRole: partySide('author_role'),
    source: partySide('source'),
    createdAt: createdAt(),
  },
  (t) => [index('project_notes_project_idx').on(t.projectId, t.createdAt)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * FINANCE
 * ────────────────────────────────────────────────────────────────────────── */

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    amount: money('amount').notNull(),
    paidAmount: money('paid_amount').default('0').notNull(),
    currency: varchar('currency', { length: 3 }).default('AUD').notNull(),
    // A payout has exactly ONE beneficiary — either a USER (staff / affiliate /
    // contractor / super-admin) via `beneficiaryId`, OR an AGENCY (the agency
    // receives the money in its own bank account) via `beneficiaryAgencyId`.
    // Enforced by the `payouts_one_beneficiary` check below.
    beneficiaryId: uuid('beneficiary_id').references(() => users.id),
    beneficiaryAgencyId: uuid('beneficiary_agency_id').references(
      () => agencies.id,
    ),
    // The SOURCE/owning agency of the services this payout is about (context for
    // "whose work generated this"). Distinct from `beneficiaryAgencyId`: the
    // beneficiary may be a staff member, sales/affiliate user, or the super-admin
    // even though the services belong to this agency.
    agencyId: uuid('agency_id').references(() => agencies.id),
    purchaseId: uuid('purchase_id').references(() => purchases.id),
    status: payoutStatus('status').default('upcoming').notNull(),
    as: payoutAs('as'),
    method: payoutMethod('method'),
    sourceBrandName: text('source_brand_name'),
    transactionId: text('transaction_id'),
    // Wise-via-Stripe funding sub-state (funding → paying_out → funded →
    // transferring). Ported from main's WiseFunding model.
    wiseFunding: jsonb('wise_funding').$type<{
      status?: 'funding' | 'paying_out' | 'funded' | 'transferring';
      groupId?: string;
      grossAmount?: number;
      fundingTransferId?: string;
      stripePayoutId?: string;
      payoutAttemptCount?: number;
      fundedAmount?: number;
      recipientAccountId?: string;
      // The Wise transfer created for leg 2. Persisted as soon as the transfer
      // exists (before it is funded from our balance) so a later retry re-funds
      // the SAME transfer instead of creating orphan unfunded ones each round.
      wiseTransferId?: string;
    }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    toPayAt: timestamp('to_pay_at', { withTimezone: true }),
    completelyPaidAt: timestamp('completely_paid_at', { withTimezone: true }),
  },
  (t) => [
    index('payouts_beneficiary_idx').on(t.beneficiaryId),
    // Earnings scope for an agency owner: "what my agency received".
    index('payouts_beneficiary_agency_idx').on(t.beneficiaryAgencyId),
    // Payout cron: "due and pending" — composite covers the WHERE + ORDER BY.
    index('payouts_due_idx').on(t.status, t.toPayAt),
    check('payouts_paid_lte_amount', sql`${t.paidAmount} <= ${t.amount}`),
    // Exactly one beneficiary: a user OR an agency, never both, never neither.
    check(
      'payouts_one_beneficiary',
      sql`num_nonnulls(${t.beneficiaryId}, ${t.beneficiaryAgencyId}) = 1`,
    ),
  ],
);

export const payoutBreakdowns = pgTable(
  'payout_breakdowns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    purchaseId: uuid('purchase_id').references(() => purchases.id, {
      onDelete: 'set null',
    }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    description: text('description'),
    commissionType: text('commission_type'),
    role: text('role'),
    sourceServiceName: text('source_service_name'),
    amount: money('amount').notNull(),
    gst: money('gst'),
    week: integer('week'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    index('payout_breakdowns_payout_idx').on(t.payoutId),
    index('payout_breakdowns_project_idx').on(t.projectId),
  ],
);

/**
 * Deposits — completed disbursements to a beneficiary (the paid-out side of the
 * Flutter `deposits` collection; mainly Wise-funded contractor commission
 * payouts). Distinct from `payouts`, which tracks the upcoming/pending payout
 * lifecycle; a deposit is the realized money-out record with the gateway's raw
 * response retained for reconciliation. The per-line `breakdown` and the
 * provider `rawResponse` are kept as JSONB for fidelity (1:1 with the source).
 */
export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    amount: money('amount').notNull(),
    currency: varchar('currency', { length: 3 }).default('AUD').notNull(),
    beneficiaryId: uuid('beneficiary_id').references(() => users.id),
    // Free text on purpose: the Firestore source stores a payout ROLE here
    // ('contractor'), not a payout method (stripe|paypal|wire) — so it is NOT
    // the payoutMethod enum.
    method: text('method'),
    gatewayStatus: text('gateway_status'),
    transactionId: text('transaction_id'),
    breakdown: jsonb('breakdown').$type<unknown[]>().default([]),
    rawResponse: jsonb('raw_response').$type<Record<string, unknown>>(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('deposits_beneficiary_idx').on(t.beneficiaryId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Global, human-facing sequential invoice number — parity with the Flutter
    // app's `counter/global.invoice` counter and `InvoiceModel.displayId`
    // (`#INV_0001`). Auto-assigned by Postgres on insert (one monotonic sequence
    // shared across every invoice, regardless of type), so it always increments.
    number: integer('number').generatedByDefaultAsIdentity(),
    purchaseId: uuid('purchase_id').references(() => purchases.id),
    payoutId: uuid('payout_id').references(() => payouts.id, {
      onDelete: 'set null',
    }),
    cycle: integer('cycle').default(0),
    commissionType: text('commission_type'),
    // `status` column REMOVED — invoice status is fully derived at read time
    // from the linked payout (docs/invoices.md §7): no payout → 'paid' (brand
    // charge); payout exists → map payout.status onto the invoice status enum.
    // Invoice parties, modelled as polymorphic typed foreign keys rather than a
    // JSON blob (the old `from_party`/`to_party` jsonb). A party is EXACTLY ONE
    // of: Prodesk (the platform), an agency, a brand, or a user — enforced by the
    // `*_one_party` CHECKs below. Real FK columns give us referential integrity
    // and type safety the JSON lacked: a non-UUID / dangling id can no longer be
    // stored (the historical "invalid input syntax for type uuid" 500 on the
    // super-admin Invoices tab came from a Firebase uid living inside the JSON).
    // Parties are resolved to display identity lazily at read time
    // (modules/billing/invoice-parties.ts), so profile edits flow through.
    fromIsProdesk: boolean('from_is_prodesk').default(false).notNull(),
    fromAgencyId: uuid('from_agency_id').references(() => agencies.id, {
      onDelete: 'restrict',
    }),
    fromBrandId: uuid('from_brand_id').references(() => brands.id, {
      onDelete: 'restrict',
    }),
    fromUserId: uuid('from_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    toIsProdesk: boolean('to_is_prodesk').default(false).notNull(),
    toAgencyId: uuid('to_agency_id').references(() => agencies.id, {
      onDelete: 'restrict',
    }),
    toBrandId: uuid('to_brand_id').references(() => brands.id, {
      onDelete: 'restrict',
    }),
    toUserId: uuid('to_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    // Contact party (WS4) — a CRM contact (payment_clients) as invoice party.
    // Used when projecting an inbound payments charge: the payer renders as `to`.
    // FK thunks are lazy, so referencing payment_clients (declared below) is fine.
    fromContactId: uuid('from_contact_id').references(() => paymentClients.id, {
      onDelete: 'restrict',
    }),
    toContactId: uuid('to_contact_id').references(() => paymentClients.id, {
      onDelete: 'restrict',
    }),
    // Idempotency/traceability link when this invoice was projected from an
    // inbound payments charge (WS4). Unique so a transaction maps to one invoice.
    paymentTransactionId: uuid('payment_transaction_id')
      .references(() => paymentTransactions.id, { onDelete: 'set null' })
      .unique(),
    total: money('total').default('0').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invoices_purchase_idx').on(t.purchaseId),

    // Party lookups for the "invoices that involve me" filter (routers/invoices).
    index('invoices_from_user_idx').on(t.fromUserId),
    index('invoices_to_user_idx').on(t.toUserId),
    index('invoices_from_agency_idx').on(t.fromAgencyId),
    index('invoices_to_agency_idx').on(t.toAgencyId),
    index('invoices_to_contact_idx').on(t.toContactId),
    // A party is exactly one of {Prodesk, agency, brand, user, contact} — never
    // zero, never more than one. `is_prodesk` is a non-null boolean, so count it
    // as an int and add the non-null id count.
    check(
      'invoices_from_one_party',
      sql`(${t.fromIsProdesk})::int + num_nonnulls(${t.fromAgencyId}, ${t.fromBrandId}, ${t.fromUserId}, ${t.fromContactId}) = 1`,
    ),
    check(
      'invoices_to_one_party',
      sql`(${t.toIsProdesk})::int + num_nonnulls(${t.toAgencyId}, ${t.toBrandId}, ${t.toUserId}, ${t.toContactId}) = 1`,
    ),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    qty: integer('qty').default(1).notNull(),
    totalPrice: money('total_price').default('0').notNull(),
    packageName: text('package_name'),
    selectedOptions: jsonb('selected_options')
      .$type<Record<string, string>>()
      .default({}),
    selectedAddons: jsonb('selected_addons').$type<unknown[]>().default([]),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * CHAT  (membership/unread state normalized into chat_thread_members)
 * ────────────────────────────────────────────────────────────────────────── */

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id').references(
      () => brandAgencyConnections.id,
      { onDelete: 'set null' },
    ),
    name: text('name'),
    type: threadType('type').notNull(),
    // 'group' threads only — a DM derives its avatar from the counterparty.
    photoUrl: text('photo_url'),
    agencyIds: uuid('agency_ids').array(),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    participantAId: uuid('participant_a_id').references(() => users.id),
    participantBId: uuid('participant_b_id').references(() => users.id),
    contractorId: uuid('contractor_id').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    lastMessage: text('last_message'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    // Who sent the previewed message. Renders the "You: …" prefix on a thread
    // row. It once ALSO decided the messenger's inbox sections (Owed / Waiting /
    // Settled); those are now Unread / Read and read from `unread_count`, because
    // the obligation split was a true rule under labels people read as unread.
    lastMessageSenderId: uuid('last_message_sender_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    isArchived: boolean('is_archived').default(false).notNull(),
    // For 'ai' threads only: the latest Claude server-side compaction block(s)
    // plus a watermark of the last message they summarise, so memory replays
    // across turns even though chat_messages store plain text.
    // Shape: { blocks: unknown[]; watermarkMessageId: string | null; watermarkAt: string | null }.
    aiCompactionState: jsonb('ai_compaction_state').$type<{
      blocks: unknown[];
      watermarkMessageId: string | null;
      watermarkAt: string | null;
    }>(),
    // For 'ai' threads only: a boundary set by the user's `/clear` command. When
    // set, an AI turn only replays thread history strictly AFTER this timestamp,
    // so the model has no knowledge of the conversation before the clear. The
    // visible chat is untouched (a system divider marks the point).
    aiContextResetAt: timestamp('ai_context_reset_at', { withTimezone: true }),
    // For 'ai' threads only: the latest set of suggested follow-up prompts
    // ("continuations") generated out-of-band after each reply. Persisted so the
    // Strategy starter-chip bar can rehydrate them on reload. Shape: string[].
    aiContinuations: jsonb('ai_continuations').$type<string[]>(),
    // For 'ai' threads only: a running summary of the conversation produced by the
    // user's `/compact` command. Set alongside aiContextResetAt so the model drops
    // the raw earlier messages from its window but keeps their gist — the summary
    // is injected as a leading turn (see memory.ts) and survives the reset. Each
    // `/compact` re-summarises the new window on top of this. Cleared by `/clear`.
    aiContextSummary: text('ai_context_summary'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('chat_threads_connection_idx').on(t.connectionId),
    index('chat_threads_last_message_idx').on(t.lastMessageAt),
  ],
);

export const chatThreadMembers = pgTable(
  'chat_thread_members',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role'),
    unreadCount: integer('unread_count').default(0).notNull(),
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    isArchived: boolean('is_archived').default(false).notNull(),
    // ── Consumer messenger, per-member state ─────────────────────────────
    // Group admin. Deliberately NOT the `role` column above: threads.ts
    // #unreadByIdentity reads role='admin' as PLATFORM admin and buckets that
    // member's unread into the platformAdmin badge, so a group admin marked
    // there would leak group unread into the super-admin count. Consumer
    // members always keep role='user'.
    isAdmin: boolean('is_admin').default(false).notNull(),
    // The anti-spam gate. A first message from someone you share no thread with
    // lands 'pending' for the RECIPIENT only: it does not notify, does not bump
    // the inbox, and does not send a digest email. Replying accepts.
    requestState: text('request_state')
      .$type<'accepted' | 'pending' | 'declined'>()
      .default('accepted')
      .notNull(),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    isPinned: boolean('is_pinned').default(false).notNull(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    joinedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    // "My threads, most recent first" + unread badges.
    index('chat_thread_members_user_idx').on(t.userId),
    // The Requests inbox, and the digest worker's pending exclusion.
    index('chat_thread_members_requests_idx').on(t.userId, t.requestState),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    // Nullable so AI replies (isAi=true) can be persisted with no human sender.
    senderId: uuid('sender_id').references(() => users.id),
    senderName: text('sender_name'),
    senderAvatar: text('sender_avatar'),
    senderRole: text('sender_role'),
    senderBusinessName: text('sender_business_name'),
    content: text('content'),
    type: messageType('type').default('text').notNull(),
    // True for messages authored by the brand's AI assistant.
    isAi: boolean('is_ai').default(false).notNull(),
    // Per-message thumbs feedback on AI replies (1 = up, -1 = down, null = none).
    // Stored on the row so it's shared across the brand team and survives reloads.
    aiRating: integer('ai_rating'),
    // Who last set aiRating — attributes a thumbs vote to a teammate so the
    // super-admin Strategy Feedback console can show which user disliked a reply.
    // Nullable (cleared with the rating) and set-null on user delete.
    aiRatedBy: uuid('ai_rated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // When a super-admin marked this disliked reply's feedback as handled. Null =
    // unresolved, which is the default filter in the Strategy Feedback list.
    aiFeedbackResolvedAt: timestamp('ai_feedback_resolved_at', {
      withTimezone: true,
    }),
    // Confirm-action cards proposed by an AI turn (the [{kind,toolUseId,payload}]
    // array). Persisted on the turn's final message so the card survives reloads
    // and is shared across the brand team — same rationale as aiRating. Null when
    // the turn proposed no action.
    pendingActions:
      jsonb('pending_actions').$type<
        { kind: string; toolUseId: string; payload: Record<string, unknown> }[]
      >(),
    // toolUseIds from pendingActions the user has acted on (confirmed or dismissed),
    // so a resolved card doesn't reappear after a reload. Null/empty = none acted.
    // Kept for backwards-compat; the per-action outcome now lives in actionOutcomes.
    resolvedActionIds: text('resolved_action_ids').array(),
    // Per-action outcome for the cards in pendingActions, keyed by toolUseId:
    // 'confirmed' (the write was executed) or 'rejected' (the user dismissed it).
    // Drives the card's persisted done/dismissed state so it renders correctly
    // inline in scrollback and after a reload. Absent key = still pending.
    actionOutcomes:
      jsonb('action_outcomes').$type<
        Record<string, 'confirmed' | 'rejected'>
      >(),
    // Per-action FINAL field values the user confirmed with, keyed by toolUseId —
    // after they edited the card's fields (see message-panel EditableCardFields).
    // Lets a later AI turn see what was actually applied vs. what it proposed.
    // Absent key = confirmed as proposed (no edits) or not confirmed.
    actionEdits:
      jsonb('action_edits').$type<Record<string, Record<string, unknown>>>(),
    // Per-action "Regenerate" history, keyed by toolUseId → an ordered list of the
    // reimagined payloads the user generated (gen1, gen2, …). Persisted so the gen
    // chips survive a reload and are shared across the team, and so each new
    // generation can be made to differ from every prior one. Capped at 5 per card.
    actionRegenerations: jsonb('action_regenerations').$type<
      Record<string, Record<string, unknown>[]>
    >(),
    // The AI asked (via request_settlement_followup) to be re-invoked once every
    // card on this message is settled (confirmed/dismissed), so it can follow up.
    // firedAt gates it to a single follow-up.
    awaitSettlementFollowup: boolean('await_settlement_followup')
      .notNull()
      .default(false),
    settlementFollowupFiredAt: timestamp('settlement_followup_fired_at', {
      withTimezone: true,
    }),
    fileUrl: text('file_url'),
    fileName: text('file_name'),
    thumbnailUrl: text('thumbnail_url'),
    fileSize: integer('file_size'),
    replyToId: uuid('reply_to_id'),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    // This message arrived by Forward rather than being written in this thread.
    // A marker and nothing more: a forward is a genuine new send (see the chat
    // client's ForwardDialog), so every other column is the sender's own. Set at
    // INSERT and never updated, which is why realtime needs no special handling
    // for it.
    isForwarded: boolean('is_forwarded').notNull().default(false),
    // ── Consumer messenger: soft edit + soft delete ──────────────────────
    // Both are UPDATEs, so the existing chat_messages postgres_changes UPDATE
    // subscription carries them with no new broadcast.
    editedAt: timestamp('edited_at', { withTimezone: true }),
    // Delete is SOFT and always will be: the Document Locker mirror and every
    // reply chain point at this row, and a hard DELETE ships only the primary
    // key to realtime, so subscribers cannot tell which thread lost a message.
    // The transcript renders a tombstone, which also just reads better than a
    // hole in a conversation.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    timestamp: createdAt(),
  },
  (t) => [index('chat_messages_thread_idx').on(t.threadId, t.timestamp)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * CONSUMER MESSENGER (chat.prodesk.com) — reactions, blocks, email invites
 * ────────────────────────────────────────────────────────────────────────── */

export const chatMessageReactions = pgTable(
  'chat_message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    // DENORMALISED on purpose. Supabase realtime can only filter
    // postgres_changes on a column of the changed row, and the browser
    // subscribes per thread (`thread_id=eq.<id>`). Without it every client would
    // receive every reaction on the platform and discard almost all of them.
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    index('chat_message_reactions_thread_idx').on(t.threadId),
  ],
);

export const chatUserBlocks = pgTable(
  'chat_user_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('chat_user_blocks_blocked_idx').on(t.blockedId),
  ],
);

/**
 * An invite to an email address with no Prodesk account yet, claimed at signup.
 *
 * It cannot be a `chat_thread_members` row — that table's `user_id` is a NOT NULL
 * foreign key to `users`, so a person without an account is not representable
 * there. No thread exists until they sign up; `claimChatInvites` then creates the
 * DM already accepted, because the invitee is the one who asked for it.
 */
export const chatInvites = pgTable('chat_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  status: text('status')
    .$type<'pending' | 'claimed' | 'revoked'>()
    .default('pending')
    .notNull(),
  claimedBy: uuid('claimed_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/* ──────────────────────────────────────────────────────────────────────────
 * AI assistant — per-reply token/cost usage (super-admin spend reporting)
 * ────────────────────────────────────────────────────────────────────────── */

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    threadId: uuid('thread_id').references(() => chatThreads.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id'),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    client: text('client'), // 'prodesk' | 'dashboard'
    // Which AI feature spent the tokens (e.g. 'chat', 'card_regenerate',
    // 'review_generate', 'proposal_draft'). Nullable for pre-0066 chat rows.
    source: text('source'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    cacheReadTokens: integer('cache_read_tokens').default(0).notNull(),
    cacheCreationTokens: integer('cache_creation_tokens').default(0).notNull(),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 })
      .default('0')
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_brand_idx').on(t.brandId, t.createdAt),
    index('ai_usage_created_idx').on(t.createdAt),
    index('ai_usage_source_idx').on(t.source, t.createdAt),
  ],
);

/**
 * AI-owned implementation plan / to-do for an 'ai' thread. The assistant writes
 * these via silent tools (set_plan / update_plan_item) to track a multi-step task;
 * the user views them read-only in the Strategy To-Do panel. Cleared by `/clear`
 * and cascaded away with the thread. Two levels: a short `title` (~4-5 words) plus
 * a fuller markdown `description`.
 */
export const aiPlanItems = pgTable(
  'ai_plan_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    // 'pending' | 'in_progress' | 'done'
    status: text('status').default('pending').notNull(),
    position: integer('position').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ai_plan_items_thread_idx').on(t.threadId, t.position)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * TASKS
 * ────────────────────────────────────────────────────────────────────────── */

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: taskType('type').notNull(),
    category: taskCategory('category').default('inbox').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    assignedBy: text('assigned_by').default('system'),
    sortOrder: text('sort_order').default('a0').notNull(),
    relatedEntityId: uuid('related_entity_id'),
    organizationId: uuid('organization_id'),
    organizationName: text('organization_name'),
    agencyName: text('agency_name'),
    brandName: text('brand_name'),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'cascade',
    }),
    visibleTo: uuid('visible_to').array(),
    disableMailing: boolean('disable_mailing').default(false).notNull(),
    attachments: text('attachments').array(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_assignee_category_idx').on(t.assigneeId, t.category),
    index('tasks_visible_to_idx').using('gin', t.visibleTo),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * FILES / FOLDERS / RESOURCES / MEETINGS / SETTINGS
 * ────────────────────────────────────────────────────────────────────────── */

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'set null',
    }),
    parentId: uuid('parent_id'),
    isPrivate: boolean('is_private').default(false).notNull(),
    // Which tab the folder lives under. Folders are always BRAND-created
    // organisational containers (agencies never create folders), so a folder in
    // the Agency Documents tab has no single owning agency — `agencyId` can't
    // discriminate it from a Public-tab folder. This does: false = Agency
    // Documents tab, true = Public Brand Assets tab; private uses isPrivate.
    isPublic: boolean('is_public').default(false).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('folders_brand_idx').on(t.brandId)],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    // Primary owning agency (first of agencyIds) — kept for display/back-compat.
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'set null',
    }),
    // All agencies this doc belongs to. Usually one, but a file shared in a
    // group ('all') chat can belong to several. The file shows in EACH of these
    // agencies' documents, is searchable by any of their names, and is visible
    // to all of them. Always includes agencyId as its first element.
    agencyIds: uuid('agency_ids').array(),
    folderId: uuid('folder_id').references(() => folders.id, {
      onDelete: 'set null',
    }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    projectTitle: text('project_title'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    agencyWhoUploaded: uuid('agency_who_uploaded'),
    size: integer('size'),
    type: text('type'),
    category: text('category'),
    source: text('source'),
    isPrivate: boolean('is_private').default(false).notNull(),
    // Whether this file is visible in the Public Brand Assets tab. Brand-owned
    // public assets (logo, public brand uploads) and agency files whose Info Hub
    // section is currently public both set this. The Public tab is
    // `agencyId IS NULL OR isPublic`, so a public agency doc shows in BOTH the
    // Agency Documents tab (agencyId set) and Public Brand Assets (with the
    // agency name). For Info Hub files this is resolved live from the section.
    isPublic: boolean('is_public').default(false).notNull(),
    // Manual display order within a tab/folder for OS-style drag-to-reorder.
    // Lower sorts first; uploadedAt is the tiebreaker for un-ordered rows.
    sortOrder: integer('sort_order').default(0).notNull(),
    // Document Locker is fed automatically from other features (chat, logo,
    // deliverables, Info Hub, proposals, project briefs). Each derived row is
    // stamped with where it came from so the insert is idempotent (a source
    // event only ever adds a row, never twice). sourceType is the feature
    // (e.g. 'chat' | 'logo' | 'deliverable' | 'infohub' | 'proposalDoc' |
    // 'briefDoc' | 'questionnaire'); sourceId is a stable per-file key within
    // that feature (e.g. message id, deliverable id, `${componentId}:${qid}:${urlHash}`).
    // NULL for manual uploads via files.register.
    sourceType: text('source_type'),
    sourceId: text('source_id'),
    // Human-readable provenance shown on hover, e.g. "Sent by Jane in the group
    // chat", "Uploaded as logo", "Deliverable 2 from Logo Design · cycle 1".
    // Stamped at insert by each source hook (it has the context to phrase it).
    note: text('note'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    uploadedAt: createdAt(),
  },
  (t) => [
    index('files_brand_idx')
      .on(t.brandId)
      .where(sql`${t.deletedAt} is null`),
    index('files_folder_idx').on(t.folderId),
    index('files_project_idx').on(t.projectId),
    // Dedup guard for auto-sourced rows: a given source file is inserted once.
    uniqueIndex('files_source_uniq')
      .on(t.sourceType, t.sourceId)
      .where(sql`${t.sourceType} is not null`),
  ],
);

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    url: text('url'),
    linkUrl: text('link_url'),
    categories: text('categories').array(),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'cascade',
    }), // null = admin resource
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    uploadedAt: createdAt(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [index('resources_agency_idx').on(t.agencyId)],
);

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    agencyId: uuid('agency_id').references(() => agencies.id),
    brandId: uuid('brand_id').references(() => brands.id),
    brandUserId: uuid('brand_user_id').references(() => users.id),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    serviceName: text('service_name'),
    assigneeName: text('assignee_name'),
    brandUserName: text('brand_user_name'),
    brandUserEmail: text('brand_user_email'),
    googleEventId: text('google_event_id'),
    meetUrl: text('meet_url'),
    status: meetingStatus('status').default('scheduled').notNull(),
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    createdAt: createdAt(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    index('meetings_assignee_time_idx').on(t.assigneeUserId, t.startTime),
  ],
);

export const globalSettings = pgTable(
  'global_settings',
  {
    id: integer('id').primaryKey().default(1), // singleton
    prodeskCommission: pct('prodesk_commission'),
    affiliateCommission: pct('affiliate_commission'),
    agencyCommission: pct('agency_commission'),
    // The 30% agency-sales rate (paid to the sender/referred-by agency).
    // Distinct from per-staff salesperson commissions (agencies.salesPersonCommissions).
    salesAgencyCommission: pct('sales_agency_commission'),
    defaultPaymentPlans: jsonb('default_payment_plans')
      .$type<unknown[]>()
      .default([]),
    disciplines: text('disciplines').array(),
    services: text('services').array(),
    // Admin-editable Infin8 taxonomy: ordered stages, each with its substages.
    // Seeded once by scripts/initialize.ts; the single source of truth for the
    // Infin8 taxonomy (no runtime hardcoded fallback).
    infin8Stages:
      jsonb('infin8_stages').$type<{ stage: string; substages: string[] }[]>(),
    // Admin push-notification forwarding: when an email is destined for a
    // super-admin user, it is redirected to these addresses instead (see the
    // mailer's superAdminForwardingTarget). Managed from the super-admin
    // "Push Notifications" tab.
    adminForwardingEmails: text('admin_forwarding_emails').array(),
    // AI provider families the super-admin has turned OFF. Exclusion-based: null/
    // empty = every configured family is available; listing a family here removes
    // it from what brands can use (mirrors brand_notes.disabled_skills).
    disabledAiProviders: text('disabled_ai_providers').array(),
    // Which concrete model each AI FEATURE runs on: { "<ai_usage.source>": "<model id>" }.
    // Distinct from the family control above — a family is what a BRAND picks for
    // its own assistant, whereas these are platform decisions about work no tenant
    // should have to think about. An absent key means "use the feature's default",
    // so `{}` and null behave identically.
    aiFeatureModels: jsonb('ai_feature_models')
      .$type<Record<string, string>>()
      .default({}),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [check('global_settings_singleton', sql`${t.id} = 1`)],
);

/**
 * Ledger for initialization steps that must run ONCE PER DATABASE.
 *
 * scripts/initialize-core.ts runs on every server start, so its steps are
 * normally check-then-write against the rows they seed. That doesn't fit a data
 * backfill, which has no single row to check and would otherwise re-scan its
 * whole source set on every boot. A task like that claims a key here first and
 * is skipped forever after.
 *
 * Claiming is `INSERT ... ON CONFLICT DO NOTHING` on the `key` primary key, so
 * two servers booting simultaneously can never both run the same task. A row
 * with `completedAt` NULL means the task claimed the key and then died — see
 * `runOnce` in modules/init/once.ts for how that is handled.
 */
export const initTaskRuns = pgTable('init_task_runs', {
  key: text('key').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Free-form audit payload: counts, a summary, or the failure message. */
  detail: jsonb('detail').$type<Record<string, unknown>>(),
});
export type InitTaskRun = typeof initTaskRuns.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * SPOT — brand-profile custom forms (templates) + filled components
 * ────────────────────────────────────────────────────────────────────────── */

export const spotForms = pgTable(
  'spot_forms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'cascade',
    }), // null = global/default template
    // Set when a brand builds its own one-off custom section in the Info Hub.
    // Brand-owned templates are only offered back to that same brand's picker.
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    description: text('description'),
    // SpotQuestionModel[]: { id, text, type (SpotQuestionType), options[], isRequired }
    questions: jsonb('questions').$type<unknown[]>().default([]),
    isDefault: boolean('is_default').default(false).notNull(),
    isSecret: boolean('is_secret').default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('spot_forms_agency_idx').on(t.agencyId),
    index('spot_forms_brand_idx').on(t.brandId),
  ],
);

export const spotComponents = pgTable(
  'spot_components',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Snapshot reference to the template — kept even if the form is later deleted.
    // NULL for a brand's own custom section: brands never own templates, so their
    // sections hold their questions inline in `questions` below instead.
    templateId: uuid('template_id'),
    templateName: text('template_name').notNull(),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'set null',
    }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    // Inline question set for a template-less (brand-own) section. When templateId
    // is set, questions are read from the template instead and this stays empty.
    questions: jsonb('questions').$type<unknown[]>().default([]),
    answers: jsonb('answers').$type<Record<string, unknown>>().default({}), // questionId -> answer
    isPublic: boolean('is_public').default(false).notNull(),
    isSecret: boolean('is_secret').default(false).notNull(),
    order: integer('sort_order').default(0).notNull(),
    questionOrder: text('question_order').array(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('spot_components_brand_idx').on(t.brandId),
    index('spot_components_template_idx').on(t.templateId),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * DISCIPLINE REQUESTS / BRAND REFERRALS / EMAIL PREFERENCES
 * ────────────────────────────────────────────────────────────────────────── */

export const disciplineRequests = pgTable(
  'discipline_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    discipline: text('discipline').notNull(),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'cascade',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('discipline_requests_agency_idx').on(t.agencyId)],
);

export const brandReferrals = pgTable(
  'brand_referrals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessName: text('business_name').notNull(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [index('brand_referrals_agency_idx').on(t.agencyId)],
);

/** Per-email unsubscribe state (replaces Firestore `unsubscribedEmails/{email}`). */
export const emailUnsubscribes = pgTable('email_unsubscribes', {
  email: text('email').primaryKey(),
  channels: notificationChannel('channels')
    .array()
    .notNull()
    .default(sql`'{}'::notification_channel[]`),
  updatedAt: updatedAt(),
});

/* ──────────────────────────────────────────────────────────────────────────
 * RELATIONS
 * ────────────────────────────────────────────────────────────────────────── */

export const usersRelations = relations(users, ({ one, many }) => ({
  contractor: one(contractors, {
    fields: [users.id],
    references: [contractors.id],
  }),
  agencies: many(userAgencies),
  brands: many(userBrands),
}));

export const agenciesRelations = relations(agencies, ({ one, many }) => ({
  owner: one(users, { fields: [agencies.ownerId], references: [users.id] }),
  services: many(services),
  packages: many(packages),
  members: many(userAgencies),
  // The brand this agency was derived from (null for standalone agencies).
  // Named to disambiguate from the reciprocal brands.derivedToAgency relation.
  derivedFromBrand: one(brands, {
    fields: [agencies.derivedFromBrandId],
    references: [brands.id],
    relationName: 'brandDerivedAgency',
  }),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  owner: one(users, { fields: [brands.ownerId], references: [users.id] }),
  members: many(userBrands),
  projects: many(projects),
  // The shadow agency auto-created from this brand (null until backfilled).
  derivedToAgency: one(agencies, {
    fields: [brands.derivedToAgencyId],
    references: [agencies.id],
    relationName: 'brandDerivedAgency',
  }),
}));

export const userAgenciesRelations = relations(userAgencies, ({ one }) => ({
  user: one(users, { fields: [userAgencies.userId], references: [users.id] }),
  agency: one(agencies, {
    fields: [userAgencies.agencyId],
    references: [agencies.id],
  }),
}));

export const userBrandsRelations = relations(userBrands, ({ one }) => ({
  user: one(users, { fields: [userBrands.userId], references: [users.id] }),
  brand: one(brands, { fields: [userBrands.brandId], references: [brands.id] }),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  agency: one(agencies, {
    fields: [proposals.agencyId],
    references: [agencies.id],
  }),
  brand: one(brands, { fields: [proposals.brandId], references: [brands.id] }),
  items: many(proposalItems),
  phases: many(proposalPhases),
  documents: many(proposalDocuments),
  comments: many(proposalComments),
}));

export const proposalItemsRelations = relations(proposalItems, ({ one }) => ({
  proposal: one(proposals, {
    fields: [proposalItems.proposalId],
    references: [proposals.id],
  }),
  phase: one(proposalPhases, {
    fields: [proposalItems.phaseId],
    references: [proposalPhases.id],
  }),
  service: one(services, {
    fields: [proposalItems.serviceId],
    references: [services.id],
  }),
}));

export const proposalPhasesRelations = relations(
  proposalPhases,
  ({ one, many }) => ({
    proposal: one(proposals, {
      fields: [proposalPhases.proposalId],
      references: [proposals.id],
    }),
    items: many(proposalItems),
  }),
);

export const proposalDocumentsRelations = relations(
  proposalDocuments,
  ({ one }) => ({
    proposal: one(proposals, {
      fields: [proposalDocuments.proposalId],
      references: [proposals.id],
    }),
  }),
);

export const proposalCommentsRelations = relations(
  proposalComments,
  ({ one }) => ({
    proposal: one(proposals, {
      fields: [proposalComments.proposalId],
      references: [proposals.id],
    }),
  }),
);

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  brand: one(brands, { fields: [purchases.brandId], references: [brands.id] }),
  user: one(users, { fields: [purchases.userId], references: [users.id] }),
  proposal: one(proposals, {
    fields: [purchases.proposalId],
    references: [proposals.id],
  }),
  items: many(purchaseItems),
  projects: many(projects),
}));

export const purchaseItemsRelations = relations(purchaseItems, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  service: one(services, {
    fields: [purchaseItems.serviceId],
    references: [services.id],
  }),
}));

export const projectTags = pgTable(
  'project_tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    agencyIdIdx: index('project_tags_agency_id_idx').on(table.agencyId),
  }),
);

export const projectTagsRelations = relations(projectTags, ({ one, many }) => ({
  agency: one(agencies, {
    fields: [projectTags.agencyId],
    references: [agencies.id],
  }),
  projects: many(projectsToTags),
}));

export const projectsToTags = pgTable(
  'projects_to_tags',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => projectTags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.tagId] }),
    projectIdIdx: index('projects_to_tags_project_id_idx').on(table.projectId),
    tagIdIdx: index('projects_to_tags_tag_id_idx').on(table.tagId),
  }),
);

export const projectsToTagsRelations = relations(projectsToTags, ({ one }) => ({
  project: one(projects, {
    fields: [projectsToTags.projectId],
    references: [projects.id],
  }),
  tag: one(projectTags, {
    fields: [projectsToTags.tagId],
    references: [projectTags.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  brand: one(brands, { fields: [projects.brandId], references: [brands.id] }),
  agency: one(agencies, {
    fields: [projects.agencyId],
    references: [agencies.id],
  }),
  purchase: one(purchases, {
    fields: [projects.purchaseId],
    references: [purchases.id],
  }),
  assignee: one(users, {
    fields: [projects.productionAssigneeId],
    references: [users.id],
  }),
  deliverables: many(projectDeliverables),
  revisions: many(projectRevisions),
  notes: many(projectNotes),
  tags: many(projectsToTags),
}));

export const projectDeliverablesRelations = relations(
  projectDeliverables,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectDeliverables.projectId],
      references: [projects.id],
    }),
  }),
);

export const payoutsRelations = relations(payouts, ({ one, many }) => ({
  beneficiary: one(users, {
    fields: [payouts.beneficiaryId],
    references: [users.id],
  }),
  agency: one(agencies, {
    fields: [payouts.agencyId],
    references: [agencies.id],
  }),
  breakdown: many(payoutBreakdowns),
}));

export const payoutBreakdownsRelations = relations(
  payoutBreakdowns,
  ({ one }) => ({
    payout: one(payouts, {
      fields: [payoutBreakdowns.payoutId],
      references: [payouts.id],
    }),
    project: one(projects, {
      fields: [payoutBreakdowns.projectId],
      references: [projects.id],
    }),
  }),
);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [invoices.purchaseId],
    references: [purchases.id],
  }),
  payout: one(payouts, {
    fields: [invoices.payoutId],
    references: [payouts.id],
  }),
  items: many(invoiceItems),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
}));

export const chatThreadsRelations = relations(chatThreads, ({ one, many }) => ({
  connection: one(brandAgencyConnections, {
    fields: [chatThreads.connectionId],
    references: [brandAgencyConnections.id],
  }),
  members: many(chatThreadMembers),
  messages: many(chatMessages),
}));

export const chatThreadMembersRelations = relations(
  chatThreadMembers,
  ({ one }) => ({
    thread: one(chatThreads, {
      fields: [chatThreadMembers.threadId],
      references: [chatThreads.id],
    }),
    user: one(users, {
      fields: [chatThreadMembers.userId],
      references: [users.id],
    }),
  }),
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  thread: one(chatThreads, {
    fields: [chatMessages.threadId],
    references: [chatThreads.id],
  }),
  sender: one(users, {
    fields: [chatMessages.senderId],
    references: [users.id],
  }),
}));

export const spotFormsRelations = relations(spotForms, ({ one }) => ({
  agency: one(agencies, {
    fields: [spotForms.agencyId],
    references: [agencies.id],
  }),
  brand: one(brands, { fields: [spotForms.brandId], references: [brands.id] }),
}));

export const spotComponentsRelations = relations(spotComponents, ({ one }) => ({
  brand: one(brands, {
    fields: [spotComponents.brandId],
    references: [brands.id],
  }),
  agency: one(agencies, {
    fields: [spotComponents.agencyId],
    references: [agencies.id],
  }),
}));

export const disciplineRequestsRelations = relations(
  disciplineRequests,
  ({ one }) => ({
    agency: one(agencies, {
      fields: [disciplineRequests.agencyId],
      references: [agencies.id],
    }),
  }),
);

export const brandReferralsRelations = relations(brandReferrals, ({ one }) => ({
  agency: one(agencies, {
    fields: [brandReferrals.agencyId],
    references: [agencies.id],
  }),
}));

/* ──────────────────────────────────────────────────────────────────────────
 * SHORT LINKS — branded URL shortener (<VITE_REDIRECTOR_PRODESK_ORIGIN>/<slug>)
 *   Each brand can create short links with human-readable slugs. The redirector
 *   service (servers/redirector) resolves slugs to destination URLs with 302.
 *
 *   A row is one of two KINDS, distinguished by `kind`:
 *   - 'link'     — a plain short link. `destinationUrl` is fixed and always used.
 *   - 'campaign' — a SCHEDULED link. `destinationUrl`/`fallbackText` is the
 *                  default (what visitors get outside every window), and
 *                  `link_destination_windows` rows override it for date ranges.
 *   Campaigns bill at their own per-unit rate (see the `unitKind` tier column);
 *   otherwise they share the whole short-link pipeline — slugs, QR, analytics.
 * ────────────────────────────────────────────────────────────────────────── */

/** The two kinds of short link. Campaigns add scheduled destination windows. */
export const SHORT_LINK_KINDS = ['link', 'campaign'] as const;
export type ShortLinkKind = (typeof SHORT_LINK_KINDS)[number];

export const shortLinks = pgTable(
  'short_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    // 'link' | 'campaign' — see SHORT_LINK_KINDS and the block comment above.
    kind: text('kind').$type<ShortLinkKind>().default('link').notNull(),
    // The human-readable slug:<VITE_REDIRECTOR_PRODESK_ORIGIN>/<slug>
    slug: text('slug').notNull(),
    // The destination URL to redirect to. For a 'link' this is THE destination and
    // is always present. For a 'campaign' it's the DEFAULT destination used when no
    // window matches — and it may be null when the campaign shows `fallbackText`
    // instead of redirecting. Enforced by short_links_destination_ck.
    destinationUrl: text('destination_url'),
    // Campaigns only: plain text shown (instead of any redirect) when no window
    // matches and no default `destinationUrl` is set — e.g. "No promotions right
    // now". Exactly one of destinationUrl / fallbackText is set on a campaign.
    fallbackText: text('fallback_text'),
    // User-facing nickname/label shown in the management UI
    nickname: text('nickname').notNull(),
    // Simple click counter (incremented atomically by the redirector)
    clickCount: integer('click_count').default(0).notNull(),
    // QR code customisation stored as JSON
    qrConfig: jsonb('qr_config')
      .$type<{
        logoUrl?: string; // brand logo overlaid on QR center
        foregroundColor?: string; // hex
        backgroundColor?: string; // hex
        cornerStyle?: 'square' | 'rounded' | 'dots' | 'dot' | 'extra-rounded';
        dotStyle?: 'square' | 'rounded' | 'dots' | 'classy';
      }>()
      .default({}),
    isActive: boolean('is_active').default(true).notNull(),
    // Per-link price lock for grandfathering. When a link is switched ON we stamp
    // the URL-shortener offer price that was active THEN, and keep it for the life
    // of the link — so an admin lowering (or raising) the price only affects links
    // activated afterwards. Null = never activated, or activated before this
    // feature (backfilled to the owner's then-current subscription price). Billing
    // groups active links by this price into one Stripe subscription item each.
    billedPriceId: uuid('billed_price_id').references(
      () => featureSubscriptionPrices.id,
      { onDelete: 'set null' },
    ),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    disabledAt: timestamp('disabled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Every slug is globally unique (case-insensitive)
    uniqueIndex('short_links_slug_lower_idx').on(sql`lower(${t.slug})`),
    // Fast lookup by brand for the management UI
    index('short_links_brand_idx').on(t.brandId),
    // The links list and the campaigns list are the same table filtered by kind.
    index('short_links_brand_kind_idx').on(t.brandId, t.kind),
    // A plain link MUST have a destination. A campaign must have at least one of
    // destinationUrl / fallbackText, so there's always something to serve outside
    // its windows. Mirrors the zod validation in the shortLinks router.
    check(
      'short_links_destination_ck',
      sql`(${t.kind} = 'link' AND ${t.destinationUrl} IS NOT NULL)
       OR (${t.kind} = 'campaign' AND (${t.destinationUrl} IS NOT NULL OR ${t.fallbackText} IS NOT NULL))`,
    ),
  ],
);

export const shortLinksRelations = relations(shortLinks, ({ one, many }) => ({
  brand: one(brands, { fields: [shortLinks.brandId], references: [brands.id] }),
  createdBy: one(users, {
    fields: [shortLinks.createdByUserId],
    references: [users.id],
  }),
  windows: many(linkDestinationWindows),
}));

/**
 * Campaign destination windows — a dated override of a campaign link's default
 * destination. While `now` falls inside [startsAt, endsAt) the campaign redirects
 * here instead of its default; outside every window it falls back to the link's
 * own `destinationUrl` / `fallbackText`.
 *
 * Windows MAY overlap (nothing stops a user scheduling two promos over the same
 * day), so resolution is deterministic rather than rejected at write time: the
 * matching window with the LATEST `startsAt` wins — the most recently begun promo
 * is the most specific — tie-broken by newest `createdAt`. That single rule lives
 * in modules/short-links/campaign-schedule.ts and is unit tested; the redirector
 * and the dashboard preview both call it so they can never disagree.
 */
export const linkDestinationWindows = pgTable(
  'link_destination_windows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => shortLinks.id, { onDelete: 'cascade' }),
    // Optional human label for the window, e.g. "Happy New Year".
    label: text('label'),
    // A window always redirects — there's no text mode here, only on the fallback.
    destinationUrl: text('destination_url').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The redirector's hot path: every window for one link, newest start first.
    index('link_destination_windows_link_idx').on(t.linkId, t.startsAt),
    check('link_destination_windows_range_ck', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const linkDestinationWindowsRelations = relations(
  linkDestinationWindows,
  ({ one }) => ({
    link: one(shortLinks, {
      fields: [linkDestinationWindows.linkId],
      references: [shortLinks.id],
    }),
  }),
);

/**
 * Link events — one row per redirect hit (written fire-and-forget by the
 * redirector). Powers time-series + device/referrer/country analytics beyond the
 * denormalized `short_links.click_count`. `brandId` is snapshotted at hit time
 * so brand-scoped aggregation stays fast and historically stable.
 */
export const linkEvents = pgTable(
  'link_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => shortLinks.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    referrerHost: text('referrer_host'),
    device: text('device'), // mobile | tablet | desktop | other
    browser: text('browser'),
    os: text('os'),
    country: text('country'), // ISO code from the edge header, when available
    source: text('source').default('link'), // 'link' (typed/clicked) | 'qr' (scan)
    isBot: boolean('is_bot').default(false).notNull(), // prefetch/crawler, excluded by default
    ipHash: text('ip_hash'), // daily-rotating unique-visitor fingerprint (no raw IP)
  },
  (t) => [
    index('link_events_brand_time_idx').on(t.brandId, t.occurredAt),
    index('link_events_link_time_idx').on(t.linkId, t.occurredAt),
  ],
);

export const linkEventsRelations = relations(linkEvents, ({ one }) => ({
  link: one(shortLinks, {
    fields: [linkEvents.linkId],
    references: [shortLinks.id],
  }),
  brand: one(brands, {
    fields: [linkEvents.brandId],
    references: [brands.id],
  }),
}));

/* ──────────────────────────────────────────────────────────────────────────
 * FEATURE SUBSCRIPTIONS
 *   Admin-defined subscription PRODUCTS that unlock product features (gating).
 *   Hierarchy: product → tier → price (weekly/monthly, dynamic amount). A
 *   `feature_subscriptions` row is the subscription a USER (a brand OWNER) holds;
 *   entitlement is owner-scoped, so every brand of that owner shares the unlock.
 *   Entirely separate from Marketplace Subscriptions (modules/billing).
 * ────────────────────────────────────────────────────────────────────────── */

export const featureSubscriptionProducts = pgTable(
  'feature_subscription_products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    // The PRIMARY feature this product unlocks (e.g. 'ai_growth_strategy'), kept
    // for back-compat and Stripe metadata. Always equals featureKeys[0].
    featureKey: text('feature_key').notNull(),
    // Every feature this single product/subscription unlocks. A subscription
    // grants ALL of these, so one subscription can unlock multiple features.
    // Entitlement matches any key in this set; see feature-keys.ts / entitlements.ts.
    featureKeys: text('feature_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text('description'),
    active: boolean('active').default(true).notNull(),
    // Quantity-scaled pricing: when true the Stripe subscription `quantity` is
    // driven dynamically (e.g. one unit per active short link) instead of the
    // flat `quantity: 1` used by ordinary feature products. The unit count is
    // resolved in code from the product's featureKey — see per-unit.ts.
    perUnit: boolean('per_unit').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    // In-app upsell card copy (admin-editable), e.g. shown inside the AI thread.
    cardTitle: text('card_title'),
    cardSubtitle: text('card_subtitle'),
    cardDescription: text('card_description'),
    cardButtonLabel: text('card_button_label'),
    // Synced to a Stripe Product on first checkout / admin save.
    stripeProductId: text('stripe_product_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('feature_sub_products_feature_idx').on(t.featureKey)],
);

export const featureSubscriptionTiers = pgTable(
  'feature_subscription_tiers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => featureSubscriptionProducts.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    description: text('description'),
    // Bullet list of what this tier includes (for future tier differentiation).
    features: jsonb('features').$type<string[]>().default([]),
    // perUnit products only: WHICH billable unit this tier prices, when one
    // product meters several kinds of unit at different rates. The URL Shortener
    // uses 'link' ($1/active link) and 'campaign' ($3/active campaign) — one
    // subscription, one item per rate (see per-unit.ts). Null = the product's
    // default/only unit, which is how every flat product stays untouched.
    unitKind: text('unit_kind').$type<ShortLinkKind>(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('feature_sub_tiers_product_idx').on(t.productId)],
);

export const featureSubscriptionPrices = pgTable(
  'feature_subscription_prices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => featureSubscriptionTiers.id, { onDelete: 'cascade' }),
    interval: featureSubscriptionInterval('interval').notNull(),
    amount: money('amount').notNull(),
    currency: varchar('currency', { length: 3 }).default('AUD').notNull(),
    active: boolean('active').default(true).notNull(),
    // Stripe Prices are immutable: an amount change deactivates this row and
    // creates a new one with a fresh stripePriceId. Synced lazily on checkout.
    stripePriceId: text('stripe_price_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('feature_sub_prices_tier_idx').on(t.tierId),
    // At most one ACTIVE price per (tier, interval).
    uniqueIndex('feature_sub_prices_tier_interval_active_uniq')
      .on(t.tierId, t.interval)
      .where(sql`${t.active}`),
  ],
);

export const featureSubscriptions = pgTable(
  'feature_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The subscriber of record — always the brand OWNER (entitlement is owner-scoped).
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => featureSubscriptionProducts.id, {
        onDelete: 'restrict',
      }),
    tierId: uuid('tier_id').references(() => featureSubscriptionTiers.id, {
      onDelete: 'set null',
    }),
    priceId: uuid('price_id').references(() => featureSubscriptionPrices.id, {
      onDelete: 'set null',
    }),
    status: featureSubscriptionStatus('status').default('incomplete').notNull(),
    // Snapshot of what is charged (survives later price edits).
    interval: featureSubscriptionInterval('interval').notNull(),
    amount: money('amount').notNull(),
    currency: varchar('currency', { length: 3 }).default('AUD').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    // The Stripe subscription ITEM id — needed to update `quantity` for per-unit
    // products (quantity-scaled billing). Null for flat products / dev rows.
    stripeSubscriptionItemId: text('stripe_subscription_item_id'),
    // Mirror of the Stripe subscription item quantity. For flat products this is
    // always 1; for per-unit products it tracks the live unit count (e.g. active
    // short links). Monthly charge = amount (unit price) × quantity.
    quantity: integer('quantity').default(1).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    // Audit: the staff member who actually checked out, and the brand it was
    // bought "for" (the owner is `userId`; this records who/where it originated).
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdForBrandId: uuid('created_for_brand_id').references(
      () => brands.id,
      { onDelete: 'set null' },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('feature_subs_user_idx').on(t.userId),
    index('feature_subs_user_product_idx').on(t.userId, t.productId),
  ],
);

export const featureSubscriptionProductsRelations = relations(
  featureSubscriptionProducts,
  ({ many }) => ({
    tiers: many(featureSubscriptionTiers),
  }),
);

export const featureSubscriptionTiersRelations = relations(
  featureSubscriptionTiers,
  ({ one, many }) => ({
    product: one(featureSubscriptionProducts, {
      fields: [featureSubscriptionTiers.productId],
      references: [featureSubscriptionProducts.id],
    }),
    prices: many(featureSubscriptionPrices),
  }),
);

export const featureSubscriptionPricesRelations = relations(
  featureSubscriptionPrices,
  ({ one }) => ({
    tier: one(featureSubscriptionTiers, {
      fields: [featureSubscriptionPrices.tierId],
      references: [featureSubscriptionTiers.id],
    }),
  }),
);

export const featureSubscriptionsRelations = relations(
  featureSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [featureSubscriptions.userId],
      references: [users.id],
    }),
    product: one(featureSubscriptionProducts, {
      fields: [featureSubscriptions.productId],
      references: [featureSubscriptionProducts.id],
    }),
    tier: one(featureSubscriptionTiers, {
      fields: [featureSubscriptions.tierId],
      references: [featureSubscriptionTiers.id],
    }),
    price: one(featureSubscriptionPrices, {
      fields: [featureSubscriptions.priceId],
      references: [featureSubscriptionPrices.id],
    }),
  }),
);

/* ──────────────────────────────────────────────────────────────────────────
 * BETA PROGRAM — time-boxed free access to the whole Prodesk Suite in exchange
 * for feedback. A beta VERSION (v1/v2/v3…) is an admin-defined cohort carrying a
 * duration in days; `/signup?beta=<code>` joins it and stamps the new user with
 * `users.betaEndsAt = signup + durationDays`. The deadline lives on the USER, so
 * an admin can extend one member (beta_extensions) without moving the cohort.
 *
 * The cohort grants nothing itself — access rides entirely on `users.isBetaUser`,
 * the existing entitlement bypass in modules/feature-subscriptions/entitlements.
 * Adding an expiry to that one function is what makes every paid gate across the
 * platform close when the beta lapses; there is no per-feature beta wiring.
 * ────────────────────────────────────────────────────────────────────────── */

/** The three "your beta is ending" reminders, by lead time. */
export const betaNoticeKind = pgEnum('beta_notice_kind', [
  'day_7',
  'day_3',
  'day_0',
]);

export const betaVersions = pgTable(
  'beta_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The token that appears in the signup URL (`?beta=v1`). Matched
    // case-insensitively — see the lower(code) unique index.
    code: text('code').notNull(),
    label: text('label'),
    description: text('description'),
    // Beta length in days, counted from each member's own signup.
    durationDays: integer('duration_days').notNull(),
    // Whether the code still accepts new signups. Closing a version never
    // shortens the beta of anyone already in it.
    active: boolean('active').default(true).notNull(),
    // Optional cap on how many users may join. Null = unlimited.
    signupLimit: integer('signup_limit'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('beta_versions_code_uniq').on(sql`lower(${t.code})`)],
);
export type BetaVersion = typeof betaVersions.$inferSelect;

export const betaExtensions = pgTable(
  'beta_extensions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    days: integer('days').notNull(),
    reason: text('reason'),
    previousEndsAt: timestamp('previous_ends_at', { withTimezone: true }),
    newEndsAt: timestamp('new_ends_at', { withTimezone: true }).notNull(),
    extendedByUserId: uuid('extended_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('beta_extensions_user_idx').on(t.userId, t.createdAt)],
);
export type BetaExtension = typeof betaExtensions.$inferSelect;

export const betaNotices = pgTable(
  'beta_notices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: betaNoticeKind('kind').notNull(),
    // The deadline this reminder was sent FOR. Part of the unique key so an
    // extension (new deadline) re-arms all three reminders instead of being
    // suppressed as "already sent".
    betaEndsAt: timestamp('beta_ends_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('beta_notices_user_kind_deadline_uniq').on(
      t.userId,
      t.kind,
      t.betaEndsAt,
    ),
  ],
);
export type BetaNotice = typeof betaNotices.$inferSelect;

export const betaVersionsRelations = relations(betaVersions, ({ many }) => ({
  members: many(users),
}));

/* ──────────────────────────────────────────────────────────────────────────
 * REVIEWS (Verdiict) — brand-scoped review-capture tool migrated from the Manus
 * "review-request-tool" export. A brand owns review LOCATIONS (the public
 * /r/:slug capture pages); each location collects star ratings, win-tag picks,
 * AI-written public reviews (routed to Google/Facebook/…), and private feedback.
 * Tenancy: Manus `accounts` → our `brands`; Manus `account_members` → our `staff`
 * (reviews / reviewsViewer permissions). Billing: a brand-level Reviews feature
 * subscription (FEATURE_KEYS.reviews) with a free trial of the first N captured
 * reviews — see modules/reviews/billing.ts. Stripe per-location columns dropped.
 * ────────────────────────────────────────────────────────────────────────── */

export const reviewPlatformKind = pgEnum('review_platform_kind', [
  'google',
  'facebook',
  'trustpilot',
  'yelp',
  'tripadvisor',
]);

export const reviewSubmissionType = pgEnum('review_submission_type', [
  'public',
  'private',
]);

export const reviewRequestChannel = pgEnum('review_request_channel', ['email']);

export const reviewRequestStatus = pgEnum('review_request_status', [
  'sent',
  'opened',
  'completed',
]);

export const reviewMilestoneKind = pgEnum('review_milestone_kind', [
  'sticker_pack',
  'gold_plaque',
  'platinum_plaque',
]);

export const reviewMilestoneStatus = pgEnum('review_milestone_status', [
  'unlocked',
  'claimed',
  'shipped',
  'delivered',
]);

/** Embed widget theme — rendered by the public embed iframe (modules/reviews). */
export type ReviewEmbedTheme = {
  variant: 'carousel' | 'wall' | 'marquee' | 'hero';
  accentColor?: string;
  fontFamily?: 'geist' | 'inter' | 'system' | 'playfair' | 'dm-sans';
  dark?: boolean;
  showLogo?: boolean;
  showWinTags?: boolean;
  showStarCount?: boolean;
  onlyFiveStar?: boolean;
  density?: 'compact' | 'cozy' | 'comfortable';
  radius?: 'sharp' | 'soft' | 'round';
};

/** Shipping address captured when a brand claims a physical milestone reward. */
export type ReviewShippingAddress = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postcode: string;
  country: string;
  phone?: string;
};

// ─── Locations (the public review-capture pages) ────────────────────────────
export const reviewLocations = pgTable(
  'review_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    industry: text('industry').default('other').notNull(),
    logoUrl: text('logo_url'),
    // Where private (≤4★) feedback alert emails are sent.
    badReviewEmail: text('bad_review_email'),
    // Optional "back to website" link shown on the thank-you step.
    redirectUrl: text('redirect_url'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Lifetime count of slug renames — capped server-side (locations.update).
    slugChangeCount: integer('slug_change_count').default(0).notNull(),
    // Soft delete: 7-day grace (Trash) before hard delete; the public /r/:slug
    // returns gone while set, but the row + reviews stay recoverable.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_locations_slug_lower_idx').on(sql`lower(${t.slug})`),
    index('review_locations_brand_idx').on(t.brandId),
  ],
);

// ─── Slug history (per location) ─────────────────────────────────────────────
/**
 * Every slug a location previously lived at. Public lookups (/r/:slug, embeds)
 * fall back to this table so shared links, QR codes and installed embeds keep
 * resolving after a rename. Slugs here are reserved: no other location can
 * claim them (unique lower(slug) across the table, checked together with the
 * live slugs); the owning location may reclaim its own old slug, which removes
 * the history row.
 */
export const reviewLocationSlugHistory = pgTable(
  'review_location_slug_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_loc_slug_history_lower_idx').on(sql`lower(${t.slug})`),
    index('review_loc_slug_history_location_idx').on(t.locationId),
  ],
);

// ─── Review platforms (per location) ────────────────────────────────────────
export const reviewPlatforms = pgTable(
  'review_platforms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    platform: reviewPlatformKind('platform').notNull(),
    url: text('url').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_platforms_location_idx').on(t.locationId),
    uniqueIndex('review_platforms_loc_platform_idx').on(
      t.locationId,
      t.platform,
    ),
  ],
);

// ─── Win tags (per location) ────────────────────────────────────────────────
export const reviewWinTags = pgTable(
  'review_win_tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('review_win_tags_location_idx').on(t.locationId)],
);

// ─── Submissions (the captured reviews + private feedback) ───────────────────
export const reviewSubmissions = pgTable(
  'review_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    // The review request this submission answered, when it came in via an emailed
    // request link (?rr=<token>). Null for walk-up captures (embed / QR / directory).
    requestId: uuid('request_id').references((): any => reviewRequests.id, {
      onDelete: 'set null',
    }),
    stars: integer('stars').notNull(),
    selectedTags: jsonb('selected_tags')
      .$type<string[]>()
      .default([])
      .notNull(),
    generatedReview: text('generated_review'),
    privateFeedback: text('private_feedback'),
    platformClicked: text('platform_clicked'),
    submissionType: reviewSubmissionType('submission_type').notNull(),
    // Reviewer consent to appear on the public directory (4–5★ opt-in).
    publicConsent: boolean('public_consent').default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_submissions_location_idx').on(t.locationId),
    index('review_submissions_created_idx').on(t.createdAt),
  ],
);

// ─── Review requests (manual outreach to customers) ─────────────────────────
export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    sentByUserId: uuid('sent_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email'),
    channel: reviewRequestChannel('channel').default('email').notNull(),
    status: reviewRequestStatus('status').default('sent').notNull(),
    // Unguessable per-request token embedded in the emailed link (?rr=<token>);
    // lets the public capture flow tie a submission back to this exact request
    // and advance its status (sent → opened → completed).
    token: uuid('token').defaultRandom().notNull().unique(),
    reviewLink: text('review_link').notNull(),
    customMessage: text('custom_message'),
    sentAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('review_requests_location_idx').on(t.locationId),
    index('review_requests_brand_idx').on(t.brandId),
  ],
);

// ─── Embed configs (per location) ───────────────────────────────────────────
export const reviewEmbedConfigs = pgTable('review_embed_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  locationId: uuid('location_id')
    .notNull()
    .references(() => reviewLocations.id, { onDelete: 'cascade' })
    .unique(),
  theme: jsonb('theme').$type<ReviewEmbedTheme>().notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Embed collections (account-wide, multi-location) ───────────────────────
export const reviewEmbedCollections = pgTable(
  'review_embed_collections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    theme: jsonb('theme').$type<ReviewEmbedTheme>().notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_embed_collections_slug_idx').on(t.slug),
    index('review_embed_collections_brand_idx').on(t.brandId),
  ],
);

export const reviewEmbedCollectionLocations = pgTable(
  'review_embed_collection_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => reviewEmbedCollections.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('review_embed_col_loc_collection_idx').on(t.collectionId)],
);

// ─── Embed views (lightweight analytics) ────────────────────────────────────
export const reviewEmbedViews = pgTable('review_embed_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  locationId: uuid('location_id').references(() => reviewLocations.id, {
    onDelete: 'cascade',
  }),
  collectionId: uuid('collection_id').references(
    () => reviewEmbedCollections.id,
    { onDelete: 'cascade' },
  ),
  referrer: varchar('referrer', { length: 512 }),
  ua: varchar('ua', { length: 512 }),
  createdAt: createdAt(),
});

// ─── Milestone rewards (gamified physical rewards) ──────────────────────────
export const reviewMilestoneRewards = pgTable(
  'review_milestone_rewards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    // Only set for sticker_pack (per-location milestone).
    locationId: uuid('location_id').references(() => reviewLocations.id, {
      onDelete: 'set null',
    }),
    kind: reviewMilestoneKind('kind').notNull(),
    status: reviewMilestoneStatus('status').default('unlocked').notNull(),
    shippingAddress: jsonb('shipping_address').$type<ReviewShippingAddress>(),
    unlockedAt: createdAt(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    trackingNumber: varchar('tracking_number', { length: 120 }),
  },
  (t) => [index('review_milestone_rewards_brand_idx').on(t.brandId)],
);

// ─── Industries + tag presets (global, super-admin managed) ─────────────────
export const reviewIndustries = pgTable('review_industries', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reviewTagPresets = pgTable(
  'review_tag_presets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    industrySlug: text('industry_slug').notNull(),
    tag: text('tag').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('review_tag_presets_industry_idx').on(t.industrySlug)],
);

// ─── Admin audit log (super-admin actions in the reviews tool) ───────────────
export const reviewAdminAudit = pgTable(
  'review_admin_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    // What the action touched: 'brand' | 'location' | 'industry' | 'reward' …
    targetType: text('target_type'),
    // Loosely-typed on purpose (uuid or slug depending on targetType).
    targetId: text('target_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_admin_audit_created_idx').on(t.createdAt),
    index('review_admin_audit_target_idx').on(t.targetType, t.targetId),
  ],
);

// ─── Public directory profile (per location) ────────────────────────────────
export const reviewDirectoryProfiles = pgTable(
  'review_directory_profiles',
  {
    locationId: uuid('location_id')
      .primaryKey()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    optIn: boolean('opt_in').default(true).notNull(),
    websiteUrl: text('website_url'),
    description: text('description'),
    city: text('city'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('review_directory_profiles_brand_idx').on(t.brandId)],
);

// ─── Directory URL identity ──────────────────────────────────────────────────
/**
 * The canonical public directory URL is TWO segments —
 * `/directory/:brandSlug/:locationSlug` — because a directory listing is a
 * LOCATION but visitors reach it through the business. Segment 1 lives here
 * (one slug per brand); segment 2 is `reviewLocations.slug`, which the location
 * already owns for `/r/:slug` and which already has rename history.
 */
export const reviewDirectoryBrands = pgTable(
  'review_directory_brands',
  {
    brandId: uuid('brand_id')
      .primaryKey()
      .references(() => brands.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('review_directory_brands_slug_lower_idx').on(sql`lower(${t.slug})`)],
);

/**
 * Every slug a directory URL was ever published at — the legacy brand-level
 * `/directory/:slug` and the combined `<brand>-<location>` slugs that the
 * location migration briefly minted. Public lookups fall back here and redirect
 * to the canonical two-segment URL, so shared links, embeds, badges and QR
 * codes never break. `locationId` is null for a brand-level alias, which
 * resolves to that brand's primary location.
 */
export const reviewDirectorySlugAliases = pgTable(
  'review_directory_slug_aliases',
  {
    slug: text('slug').primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => reviewLocations.id, {
      onDelete: 'cascade',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_directory_slug_aliases_lower_idx').on(sql`lower(${t.slug})`),
    index('review_directory_slug_aliases_brand_idx').on(t.brandId),
  ],
);

// ─── Referral codes (growth; tracks free-month credits earned) ──────────────
export const reviewReferralCodes = pgTable('review_referral_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  code: text('code').notNull().unique(),
  monthsEarned: integer('months_earned').default(0).notNull(),
  createdAt: createdAt(),
});

export const reviewReferralRedemptions = pgTable(
  'review_referral_redemptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    redeemedByUserId: uuid('redeemed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redeemedAt: createdAt(),
    // Settlement: stamped when the free month is granted to BOTH sides (as Stripe
    // customer-balance credit) — on the redeemer's first reviews-subscription
    // activation, or immediately if they were already subscribed. NULL = pending.
    creditedAt: timestamp('credited_at', { withTimezone: true }),
    creditAmount: numeric('credit_amount'),
    creditCurrency: text('credit_currency'),
  },
  (t) => [
    index('review_referral_redemptions_code_idx').on(t.code),
    // A user may redeem at most ONE referral code, ever (anti-farming).
    uniqueIndex('review_referral_redemptions_user_uniq').on(t.redeemedByUserId),
  ],
);

// ─── Relations ──────────────────────────────────────────────────────────────
export const reviewLocationsRelations = relations(
  reviewLocations,
  ({ one, many }) => ({
    brand: one(brands, {
      fields: [reviewLocations.brandId],
      references: [brands.id],
    }),
    platforms: many(reviewPlatforms),
    winTags: many(reviewWinTags),
    submissions: many(reviewSubmissions),
  }),
);

export const reviewPlatformsRelations = relations(
  reviewPlatforms,
  ({ one }) => ({
    location: one(reviewLocations, {
      fields: [reviewPlatforms.locationId],
      references: [reviewLocations.id],
    }),
  }),
);

export const reviewWinTagsRelations = relations(reviewWinTags, ({ one }) => ({
  location: one(reviewLocations, {
    fields: [reviewWinTags.locationId],
    references: [reviewLocations.id],
  }),
}));

export const reviewSubmissionsRelations = relations(
  reviewSubmissions,
  ({ one }) => ({
    location: one(reviewLocations, {
      fields: [reviewSubmissions.locationId],
      references: [reviewLocations.id],
    }),
  }),
);

/* ──────────────────────────────────────────────────────────────────────────
 * PAYMENTS (EziQuotes) — proposals/quotes + Stripe Connect payments tool,
 * migrated from the Manus prodesk-payments export. Tenancy: brand-scoped
 * (Manus `accounts` → `brands`, member roles → staff permissions; Manus
 * `users`/`account_users`/`team_members` dropped in favour of platform
 * users + staff + invites). All tables/enums carry the `payment_` prefix
 * to avoid collisions with the platform's own proposals/invoices domain.
 * See docs/agents/manus-migration.md.
 * ────────────────────────────────────────────────────────────────────────── */

// ─── Enums ──────────────────────────────────────────────────────────────────
export const paymentProposalStatus = pgEnum('payment_proposal_status', [
  'draft',
  'sent',
  'viewed',
  'engaged',
  'accepted',
  'paid',
  'declined',
  'expired',
  'archived',
  'disputed',
  'refunded',
  'partially_refunded',
  'active',
  'cancelled',
  'past_due',
]);
// paymentModelKind, paymentCurrency — hoisted above the proposals table (WS2).
export const paymentAccountStatus = pgEnum('payment_account_status', [
  'trial',
  'active',
  'suspended',
  'cancelled',
]);
export const paymentSmsStatus = pgEnum('payment_sms_status', [
  'queued',
  'sent',
  'delivered',
  'failed',
  'opted_out',
]);
export const paymentSmsTrigger = pgEnum('payment_sms_trigger', [
  'proposal_sent',
  'proposal_viewed',
  'proposal_accepted',
  'payment_received',
  'payment_overdue',
  'chase_1',
  'chase_2',
]);
// Source `payment_status` / `payment_type` enums — renamed to *_txn_* to avoid
// the awkward paymentPayment* double word (used by transactions/installments).
export const paymentTxnStatus = pgEnum('payment_txn_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
  'disputed',
  'due',
  'overdue',
  'succeeded',
]);
export const paymentTxnType = pgEnum('payment_txn_type', [
  'one_off',
  'installment',
  'subscription',
]);
export const paymentFrequency = pgEnum('payment_frequency', [
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'annually',
]);
export const paymentTemplateCategory = pgEnum('payment_template_category', [
  'general',
  'web_design',
  'branding',
  'photography',
  'copywriting',
  'consulting',
  'marketing',
  'development',
  'video',
  'other',
]);
// paymentBuilderMode — hoisted above the proposals table (WS2).
export const paymentAffiliateStatus = pgEnum('payment_affiliate_status', [
  'active',
  'inactive',
  'pending',
  'suspended',
]);
export const paymentRenewalType = pgEnum('payment_renewal_type', [
  'renewal',
  'anniversary',
  'check_in',
]);
export const paymentReminderStatus = pgEnum('payment_reminder_status', [
  'pending',
  'sent',
  'dismissed',
]);
export const paymentEmailTemplateType = pgEnum('payment_email_template_type', [
  'nudge',
  'payment_receipt',
  'payment_notification',
  'proposal_sent',
  'portal_link',
]);
export const paymentAnnotationStatus = pgEnum('payment_annotation_status', [
  'open',
  'resolved',
]);
export const paymentAccountReviewStatus = pgEnum(
  'payment_account_review_status',
  ['pending', 'approved', 'rejected'],
);
export const paymentSupportTicketStatus = pgEnum(
  'payment_support_ticket_status',
  ['open', 'in_progress', 'resolved', 'closed'],
);
export const paymentSupportTicketPriority = pgEnum(
  'payment_support_ticket_priority',
  ['low', 'medium', 'high', 'critical'],
);
// paymentTier — hoisted above the proposals table (WS2).
export const paymentTierChangeInitiator = pgEnum(
  'payment_tier_change_initiator',
  ['settings', 'contextual_prompt', 'admin', 'auto'],
);
// paymentRateLockReason — hoisted above the proposals table (WS2).
export const paymentRecoverWaitlistSource = pgEnum(
  'payment_recover_waitlist_source',
  ['signup', 'upgrade_prompt', 'settings', 'marketing_page'],
);
export const paymentSequenceType = pgEnum('payment_sequence_type', [
  'cold',
  'engagement',
  'missed_payment',
]);
export const paymentSequenceRunStatus = pgEnum('payment_sequence_run_status', [
  'pending',
  'running',
  'paused',
  'completed',
  'halted',
]);
export const paymentSequenceHaltReason = pgEnum(
  'payment_sequence_halt_reason',
  [
    'accepted',
    'declined',
    'in_conversation',
    'manual_pause',
    'max_messages_reached',
    'proposal_auto_pause',
    'recover_handoff_day14',
  ],
);
export const paymentSequenceMessageStatus = pgEnum(
  'payment_sequence_message_status',
  ['sent', 'failed', 'skipped', 'queued'],
);
export const paymentSequenceMessageChannel = pgEnum(
  'payment_sequence_message_channel',
  ['sms', 'email'],
);
// paymentCommercialIntent — hoisted above the proposals table (WS2).
export const paymentLifecycleEventType = pgEnum(
  'payment_lifecycle_event_type',
  [
    'catch_up',
    'card_update',
    'skip_requested',
    'skip_applied',
    'pause_started',
    'pause_ended',
    'payout_full',
    'cancel_requested',
    'cancel_confirmed',
    'defer_requested',
    'defer_approved',
    'defer_rejected',
    'vendor_override',
    'plan_resumed',
  ],
);
export const paymentLifecycleInitiator = pgEnum('payment_lifecycle_initiator', [
  'payer',
  'vendor',
  'system',
]);
export const paymentLifecycleRequestType = pgEnum(
  'payment_lifecycle_request_type',
  ['defer', 'custom_amount_change', 'pause_extension'],
);
export const paymentLifecycleRequestStatus = pgEnum(
  'payment_lifecycle_request_status',
  ['pending', 'approved', 'rejected', 'expired'],
);

// ─── Accounts (1:1 brand settings row — Manus `accounts` minus auth/SaaS-plan
// columns; the platform's Feature Subscriptions own SaaS billing) ────────────
export const paymentAccounts = pgTable('payment_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandId: uuid('brand_id')
    .notNull()
    .unique()
    .references(() => brands.id, { onDelete: 'cascade' }),
  businessName: text('business_name'),
  tradingName: text('trading_name'),
  abn: text('abn'),
  industry: text('industry'),
  teamSize: text('team_size'),
  monthlyVolumeEstimate: text('monthly_volume_estimate'),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  address: text('address'),
  country: text('country').default('AU').notNull(),
  logoUrl: text('logo_url'),
  logoKey: text('logo_key'),
  status: paymentAccountStatus('status').default('trial').notNull(),
  onboardingState: text('onboarding_state').default('signup').notNull(),
  stripeConnectAccountId: text('stripe_connect_account_id'),
  stripeConnectStatus: text('stripe_connect_status')
    .default('not_connected')
    .notNull(),
  stripeConnectOnboarded: boolean('stripe_connect_onboarded')
    .default(false)
    .notNull(),
  platformFeePercent: integer('platform_fee_percent').default(300).notNull(),
  reviewState: text('review_state').default('pending').notNull(),
  reviewNotes: text('review_notes'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  twilioFromNumber: text('twilio_from_number'),
  twilioAccountSid: text('twilio_account_sid'),
  twilioAuthToken: text('twilio_auth_token'),
  smsSenderId: text('sms_sender_id'),
  smsMonthlyCap: integer('sms_monthly_cap').default(500),
  smsEnabled: boolean('sms_enabled').default(false).notNull(),
  postmarkServerToken: text('postmark_server_token'),
  postmarkFromEmail: text('postmark_from_email'),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  pipedriveApiKey: text('pipedrive_api_key'),
  pipedriveConnected: boolean('pipedrive_connected').default(false).notNull(),
  pipedriveAccessToken: text('pipedrive_access_token'),
  pipedriveRefreshToken: text('pipedrive_refresh_token'),
  pipedriveTokenExpiresAt: timestamp('pipedrive_token_expires_at', {
    withTimezone: true,
  }),
  pipedriveApiDomain: text('pipedrive_api_domain'),
  pipedriveConnectedAt: timestamp('pipedrive_connected_at', {
    withTimezone: true,
  }),
  pipedrivePipelineId: integer('pipedrive_pipeline_id'),
  pipedriveStageId: integer('pipedrive_stage_id'),
  pipedriveWonStageId: integer('pipedrive_won_stage_id'),
  xeroAccessToken: text('xero_access_token'),
  xeroRefreshToken: text('xero_refresh_token'),
  xeroTokenExpiresAt: timestamp('xero_token_expires_at', {
    withTimezone: true,
  }),
  xeroTenantId: text('xero_tenant_id'),
  xeroConnectedAt: timestamp('xero_connected_at', { withTimezone: true }),
  defaultCurrency: paymentCurrency('default_currency').default('AUD').notNull(),
  defaultTaxRate: text('default_tax_rate').default('10.00').notNull(),
  taxLabel: text('tax_label').default('GST').notNull(),
  taxBehaviourDefault: text('tax_behaviour_default')
    .default('inclusive')
    .notNull(),
  timezone: text('timezone').default('Australia/Sydney').notNull(),
  autoChaseEnabled: boolean('auto_chase_enabled').default(false).notNull(),
  chaseDelayDays: integer('chase_delay_days').default(3).notNull(),
  chaseScheduleTaskUid: text('chase_schedule_task_uid'),
  reviewConditions: jsonb('review_conditions').$type<
    { type: string; label: string; value?: string }[] | null
  >(),
  proposalTheme: text('proposal_theme').default('agency'),
  myobAccessToken: text('myob_access_token'),
  myobRefreshToken: text('myob_refresh_token'),
  myobTokenExpiresAt: timestamp('myob_token_expires_at', {
    withTimezone: true,
  }),
  myobCompanyFileId: text('myob_company_file_id'),
  myobConnectedAt: timestamp('myob_connected_at', { withTimezone: true }),
  tier: paymentTier('tier').default('close').notNull(),
  tierDefaultRate: numeric('tier_default_rate', { precision: 4, scale: 2 })
    .default('4.50')
    .notNull(),
  tierChangedAt: timestamp('tier_changed_at', { withTimezone: true }),
  tierChangeHistory: jsonb('tier_change_history')
    .$type<Array<{ from: string; to: string; at: string; by: string | null }>>()
    .default(sql`'[]'::jsonb`),
  recoverCommittedUntil: timestamp('recover_committed_until', {
    withTimezone: true,
  }),
  recoverCommittedProposalIds: jsonb('recover_committed_proposal_ids')
    .$type<string[]>()
    .default(sql`'[]'::jsonb`),
  feePercentageOverride: numeric('fee_percentage_override', {
    precision: 4,
    scale: 2,
  }),
  feePercentageOverrideReason: text('fee_percentage_override_reason'),
  invitedToRecoverAt: timestamp('invited_to_recover_at', {
    withTimezone: true,
  }),
  thankYouConfig: jsonb('thank_you_config').$type<{
    headline: string;
    strap: string;
    steps: Array<{ stamp: string; title: string; body: string }>;
  } | null>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export type PaymentAccount = typeof paymentAccounts.$inferSelect;
export type InsertPaymentAccount = typeof paymentAccounts.$inferInsert;

// ─── Brand kits (proposal theming per account) ───────────────────────────────
export const paymentBrandKits = pgTable('payment_brand_kits', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandId: uuid('brand_id')
    .notNull()
    .unique()
    .references(() => brands.id, { onDelete: 'cascade' }),
  logoLightUrl: text('logo_light_url'),
  logoLightKey: text('logo_light_key'),
  logoDarkUrl: text('logo_dark_url'),
  logoDarkKey: text('logo_dark_key'),
  brandLogoUrl: text('brand_logo_url'),
  brandLogoKey: text('brand_logo_key'),
  faviconUrl: text('favicon_url'),
  primaryColor: text('primary_color').default('#0E0E0C'),
  accentColor: text('accent_color').default('#D9F542'),
  accentColor2: text('accent_color_2').default('#FFFFFF'),
  backgroundColor: text('background_color').default('#F4F1E8'),
  textColor: text('text_color').default('#0E0E0C'),
  darkColor: text('dark_color').default('#0A0A0A'),
  lightColor: text('light_color').default('#F4F1E8'),
  headingFont: text('heading_font').default('Inter Tight'),
  bodyFont: text('body_font').default('Inter Tight'),
  customFontUrl: text('custom_font_url'),
  heroImageUrl: text('hero_image_url'),
  videoUrl: text('video_url'),
  defaultIntroCopy: text('default_intro_copy'),
  defaultNextStepsCopy: text('default_next_steps_copy'),
  defaultTermsUrl: text('default_terms_url'),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export type PaymentBrandKit = typeof paymentBrandKits.$inferSelect;
export type InsertPaymentBrandKit = typeof paymentBrandKits.$inferInsert;

// ─── Clients ("payers" — the vendor's customers, not platform users) ─────────
export const paymentClients = pgTable(
  'payment_clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    businessName: text('business_name'),
    email: text('email'),
    mobile: text('mobile'),
    address: text('address'),
    abn: text('abn'),
    source: text('source').default('manual').notNull(),
    pipedrivePersonId: text('pipedrive_person_id'),
    pipedriveOrgId: text('pipedrive_org_id'),
    pipedriveDealId: text('pipedrive_deal_id'),
    internalNotes: text('internal_notes'),
    tags: text('tags'),
    stripeCustomerId: text('stripe_customer_id'),
    doNotSms: boolean('do_not_sms').default(false).notNull(),
    doNotEmail: boolean('do_not_email').default(false).notNull(),
    // Opt-in link to a platform user (WS3 CRM promotion) — set when a contact is
    // matched to / claimed by a Prodesk account. Nullable: most contacts are
    // external parties with no platform login.
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_clients_brand_idx').on(t.brandId)],
);
export type PaymentClient = typeof paymentClients.$inferSelect;
export type InsertPaymentClient = typeof paymentClients.$inferInsert;

export const paymentClientNotes = pgTable(
  'payment_client_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => paymentClients.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    type: text('type').default('note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('payment_client_notes_brand_idx').on(t.brandId)],
);
export type PaymentClientNote = typeof paymentClientNotes.$inferSelect;
export type InsertPaymentClientNote = typeof paymentClientNotes.$inferInsert;

export const paymentClientPortalTokens = pgTable(
  'payment_client_portal_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => paymentClients.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_client_portal_tokens_brand_idx').on(t.brandId)],
);
export type PaymentClientPortalToken =
  typeof paymentClientPortalTokens.$inferSelect;
export type InsertPaymentClientPortalToken =
  typeof paymentClientPortalTokens.$inferInsert;

export const paymentClientReferrals = pgTable(
  'payment_client_referrals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    referrerClientId: uuid('referrer_client_id')
      .notNull()
      .references(() => paymentClients.id, { onDelete: 'cascade' }),
    referredClientId: uuid('referred_client_id')
      .notNull()
      .references(() => paymentClients.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    rewardCents: integer('reward_cents').default(0).notNull(),
    notes: text('notes'),
    creditApplied: boolean('credit_applied').default(false).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_client_referrals_brand_idx').on(t.brandId)],
);
export type PaymentClientReferral = typeof paymentClientReferrals.$inferSelect;
export type InsertPaymentClientReferral =
  typeof paymentClientReferrals.$inferInsert;

// ─── Templates ───────────────────────────────────────────────────────────────
export const paymentTemplates = pgTable(
  'payment_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').default('active').notNull(),
    source: text('source').default('scratch').notNull(),
    category: paymentTemplateCategory('category').default('general').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    thumbnailKey: text('thumbnail_key'),
    structure: jsonb('structure')
      .notNull()
      .default(sql`'[]'::jsonb`),
    defaultLineItems: jsonb('default_line_items').default(sql`'[]'::jsonb`),
    brandKitId: uuid('brand_kit_id').references(() => paymentBrandKits.id, {
      onDelete: 'set null',
    }),
    libraryTemplateId: text('library_template_id'),
    isSystem: boolean('is_system').default(false).notNull(),
    isPublic: boolean('is_public').default(false).notNull(),
    usageCount: integer('usage_count').default(0).notNull(),
    acceptanceRate: text('acceptance_rate').default('0.00'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_templates_brand_idx').on(t.brandId)],
);
export type PaymentTemplate = typeof paymentTemplates.$inferSelect;
export type InsertPaymentTemplate = typeof paymentTemplates.$inferInsert;

// ─── Pricing catalog (products / add-ons / pricing tables / quick sets) ──────
export const paymentProducts = pgTable(
  'payment_products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    basePriceCents: integer('base_price_cents').notNull().default(0),
    currency: paymentCurrency('currency').default('AUD').notNull(),
    unit: text('unit').default('project'),
    customUnitLabel: text('custom_unit_label'),
    taxBehaviour: text('tax_behaviour').default('inclusive').notNull(),
    defaultPaymentModel: paymentModelKind('default_payment_model')
      .default('one_off')
      .notNull(),
    costCents: integer('cost_cents').default(0),
    status: text('status').default('active').notNull(),
    category: text('category'),
    typeTag: text('type_tag'),
    isActive: boolean('is_active').default(true).notNull(),
    stripeProductId: text('stripe_product_id'),
    stripePriceId: text('stripe_price_id'),
    // Optional link to the richer agency `services` catalog (the canonical
    // product model). Lets a payments product reference the same offering a
    // brand publishes through its derived agency. Nullable — standalone
    // payments products don't require one.
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_products_brand_idx').on(t.brandId)],
);
export type PaymentProduct = typeof paymentProducts.$inferSelect;
export type InsertPaymentProduct = typeof paymentProducts.$inferInsert;

export const paymentAddons = pgTable(
  'payment_addons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    priceCents: integer('price_cents').notNull().default(0),
    unit: text('unit').default('month'),
    currency: paymentCurrency('currency').default('AUD').notNull(),
    appliesToProductIds: jsonb('applies_to_product_ids').default(
      sql`'[]'::jsonb`,
    ),
    type: text('type').default('recurring').notNull(),
    quantityBehaviour: text('quantity_behaviour').default('fixed').notNull(),
    status: text('status').default('active').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_addons_brand_idx').on(t.brandId)],
);
export type PaymentAddon = typeof paymentAddons.$inferSelect;
export type InsertPaymentAddon = typeof paymentAddons.$inferInsert;

export const paymentPricingTables = pgTable(
  'payment_pricing_tables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status').default('active').notNull(),
    tiers: jsonb('tiers').default(sql`'[]'::jsonb`),
    displayRule: text('display_rule').default('show_all').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_pricing_tables_brand_idx').on(t.brandId)],
);
export type PaymentPricingTable = typeof paymentPricingTables.$inferSelect;
export type InsertPaymentPricingTable =
  typeof paymentPricingTables.$inferInsert;

export const paymentQuickSets = pgTable(
  'payment_quick_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status').default('active').notNull(),
    options: jsonb('options').default(sql`'[]'::jsonb`),
    paymentModelsAvailable: jsonb('payment_models_available').default(
      sql`'[]'::jsonb`,
    ),
    defaultPaymentModel: paymentModelKind('default_payment_model')
      .default('one_off')
      .notNull(),
    defaultConfiguration: jsonb('default_configuration').default(
      sql`'{}'::jsonb`,
    ),
    lineItemsJson: text('line_items_json').notNull().default('[]'),
    totalCents: integer('total_cents').notNull().default(0),
    currency: paymentCurrency('currency').default('AUD').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_quick_sets_brand_idx').on(t.brandId)],
);
export type PaymentQuickSet = typeof paymentQuickSets.$inferSelect;
export type InsertPaymentQuickSet = typeof paymentQuickSets.$inferInsert;

// ─── Proposals ───────────────────────────────────────────────────────────────
// (payment_proposals removed in WS2d — EziQuotes proposals are now kind='payer'
// rows in the canonical `proposals` table above. Payer children
// (revisions/annotations/questions/transactions/…) reference proposals.id.)

export const paymentProposalRevisions = pgTable(
  'payment_proposal_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    structure: jsonb('structure')
      .notNull()
      .default(sql`'[]'::jsonb`),
    paymentConfig: jsonb('payment_config').default(sql`'{}'::jsonb`),
    totalCents: integer('total_cents').notNull().default(0),
    version: integer('version').default(1).notNull(),
    title: text('title'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_proposal_revisions_proposal_idx').on(t.proposalId)],
);
export type PaymentProposalRevision =
  typeof paymentProposalRevisions.$inferSelect;
export type InsertPaymentProposalRevision =
  typeof paymentProposalRevisions.$inferInsert;

export const paymentProposalAnnotations = pgTable(
  'payment_proposal_annotations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    blockId: text('block_id'),
    anchorText: text('anchor_text'),
    comment: text('comment').notNull(),
    clientName: text('client_name'),
    clientEmail: text('client_email'),
    status: paymentAnnotationStatus('status').default('open').notNull(),
    ownerReply: text('owner_reply'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_proposal_annotations_proposal_idx').on(t.proposalId)],
);
export type PaymentProposalAnnotation =
  typeof paymentProposalAnnotations.$inferSelect;
export type InsertPaymentProposalAnnotation =
  typeof paymentProposalAnnotations.$inferInsert;

export const paymentProposalQuestions = pgTable(
  'payment_proposal_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    clientName: text('client_name'),
    clientEmail: text('client_email'),
    question: text('question').notNull(),
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredByUserId: uuid('answered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_proposal_questions_brand_idx').on(t.brandId)],
);
export type PaymentProposalQuestion =
  typeof paymentProposalQuestions.$inferSelect;
export type InsertPaymentProposalQuestion =
  typeof paymentProposalQuestions.$inferInsert;

// ─── Transactions (source table `payments` — renamed to avoid payment_payments) ─
export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeInvoiceId: text('stripe_invoice_id'),
    stripeChargeId: text('stripe_charge_id'),
    amountCents: integer('amount_cents').notNull(),
    platformFeeCents: integer('platform_fee_cents').default(0).notNull(),
    currency: paymentCurrency('currency').default('AUD').notNull(),
    status: paymentTxnStatus('status').default('pending').notNull(),
    type: paymentTxnType('type').default('one_off').notNull(),
    installmentNumber: integer('installment_number'),
    receiptUrl: text('receipt_url'),
    idempotencyKey: text('idempotency_key').unique(),
    failureReason: text('failure_reason'),
    applicationFeeCents: integer('application_fee_cents').default(0).notNull(),
    chaseStatus: text('chase_status'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payment_transactions_brand_idx').on(t.brandId),
    index('payment_transactions_proposal_idx').on(t.proposalId),
  ],
);
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = typeof paymentTransactions.$inferInsert;

export const paymentInstallmentSchedules = pgTable(
  'payment_installment_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    installmentNumber: integer('installment_number').notNull(),
    amountCents: integer('amount_cents').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    status: paymentTxnStatus('status').default('pending').notNull(),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    clientId: uuid('client_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    currency: text('currency').default('AUD'),
    totalInstallments: integer('total_installments'),
    chargeError: text('charge_error'),
    autoChargeAt: timestamp('auto_charge_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_installment_schedules_proposal_idx').on(t.proposalId),
    index('payment_installment_schedules_brand_idx').on(t.brandId),
  ],
);
export type PaymentInstallmentSchedule =
  typeof paymentInstallmentSchedules.$inferSelect;
export type InsertPaymentInstallmentSchedule =
  typeof paymentInstallmentSchedules.$inferInsert;

export const paymentRecurringInvoices = pgTable(
  'payment_recurring_invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => paymentClients.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    lineItemsJson: text('line_items_json').notNull().default('[]'),
    currency: paymentCurrency('currency').default('AUD').notNull(),
    totalCents: integer('total_cents').notNull().default(0),
    frequency: paymentFrequency('frequency').notNull().default('monthly'),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }).notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    isActive: boolean('is_active').default(true).notNull(),
    scheduleCronTaskUid: text('schedule_cron_task_uid'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_recurring_invoices_brand_idx').on(t.brandId)],
);
export type PaymentRecurringInvoice =
  typeof paymentRecurringInvoices.$inferSelect;
export type InsertPaymentRecurringInvoice =
  typeof paymentRecurringInvoices.$inferInsert;

// ─── SMS / email comms ───────────────────────────────────────────────────────
export const paymentSmsMessages = pgTable(
  'payment_sms_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    toNumber: text('to_number').notNull(),
    body: text('body').notNull(),
    status: paymentSmsStatus('status').default('queued').notNull(),
    trigger: paymentSmsTrigger('trigger'),
    twilioSid: text('twilio_sid'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_sms_messages_brand_idx').on(t.brandId)],
);
export type PaymentSmsMessage = typeof paymentSmsMessages.$inferSelect;
export type InsertPaymentSmsMessage = typeof paymentSmsMessages.$inferInsert;

export const paymentEmailLogs = pgTable(
  'payment_email_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    templateType: paymentEmailTemplateType('template_type'),
    postmarkMessageId: text('postmark_message_id'),
    status: text('status').default('sent').notNull(),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    spamAt: timestamp('spam_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    title: text('title'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_email_logs_brand_idx').on(t.brandId)],
);
export type PaymentEmailLog = typeof paymentEmailLogs.$inferSelect;
export type InsertPaymentEmailLog = typeof paymentEmailLogs.$inferInsert;

export const paymentEmailTemplates = pgTable(
  'payment_email_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    type: paymentEmailTemplateType('type').notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    isCustom: boolean('is_custom').default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_email_templates_brand_idx').on(t.brandId)],
);
export type PaymentEmailTemplate = typeof paymentEmailTemplates.$inferSelect;
export type InsertPaymentEmailTemplate =
  typeof paymentEmailTemplates.$inferInsert;

// ─── Affiliates ──────────────────────────────────────────────────────────────
export const paymentAffiliates = pgTable(
  'payment_affiliates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    code: text('code').notNull().unique(),
    commissionPercent: integer('commission_percent').default(1000).notNull(),
    status: paymentAffiliateStatus('status').default('pending').notNull(),
    stripeConnectId: text('stripe_connect_id'),
    totalEarnedCents: integer('total_earned_cents').default(0).notNull(),
    totalPaidCents: integer('total_paid_cents').default(0).notNull(),
    referralCode: text('referral_code').unique(),
    activeReferrals: integer('active_referrals').default(0).notNull(),
    totalReferrals: integer('total_referrals').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_affiliates_brand_idx').on(t.brandId)],
);
export type PaymentAffiliate = typeof paymentAffiliates.$inferSelect;
export type InsertPaymentAffiliate = typeof paymentAffiliates.$inferInsert;

export const paymentAffiliateReferrals = pgTable(
  'payment_affiliate_referrals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    affiliateId: uuid('affiliate_id')
      .notNull()
      .references(() => paymentAffiliates.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    commissionCents: integer('commission_cents').default(0).notNull(),
    referredName: text('referred_name'),
    referredEmail: text('referred_email'),
    signedUpAt: timestamp('signed_up_at', { withTimezone: true }),
    status: text('status').default('pending').notNull(),
    volumeCents: integer('volume_cents').default(0).notNull(),
    earnedCents: integer('earned_cents').default(0).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_affiliate_referrals_brand_idx').on(t.brandId)],
);
export type PaymentAffiliateReferral =
  typeof paymentAffiliateReferrals.$inferSelect;
export type InsertPaymentAffiliateReferral =
  typeof paymentAffiliateReferrals.$inferInsert;

export const paymentAffiliatePayouts = pgTable(
  'payment_affiliate_payouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    affiliateId: uuid('affiliate_id')
      .notNull()
      .references(() => paymentAffiliates.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    stripeTransferId: text('stripe_transfer_id'),
    status: text('status').default('paid').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('payment_affiliate_payouts_brand_idx').on(t.brandId)],
);
export type PaymentAffiliatePayout =
  typeof paymentAffiliatePayouts.$inferSelect;
export type InsertPaymentAffiliatePayout =
  typeof paymentAffiliatePayouts.$inferInsert;

// ─── Client surveys (NPS) ────────────────────────────────────────────────────
export const paymentClientSurveys = pgTable(
  'payment_client_surveys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    npsScore: integer('nps_score'),
    feedback: text('feedback'),
    token: text('token').unique(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    rating: integer('rating'),
    wouldRefer: boolean('would_refer'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_client_surveys_brand_idx').on(t.brandId)],
);
export type PaymentClientSurvey = typeof paymentClientSurveys.$inferSelect;
export type InsertPaymentClientSurvey =
  typeof paymentClientSurveys.$inferInsert;

// ─── Activity + audit logs ───────────────────────────────────────────────────
export const paymentActivityLog = pgTable(
  'payment_activity_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    eventType: text('event_type'),
    entityType: text('entity_type'),
    // Polymorphic reference (uuid of any payment_* row) — no FK on purpose.
    entityId: uuid('entity_id'),
    actorId: uuid('actor_id'),
    actorType: text('actor_type'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_activity_log_brand_idx').on(t.brandId),
    index('payment_activity_log_occurred_idx').on(t.occurredAt),
  ],
);
export type PaymentActivityLogEntry = typeof paymentActivityLog.$inferSelect;
export type InsertPaymentActivityLogEntry =
  typeof paymentActivityLog.$inferInsert;

export const paymentAuditLogs = pgTable(
  'payment_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    resource: text('resource'),
    // Polymorphic reference — no FK on purpose.
    resourceId: uuid('resource_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_audit_logs_brand_idx').on(t.brandId)],
);
export type PaymentAuditLog = typeof paymentAuditLogs.$inferSelect;
export type InsertPaymentAuditLog = typeof paymentAuditLogs.$inferInsert;

// ─── Feature flags (payments-product global toggles, admin surface) ─────────
export const paymentFeatureFlags = pgTable('payment_feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  key: text('key').unique(),
  enabled: boolean('enabled').default(false).notNull(),
  description: text('description'),
  rolloutPercent: integer('rollout_percent').default(100).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export type PaymentFeatureFlag = typeof paymentFeatureFlags.$inferSelect;
export type InsertPaymentFeatureFlag = typeof paymentFeatureFlags.$inferInsert;

// ─── Account vetting reviews + support tickets (admin surfaces) ──────────────
export const paymentAccountReviews = pgTable(
  'payment_account_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: paymentAccountReviewStatus('status').default('pending').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_account_reviews_brand_idx').on(t.brandId)],
);
export type PaymentAccountReview = typeof paymentAccountReviews.$inferSelect;
export type InsertPaymentAccountReview =
  typeof paymentAccountReviews.$inferInsert;

export const paymentSupportTickets = pgTable(
  'payment_support_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: paymentSupportTicketStatus('status').default('open').notNull(),
    priority: paymentSupportTicketPriority('priority')
      .default('medium')
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_support_tickets_brand_idx').on(t.brandId)],
);
export type PaymentSupportTicket = typeof paymentSupportTickets.$inferSelect;
export type InsertPaymentSupportTicket =
  typeof paymentSupportTickets.$inferInsert;

// ─── Renewal reminders ───────────────────────────────────────────────────────
export const paymentRenewalReminders = pgTable(
  'payment_renewal_reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => paymentClients.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    type: paymentRenewalType('type').default('renewal').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    status: paymentReminderStatus('status').default('pending').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_renewal_reminders_brand_idx').on(t.brandId)],
);
export type PaymentRenewalReminder =
  typeof paymentRenewalReminders.$inferSelect;
export type InsertPaymentRenewalReminder =
  typeof paymentRenewalReminders.$inferInsert;

// ─── Inbound Stripe webhook event log ────────────────────────────────────────
export const paymentWebhookDeliveries = pgTable(
  'payment_webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    stripeEventId: text('stripe_event_id').unique(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_webhook_deliveries_brand_idx').on(t.brandId)],
);
export type PaymentWebhookDelivery =
  typeof paymentWebhookDeliveries.$inferSelect;
export type InsertPaymentWebhookDelivery =
  typeof paymentWebhookDeliveries.$inferInsert;

// ─── SMS compliance + volume logs ────────────────────────────────────────────
export const paymentSmsOptOuts = pgTable('payment_sms_opt_outs', {
  id: uuid('id').defaultRandom().primaryKey(),
  phoneNumber: text('phone_number').notNull().unique(),
  keyword: text('keyword').default('STOP').notNull(),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export type PaymentSmsOptOut = typeof paymentSmsOptOuts.$inferSelect;
export type InsertPaymentSmsOptOut = typeof paymentSmsOptOuts.$inferInsert;

export const paymentSmsLogs = pgTable(
  'payment_sms_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'cascade',
    }),
    toNumber: text('to_number').notNull(),
    body: text('body').notNull(),
    twilioSid: text('twilio_sid'),
    status: text('status').default('sent').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('payment_sms_logs_brand_idx').on(t.brandId)],
);
export type PaymentSmsLog = typeof paymentSmsLogs.$inferSelect;
export type InsertPaymentSmsLog = typeof paymentSmsLogs.$inferInsert;

// ─── Tier changes + Recover waitlist ─────────────────────────────────────────
export const paymentTierChanges = pgTable(
  'payment_tier_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    fromTier: paymentTier('from_tier').notNull(),
    toTier: paymentTier('to_tier').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    initiatedVia: paymentTierChangeInitiator('initiated_via').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    committedPlanCount: integer('committed_plan_count').default(0).notNull(),
    committedPlanValueCents: bigint('committed_plan_value_cents', {
      mode: 'number',
    })
      .default(0)
      .notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('payment_tier_changes_brand_idx').on(t.brandId)],
);
export type PaymentTierChange = typeof paymentTierChanges.$inferSelect;
export type InsertPaymentTierChange = typeof paymentTierChanges.$inferInsert;

export const paymentRecoverWaitlist = pgTable('payment_recover_waitlist', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandId: uuid('brand_id')
    .notNull()
    .unique()
    .references(() => brands.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  source: paymentRecoverWaitlistSource('source').notNull(),
  estimatedMonthlyMissedCents: integer('estimated_monthly_missed_cents'),
  preferredContact: text('preferred_contact'),
  notes: text('notes'),
});
export type PaymentRecoverWaitlistEntry =
  typeof paymentRecoverWaitlist.$inferSelect;
export type InsertPaymentRecoverWaitlistEntry =
  typeof paymentRecoverWaitlist.$inferInsert;

// ─── Sequences (cold / engagement / missed-payment cadences) ─────────────────
export const paymentSequenceDefinitions = pgTable(
  'payment_sequence_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    sequenceType: paymentSequenceType('sequence_type').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    touchpoints: jsonb('touchpoints')
      .$type<
        Array<{
          dayOffset?: number;
          viewTier?: string;
          smsEnabled: boolean;
          smsBody: string;
          emailEnabled: boolean;
          emailSubject: string;
          emailBody: string;
          isActive: boolean;
        }>
      >()
      .default(sql`'[]'::jsonb`),
    rules: jsonb('rules')
      .$type<{
        cooldownHours?: number;
        maxMessagesPerProposal?: number;
        minHoursBetweenMessages?: number;
      }>()
      .default(sql`'{}'::jsonb`),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
    lastEditedByUserId: uuid('last_edited_by_user_id').references(
      () => users.id,
      {
        onDelete: 'set null',
      },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_sequence_definitions_brand_idx').on(t.brandId)],
);
export type PaymentSequenceDefinition =
  typeof paymentSequenceDefinitions.$inferSelect;
export type InsertPaymentSequenceDefinition =
  typeof paymentSequenceDefinitions.$inferInsert;

export const paymentSequenceRuns = pgTable(
  'payment_sequence_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    sequenceType: paymentSequenceType('sequence_type').notNull(),
    status: paymentSequenceRunStatus('status').default('pending').notNull(),
    haltReason: paymentSequenceHaltReason('halt_reason'),
    touchpointsFired: jsonb('touchpoints_fired')
      .$type<
        Array<{
          touchpointIndex: number;
          firedAt: string;
          smsSid?: string;
          emailMessageId?: string;
        }>
      >()
      .default(sql`'[]'::jsonb`),
    nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
    viewCount: integer('view_count').default(0).notNull(),
    lastViewAt: timestamp('last_view_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payment_sequence_runs_brand_idx').on(t.brandId),
    index('payment_sequence_runs_proposal_idx').on(t.proposalId),
    index('payment_sequence_runs_next_fire_idx').on(t.nextFireAt),
  ],
);
export type PaymentSequenceRun = typeof paymentSequenceRuns.$inferSelect;
export type InsertPaymentSequenceRun = typeof paymentSequenceRuns.$inferInsert;

export const paymentSequenceMessageLog = pgTable(
  'payment_sequence_message_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sequenceRunId: uuid('sequence_run_id')
      .notNull()
      .references(() => paymentSequenceRuns.id, { onDelete: 'cascade' }),
    touchpointIndex: integer('touchpoint_index').notNull(),
    channel: paymentSequenceMessageChannel('channel').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: paymentSequenceMessageStatus('status').notNull(),
    skipReason: text('skip_reason'),
    renderedBody: text('rendered_body'),
    placeholdersUsed: jsonb('placeholders_used')
      .$type<Record<string, string>>()
      .default(sql`'{}'::jsonb`),
    externalId: text('external_id'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_sequence_message_log_run_idx').on(t.sequenceRunId)],
);
export type PaymentSequenceMessageLogEntry =
  typeof paymentSequenceMessageLog.$inferSelect;
export type InsertPaymentSequenceMessageLogEntry =
  typeof paymentSequenceMessageLog.$inferInsert;

// ─── Payer lifecycle (post-acceptance plan events + approval requests) ───────
export const paymentPayerLifecycleEvents = pgTable(
  'payment_payer_lifecycle_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    // The payer is the vendor's client (payment_clients), not a platform user.
    payerId: uuid('payer_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    eventType: paymentLifecycleEventType('event_type').notNull(),
    initiatedBy: paymentLifecycleInitiator('initiated_by').notNull(),
    initiatedByUserId: uuid('initiated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    stripeObjectId: text('stripe_object_id'),
  },
  (t) => [
    index('payment_payer_lifecycle_events_brand_idx').on(t.brandId),
    index('payment_payer_lifecycle_events_proposal_idx').on(t.proposalId),
  ],
);
export type PaymentPayerLifecycleEvent =
  typeof paymentPayerLifecycleEvents.$inferSelect;
export type InsertPaymentPayerLifecycleEvent =
  typeof paymentPayerLifecycleEvents.$inferInsert;

export const paymentLifecycleRequests = pgTable(
  'payment_lifecycle_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    payerId: uuid('payer_id').references(() => paymentClients.id, {
      onDelete: 'set null',
    }),
    requestType: paymentLifecycleRequestType('request_type').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: paymentLifecycleRequestStatus('status')
      .default('pending')
      .notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    decisionReason: text('decision_reason'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_lifecycle_requests_brand_idx').on(t.brandId)],
);
export type PaymentLifecycleRequest =
  typeof paymentLifecycleRequests.$inferSelect;
export type InsertPaymentLifecycleRequest =
  typeof paymentLifecycleRequests.$inferInsert;

// ─── Outbound webhooks (vendor-configured lifecycle event delivery) ──────────
export const paymentWebhookEndpoints = pgTable(
  'payment_webhook_endpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(), // HMAC-SHA256 signing secret
    description: text('description'),
    enabled: boolean('enabled').default(true).notNull(),
    // Comma-separated list of event types to subscribe to; null = all events.
    eventFilter: text('event_filter'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_webhook_endpoints_brand_idx').on(t.brandId)],
);
export type PaymentWebhookEndpoint =
  typeof paymentWebhookEndpoints.$inferSelect;
export type InsertPaymentWebhookEndpoint =
  typeof paymentWebhookEndpoints.$inferInsert;

export const paymentOutboundWebhookDeliveries = pgTable(
  'payment_outbound_webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => paymentWebhookEndpoints.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    attempt: integer('attempt').default(1).notNull(),
    status: text('status').default('pending').notNull(), // pending | success | failed | abandoned
    httpStatus: integer('http_status'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_outbound_webhook_deliveries_brand_idx').on(t.brandId),
    index('payment_outbound_webhook_deliveries_retry_idx').on(t.nextRetryAt),
  ],
);
export type PaymentOutboundWebhookDelivery =
  typeof paymentOutboundWebhookDeliveries.$inferSelect;
export type InsertPaymentOutboundWebhookDelivery =
  typeof paymentOutboundWebhookDeliveries.$inferInsert;

// ─── Plan tiers CMS — single source of truth for fee percentages (global,
// super-admin managed; changes propagate to marketing, builder, charges) ─────
export const paymentPlanTiers = pgTable('payment_plan_tiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(), // "send" | "close" | "recover"
  name: text('name').notNull(), // "Send" | "Close" | "Recover"
  pct: numeric('pct', { precision: 5, scale: 2 }).notNull(), // e.g. "1.00"
  label: text('label'), // sub-label e.g. "PER PAYMENT · NO SUBSCRIPTION"
  tagline: text('tagline'),
  blurb: text('blurb'),
  status: text('status').default('active').notNull(), // "active" | "coming_soon"
  sortOrder: integer('sort_order').default(1).notNull(),
  updatedAt: updatedAt(),
});
export type PaymentPlanTier = typeof paymentPlanTiers.$inferSelect;
export type InsertPaymentPlanTier = typeof paymentPlanTiers.$inferInsert;

export const paymentPlanTierRateAudit = pgTable(
  'payment_plan_tier_rate_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tierKey: text('tier_key').notNull(), // "send" | "close" | "recover"
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    changedByName: text('changed_by_name'), // display name for UI
    oldPct: numeric('old_pct', { precision: 5, scale: 2 }).notNull(),
    newPct: numeric('new_pct', { precision: 5, scale: 2 }).notNull(),
    createdAt: createdAt(),
  },
);
export type PaymentPlanTierRateAudit =
  typeof paymentPlanTierRateAudit.$inferSelect;
export type InsertPaymentPlanTierRateAudit =
  typeof paymentPlanTierRateAudit.$inferInsert;

// ─── Vendor-configurable line-item categories (6 defaults seeded per account;
// defaults can be renamed/recoloured but not deleted — archived_at instead) ──
export const paymentCategories = pgTable(
  'payment_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // e.g. "labour", "materials", "strategy"
    label: text('label').notNull(), // display name
    colourHex: text('colour_hex').notNull(), // e.g. "#3B82F6"
    displayOrder: integer('display_order').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('payment_categories_brand_idx').on(t.brandId)],
);
export type PaymentCategory = typeof paymentCategories.$inferSelect;
export type InsertPaymentCategory = typeof paymentCategories.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────
export const paymentAccountsRelations = relations(
  paymentAccounts,
  ({ one }) => ({
    brand: one(brands, {
      fields: [paymentAccounts.brandId],
      references: [brands.id],
    }),
  }),
);

export const paymentClientsRelations = relations(
  paymentClients,
  ({ one, many }) => ({
    brand: one(brands, {
      fields: [paymentClients.brandId],
      references: [brands.id],
    }),
    proposals: many(proposals),
  }),
);

export const paymentProposalRevisionsRelations = relations(
  paymentProposalRevisions,
  ({ one }) => ({
    proposal: one(proposals, {
      fields: [paymentProposalRevisions.proposalId],
      references: [proposals.id],
    }),
  }),
);

export const paymentTransactionsRelations = relations(
  paymentTransactions,
  ({ one }) => ({
    proposal: one(proposals, {
      fields: [paymentTransactions.proposalId],
      references: [proposals.id],
    }),
  }),
);

/* ──────────────────────────────────────────────────────────────────────────
 * SUPPORT TICKETS — platform-wide customer support ticketing.
 *   A ticket is created by any user from any frontend (the shared /support
 *   page). Every reply is a threaded comment (support_ticket_comments) that
 *   fires an email to the other party. Super-admins triage from the
 *   /super-admin/tickets console. `ticketNumber` is a human-facing, globally
 *   monotonic identity (like invoices.number).
 * ────────────────────────────────────────────────────────────────────────── */

export const supportTicketStatus = pgEnum('support_ticket_status', [
  'open',
  'in_progress',
  'resolved',
  'closed',
]);
export const supportTicketPriority = pgEnum('support_ticket_priority', [
  'low',
  'medium',
  'high',
  'urgent',
]);
export const supportTicketCategory = pgEnum('support_ticket_category', [
  'general',
  'billing',
  'technical',
  'feature_request',
  'account',
  'other',
]);
/** Who authored a ticket message — drives which party gets emailed. */
export const supportActor = pgEnum('support_actor', ['customer', 'support']);
/**
 * Which SURFACE opened the ticket. Both land in the same triage console and use
 * the same threading/emails, but they are two different products to the user:
 *
 * - `support`  — the /support screen. The user knows it's a ticket.
 * - `feedback` — the floating feedback panel every frontend mounts. The UI never
 *   says "ticket", "priority" or "status"; it's "your feedback" and "our reply".
 *
 * It's a real column (not a category or a metadata flag) because the feedback
 * panel lists a user's own feedback on open, and the admin console filters by
 * surface — both need an indexable predicate, not a jsonb probe.
 */
export const supportTicketSource = pgEnum('support_ticket_source', [
  'support',
  'feedback',
]);

/** One attachment on a ticket or comment (public storage URL + metadata). */
export type SupportAttachment = { url: string; name: string; size: number };

/** A single captured browser console entry (from the client ring buffer). */
export type SupportConsoleEntry = {
  /** 'log' | 'info' | 'warn' | 'error' | 'debug' | 'exception' | 'rejection'. */
  level: string;
  message: string;
  /** ISO timestamp of when the entry was logged. */
  at: string;
};

/**
 * Diagnostic bundle captured when a ticket is opened — the exact page URL the
 * ticket was raised from, the caller's device/browser/network fingerprint, and
 * a tail of the browser console so support can reproduce issues. Client-supplied
 * fields (pageUrl, screen, console, …) are enriched server-side with the trusted
 * `ip`, `userAgent`, and `client` from the request headers. Purely informational
 * for the admin console — never a visibility or auth gate.
 */
export type SupportTicketMetadata = {
  /** Full href of the page the ticket was raised from (path + query). */
  pageUrl?: string | null;
  /** window.location.origin at capture (mirrors appOrigin, kept for parity). */
  origin?: string | null;
  /** document.referrer, if any. */
  referrer?: string | null;
  /** navigator.userAgent — set server-side from the request header. */
  userAgent?: string | null;
  /** Caller IP (first x-forwarded-for hop) — set server-side, never trusted from the client. */
  ip?: string | null;
  /** Which Prodesk frontend issued the request (x-prodesk-client header). */
  client?: string | null;
  /** navigator.platform (best-effort; deprecated but still useful). */
  platform?: string | null;
  language?: string | null;
  languages?: string[] | null;
  /** IANA timezone (Intl.DateTimeFormat().resolvedOptions().timeZone). */
  timezone?: string | null;
  /** UTC offset in minutes (getTimezoneOffset). */
  timezoneOffsetMinutes?: number | null;
  screen?: { width: number; height: number } | null;
  viewport?: { width: number; height: number } | null;
  devicePixelRatio?: number | null;
  /** Tail of recent browser console output (see console-capture.ts). */
  console?: SupportConsoleEntry[] | null;
};

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Human-facing sequential ticket number — one monotonic sequence shared
    // across every ticket, auto-assigned by Postgres on insert. Mirrors
    // invoices.number so support can say "ticket #42".
    ticketNumber: integer('ticket_number').generatedByDefaultAsIdentity(),
    // Creator. Kept even if the user is deleted (set null) so the history stays.
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Where replies to the customer are sent — defaults to the creator's email,
    // but the customer may override it at creation.
    contactEmail: text('contact_email').notNull(),
    // The frontend origin the ticket was raised from (ctx.clientOrigin), so
    // admins see which app it came from and customer links resolve back to it.
    appOrigin: text('app_origin'),
    // Selected context at creation — admin insight only, NOT a visibility gate.
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    agencyId: uuid('agency_id').references(() => agencies.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    // The surface this came from — see supportTicketSource. Existing rows (and
    // anything created by the /support screen) are 'support'.
    source: supportTicketSource('source').default('support').notNull(),
    status: supportTicketStatus('status').default('open').notNull(),
    priority: supportTicketPriority('priority').default('medium').notNull(),
    category: supportTicketCategory('category').default('general').notNull(),
    attachments: jsonb('attachments').$type<SupportAttachment[]>().default([]),
    // Origin URL + device/network/console diagnostics captured at creation, for
    // the admin triage console. See SupportTicketMetadata.
    metadata: jsonb('metadata').$type<SupportTicketMetadata>(),
    // Denormalised for the admin list + "you have a reply" cues.
    lastActorRole: supportActor('last_actor_role'),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('support_tickets_user_idx').on(t.userId),
    index('support_tickets_status_idx').on(t.status),
    index('support_tickets_number_idx').on(t.ticketNumber),
    // "My feedback, newest first" (the panel) and the admin source filter.
    index('support_tickets_user_source_idx').on(
      t.userId,
      t.source,
      t.createdAt,
    ),
    index('support_tickets_source_idx').on(t.source),
  ],
);
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = typeof supportTickets.$inferInsert;

export const supportTicketComments = pgTable(
  'support_ticket_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    authorRole: supportActor('author_role').notNull(),
    body: text('body').notNull(),
    attachments: jsonb('attachments').$type<SupportAttachment[]>().default([]),
    // Admin-only note: never emailed, never shown to the customer.
    isInternal: boolean('is_internal').default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('support_ticket_comments_ticket_idx').on(t.ticketId, t.createdAt),
  ],
);
export type SupportTicketComment = typeof supportTicketComments.$inferSelect;
export type InsertSupportTicketComment =
  typeof supportTicketComments.$inferInsert;

export const supportTicketsRelations = relations(
  supportTickets,
  ({ one, many }) => ({
    user: one(users, {
      fields: [supportTickets.userId],
      references: [users.id],
    }),
    comments: many(supportTicketComments),
  }),
);

export const supportTicketCommentsRelations = relations(
  supportTicketComments,
  ({ one }) => ({
    ticket: one(supportTickets, {
      fields: [supportTicketComments.ticketId],
      references: [supportTickets.id],
    }),
    author: one(users, {
      fields: [supportTicketComments.authorUserId],
      references: [users.id],
    }),
  }),
);

/* ──────────────────────────────────────────────────────────────────────────
 * SIGNATURES (SIGKITT) — email-signature builder, migrated from the Manus
 * "email-signature-builder" export. Brand-scoped: every signature brand,
 * member, campaign, event and saved signature belongs to a Prodesk `brands`
 * row (the Manus single-shared-team tenancy is replaced by our brand context).
 * A Prodesk brand may own MANY signature brands (the Manus "collectionName"
 * grouping is kept as a column). Gated by the `email_signatures` feature key
 * and the `signatures` staff permission (manage-only — no viewer role).
 * ────────────────────────────────────────────────────────────────────────── */

export const signatureEventType = pgEnum('signature_event_type', [
  'banner_click',
  'cta_click',
  'verdiict_review_click',
  'verdiict_reviews_click',
  'social_click',
  'email_click',
  'phone_click',
  'website_click',
]);

export const signatureRotationMode = pgEnum('signature_rotation_mode', [
  'sequential',
  'random',
]);

// ─── Brand kits (the cross-frontend brand-design satellite of a brand) ───────
// (Formerly the signature-brands satellite.) This model is the generic brand kit used by the
// dashboard Brand Kit app, the Signatures frontend and the AI assistant — not
// just signatures. `brands` is the SINGLE SOURCE OF TRUTH for the overlapping
// fields website/address/logo and for the palette and fonts (the signature keeps
// its OWN `name` so it can't rename the tenant brand):
//   • brands.colors     — palette in token order [primary, accent, ink, background, rule]
//   • brands.typography — fonts in order [Heading, Body, Mono]
// so those columns were dropped here (see migration 00NN). This table holds only
// what has no `brands` home: the signature render config plus the structured
// brand-kit extras (voice, extra logo slots, cover version stamp).
export const brandKits = pgTable(
  'brand_kits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // The signature/brand-kit's OWN business name — kept separate from the tenant
    // brand's businessName so the signatures app can't rename the whole brand
    // (seeded from businessName on first provision, then edits independently).
    name: text('name').notNull(),
    collectionName: text('collection_name'),
    // ── Departments (migration 0087) ──────────────────────────────────────────
    // A brand now has MANY kits: one per signature "department" (Sales, Support,
    // Execs…). Each department is a complete, independently-editable signature
    // design that shares the brand's identity, members, campaigns and analytics.
    // Exactly one per brand is `isDefault` — that one IS the brand kit the rest
    // of the suite (AI, Logo Studio, Locker, dashboard Brand Kit) reads and
    // writes, so making departments 1:many stays invisible outside SIGKITT.
    departmentName: text('department_name'),
    // The department's URL segment: /team/<brand>/<slug>. PERSISTED, not derived
    // from the name — email signatures live in inboxes for years, so a rename
    // must never 404 links already out there. Unique per brand (migration 0089).
    slug: text('slug').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    // Per-department OVERRIDES of the identity/palette/font that otherwise come
    // from `brands`. NULL = inherit, which is what the default department always
    // does; only a department that deliberately diverges stores its own value.
    // See modules/signatures/brand-kit-view.ts (combine + split).
    website: text('website'),
    address: text('address'),
    logoUrl: text('logo_url'),
    logoKey: text('logo_key'),
    primaryColor: text('primary_color'),
    secondaryColor: text('secondary_color'),
    fontFamily: text('font_family'),
    // Signature campaign bar + powered-by (signature-specific; no brands equivalent).
    barColor: text('bar_color').default('#E07B39'),
    barTextColor: text('bar_text_color').default('#1A1A2E'),
    barLogoKey: text('bar_logo_key'),
    barLogoUrl: text('bar_logo_url'),
    brandDisplayName: text('brand_display_name'),
    brandTagline: text('brand_tagline'),
    // Primary logo lives on brands.logoUrl (single source). logoWidth is a
    // signature render setting; logoLinkUrl is the primary logo's click-through.
    logoWidth: integer('logo_width').default(120),
    logoLinkUrl: text('logo_link_url'),
    poweredByLogoKey: text('powered_by_logo_key'),
    poweredByLogoUrl: text('powered_by_logo_url'),
    poweredByLabel: text('powered_by_label').default('POWERED BY'),
    barLogoLinkUrl: text('bar_logo_link_url'),
    poweredByLinkUrl: text('powered_by_link_url'),
    verdiictUrl: text('verdiict_url'),
    verdiictReviewsUrl: text('verdiict_reviews_url'),
    // JSON map: "iconKey_hexcolour" → hosted PNG URL (pre-rendered social icons).
    renderedIconUrls: text('rendered_icon_urls'),
    disclaimer: text('disclaimer'),
    defaultTemplate: text('default_template').default('classic'),
    // Brand-kit voice — feeds every tool that writes copy + the AI assistant.
    voice: jsonb('voice').$type<{
      tone: string[];
      preferred: string[];
      banned: string[];
      readingLevel: string;
      examples: string[];
    }>(),
    // Extra brand-kit logo slots beyond the primary (which is brands.logoUrl):
    // Reversed, Mark / favicon, Lockup horizontal, Lockup stacked.
    logoSlots:
      jsonb('logo_slots').$type<
        { slot: string; url: string | null; key: string | null }[]
      >(),
    // Brand-kit cover version stamp.
    kitVersion: integer('kit_version').default(1),
    kitVersionDate: text('kit_version_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // MANY kits per Prodesk brand — one per signature department (migration 0087
  // dropped the old 1:1 `brand_kits_brand_unique`). The partial unique index
  // keeps exactly one DEFAULT kit per brand: that row is the brand kit the rest
  // of the suite resolves, so every non-signatures consumer stays 1:1.
  (t) => [
    index('brand_kits_brand_idx').on(t.brandId),
    uniqueIndex('brand_kits_brand_default_unique')
      .on(t.brandId)
      .where(sql`${t.isDefault}`),
    // Two brands may both own a "sales" department; one brand may not.
    uniqueIndex('brand_kits_brand_slug_unique').on(t.brandId, sql`lower(${t.slug})`),
  ],
);
export type BrandKit = typeof brandKits.$inferSelect;
export type InsertBrandKit = typeof brandKits.$inferInsert;

// ─── Signature members (people whose signatures are generated) ───────────────
export const signatureMembers = pgTable(
  'signature_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    signatureBrandId: uuid('signature_brand_id')
      .notNull()
      .references(() => brandKits.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    jobTitle: text('job_title'),
    department: text('department'),
    email: text('email'),
    phone: text('phone'),
    mobile: text('mobile'),
    photoKey: text('photo_key'),
    photoUrl: text('photo_url'),
    photoLinkUrl: text('photo_link_url'),
    linkedin: text('linkedin'),
    twitter: text('twitter'),
    instagram: text('instagram'),
    facebook: text('facebook'),
    youtube: text('youtube'),
    github: text('github'),
    spotify: text('spotify'),
    pinterest: text('pinterest'),
    tiktok: text('tiktok'),
    googleMaps: text('google_maps'),
    googleReviews: text('google_reviews'),
    trustpilot: text('trustpilot'),
    tripadvisor: text('tripadvisor'),
    uberEats: text('uber_eats'),
    deliveroo: text('deliveroo'),
    expedia: text('expedia'),
    rss: text('rss'),
    amazon: text('amazon'),
    websiteLink: text('website_link'),
    verdiictUrl: text('verdiict_url'),
    verdiictReviewsUrl: text('verdiict_reviews_url'),
    renderedIconUrls: text('rendered_icon_urls'),
    // A seat is billable/visible only once ACTIVE. Created inactive when it needs
    // payment (paywalled beyond the free seat); the Stripe webhook / on-file charge
    // flips it on (recordFeatureSubscription → pendingEnableMemberId). Mirrors
    // short_links.isActive. Existing rows backfill to true.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('signature_members_sig_brand_idx').on(t.signatureBrandId),
    index('signature_members_brand_idx').on(t.brandId),
  ],
);
export type SignatureMember = typeof signatureMembers.$inferSelect;
export type InsertSignatureMember = typeof signatureMembers.$inferInsert;

// ─── Signature campaigns (rotating promo banners in signatures) ──────────────
export const signatureCampaigns = pgTable(
  'signature_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    signatureBrandId: uuid('signature_brand_id')
      .notNull()
      .references(() => brandKits.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => signatureMembers.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    linkUrl: text('link_url'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').default(true).notNull(),
    rotationMode: signatureRotationMode('rotation_mode')
      .default('sequential')
      .notNull(),
    rotationCounter: integer('rotation_counter').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('signature_campaigns_sig_brand_idx').on(t.signatureBrandId)],
);
export type SignatureCampaign = typeof signatureCampaigns.$inferSelect;
export type InsertSignatureCampaign = typeof signatureCampaigns.$inferInsert;

// ─── Campaign banners (the rotated images) ───────────────────────────────────
export const signatureCampaignBanners = pgTable(
  'signature_campaign_banners',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => signatureCampaigns.id, { onDelete: 'cascade' }),
    imageKey: text('image_key').notNull(),
    imageUrl: text('image_url').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('signature_campaign_banners_campaign_idx').on(t.campaignId)],
);
export type SignatureCampaignBanner =
  typeof signatureCampaignBanners.$inferSelect;
export type InsertSignatureCampaignBanner =
  typeof signatureCampaignBanners.$inferInsert;

// ─── Analytics events (signature interaction tracking) ───────────────────────
export const signatureAnalyticsEvents = pgTable(
  'signature_analytics_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    signatureBrandId: uuid('signature_brand_id').references(
      () => brandKits.id,
      { onDelete: 'set null' },
    ),
    memberId: uuid('member_id').references(() => signatureMembers.id, {
      onDelete: 'set null',
    }),
    campaignId: uuid('campaign_id').references(() => signatureCampaigns.id, {
      onDelete: 'set null',
    }),
    eventType: signatureEventType('event_type').notNull(),
    label: text('label'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    referer: text('referer'),
    device: text('device'), // mobile | tablet | desktop | other
    browser: text('browser'),
    os: text('os'),
    country: text('country'), // ISO code from edge header or GeoIP
    isBot: boolean('is_bot').default(false).notNull(), // prefetch/crawler, excluded by default
    createdAt: createdAt(),
  },
  (t) => [
    index('signature_analytics_events_brand_idx').on(t.brandId),
    index('signature_analytics_events_sig_brand_idx').on(t.signatureBrandId),
  ],
);
export type SignatureAnalyticsEvent =
  typeof signatureAnalyticsEvents.$inferSelect;
export type InsertSignatureAnalyticsEvent =
  typeof signatureAnalyticsEvents.$inferInsert;

// ─── Saved signatures (a user's stored signature drafts) ─────────────────────
export const savedSignatures = pgTable(
  'saved_signatures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    // Serialised SignatureData JSON (the full builder state).
    data: text('data').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saved_signatures_brand_idx').on(t.brandId)],
);
export type SavedSignature = typeof savedSignatures.$inferSelect;
export type InsertSavedSignature = typeof savedSignatures.$inferInsert;

export const brandKitsRelations = relations(brandKits, ({ one, many }) => ({
  brand: one(brands, {
    fields: [brandKits.brandId],
    references: [brands.id],
  }),
  members: many(signatureMembers),
  campaigns: many(signatureCampaigns),
}));

export const signatureMembersRelations = relations(
  signatureMembers,
  ({ one }) => ({
    signatureBrand: one(brandKits, {
      fields: [signatureMembers.signatureBrandId],
      references: [brandKits.id],
    }),
  }),
);

export const signatureCampaignsRelations = relations(
  signatureCampaigns,
  ({ one, many }) => ({
    signatureBrand: one(brandKits, {
      fields: [signatureCampaigns.signatureBrandId],
      references: [brandKits.id],
    }),
    banners: many(signatureCampaignBanners),
  }),
);

export const signatureCampaignBannersRelations = relations(
  signatureCampaignBanners,
  ({ one }) => ({
    campaign: one(signatureCampaigns, {
      fields: [signatureCampaignBanners.campaignId],
      references: [signatureCampaigns.id],
    }),
  }),
);

/* ──────────────────────────────────────────────────────────────────────────
 * LOGO STUDIO  (clients/logo — the AI logo builder + brand-genesis engine)
 *
 * Brand identity itself lives on `brands` (logoUrl/logoUrls/colors/typography)
 * and `brand_kits.logoSlots` (variant lockups) — that stays the single source of
 * truth the whole suite inherits. These two tables hold only the *working state*
 * of a design session so it has history, versions, and an iteration lineage:
 *   • logo_projects    — one design effort per brand: the brief + status + the
 *                        chosen concept + optional locked style descriptors.
 *   • logo_generations — every generated concept/version: prompt, provider, the
 *                        editable SVG source, spec JSON, thumbnail, parent (for
 *                        conversational-iteration lineage), uniqueness score.
 * Migration 0075. See modules/logo/ + routers/logo.ts.
 * ────────────────────────────────────────────────────────────────────────── */

/** Personality is captured as four bipolar 0–4 dials (see modules/logo/types). */
export interface LogoBrief {
  businessName: string;
  tagline?: string;
  industry?: string;
  /** Free-text descriptor keywords the mark should evoke. */
  keywords: string[];
  /** Bipolar personality dials, each 0 (left pole) … 4 (right pole). */
  personality: {
    classicModern: number;
    seriousPlayful: number;
    minimalExpressive: number;
    geometricOrganic: number;
  };
  markType: 'monogram' | 'geometric' | 'combination' | 'wordmark' | 'surprise';
  /** The design thesis, surfaced as a setting: get the form right in ink first. */
  monochromeFirst: boolean;
  /** Optional colour leaning (a plain-language hint, not a committed palette). */
  colorLeaning?: string;
  /** Optional monogram initials override (defaults to the businessName initials). */
  initials?: string;
  /** Free-text conversation transcript when the brief was gathered conversationally. */
  notes?: string;
}

/** One palette entry emitted/edited on a concept (role-tagged, HEX). */
export interface LogoColor {
  role: string;
  name: string;
  hex: string;
}

/** Structured spec that travels with every generated concept. */
export interface LogoSpec {
  /** Ordered palette; index 0 is the primary/mark colour. */
  palette: LogoColor[];
  /** Font stacks (CSS font-family values from FONT_OPTIONS). */
  fonts: { heading: string; body: string; mono?: string };
  /** Short human description of the mark's geometry/construction. */
  geometry: string;
  /** Why this direction fits the brief — shown to the user. */
  rationale: string;
  /** IDs of the named, editable SVG groups (mark / wordmark / container). */
  elements: string[];
  /**
   * Editor adjustments (scale / stroke weight / gap / clearspace / hidden
   * elements / wordmark weight). Applied by the lockup builder, so a preview and
   * its export always agree. Absent on specs written before the editor gained
   * real controls — `resolveAdjust` in modules/logo/layout.ts supplies the no-op
   * default, and fills later-added fields in for specs written before them.
   */
  adjust?: {
    scale: number;
    strokeWidth: number | null;
    /** Multiplier on the mark↔wordmark gap. 1 = the designed spacing. */
    gap?: number;
    clearspace: number;
    hidden: string[];
    /** Weight the wordmark is cut at. null/absent = the typeface's own. */
    wordmarkWeight?: number | null;
  };
}

/**
 * One journalled inspector change on a generation.
 *
 * The editor's controls mutate a generation IN PLACE (they are refinements of one
 * mark, not new versions of it), so without a journal there is nothing for the
 * history strip to show and nothing for undo to step back through. Recording the
 * before/after of every field makes both real, and lets the AI copilot report
 * exactly what it changed when it drives the inspector on the user's behalf.
 */
export interface LogoEdit {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Who made it — the user's own control, or the studio copilot. */
  source: 'user' | 'agent';
  /** Human summary, e.g. "Mark scale 100% → 120%". */
  label: string;
  changes: { field: string; label: string; from: unknown; to: unknown }[];
  /** Stepped back past by undo; redo re-applies it. */
  undone?: boolean;
}

export const logoProjects = pgTable(
  'logo_projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    // brief → concepts → studio → system → complete
    status: text('status').notNull().default('brief'),
    brief: jsonb('brief').$type<LogoBrief>(),
    // The concept the user committed to (nullable until they pick). FK added in
    // migration 0075 after logo_generations exists (circular reference).
    chosenGenerationId: uuid('chosen_generation_id'),
    // Locked style descriptors so later assets stay visually consistent (P3).
    styleLock: jsonb('style_lock').$type<{
      descriptors: string[];
      palette?: LogoColor[];
      fonts?: { heading: string; body: string; mono?: string };
      lockedAt: string;
    } | null>(),
    // Explicit rights-assignment + human-input trail (P3 trust/IP layer).
    rightsAssignedAt: timestamp('rights_assigned_at', { withTimezone: true }),
    // Opaque secret for the PUBLIC guidelines page (migration 0076).
    // NULL = sharing disabled; rotating the value revokes every old link.
    shareToken: text('share_token'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('logo_projects_brand_idx').on(t.brandId)],
);
export type LogoProject = typeof logoProjects.$inferSelect;
export type InsertLogoProject = typeof logoProjects.$inferInsert;

export const logoGenerations = pgTable(
  'logo_generations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => logoProjects.id, { onDelete: 'cascade' }),
    // Denormalised for brand-scoped access checks without a project join.
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    // Iteration lineage: the generation this one was refined from (null = fresh).
    parentId: uuid('parent_id'),
    // Which provider adapter produced it ('claude' today; 'recraft' reserved).
    provider: text('provider').notNull().default('claude'),
    kind: text('kind').notNull().default('geometric'),
    name: text('name').notNull().default('Untitled mark'),
    note: text('note').default(''),
    // The editable SVG source — grouped, ID'd elements (mark/wordmark/container).
    svg: text('svg').notNull(),
    spec: jsonb('spec').$type<LogoSpec>(),
    // 0–100 distinctiveness score (P3 uniqueness/trust layer). Null = unscored.
    uniqueness: integer('uniqueness'),
    // Cached raster thumbnail (rendered from the SVG via sharp).
    thumbKey: text('thumb_key'),
    thumbUrl: text('thumb_url'),
    // User "saved / hearted" this concept on the contact sheet.
    saved: boolean('saved').notNull().default(false),
    // The instruction that produced this (brief summary or an iteration prompt).
    prompt: text('prompt').default(''),
    // Journal of inspector edits made to THIS mark (migration 0077). Drives the
    // version-history strip and undo/redo — see the LogoEdit doc comment.
    edits: jsonb('edits')
      .$type<LogoEdit[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('logo_generations_project_idx').on(t.projectId),
    index('logo_generations_brand_idx').on(t.brandId),
  ],
);
export type LogoGeneration = typeof logoGenerations.$inferSelect;
export type InsertLogoGeneration = typeof logoGenerations.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * OUTREACH (migration 0086)
 *
 * Our own outbound cold email, run through Smartlead across 4 domains × 5
 * mailboxes. Smartlead is the system of record for mailboxes, campaigns,
 * sequences, schedules, message bodies and deliverability — all read live and
 * cached in Redis, never mirrored. Only these four tables exist, and each earns
 * its place by one of: Smartlead has no field for it, it must be queried across
 * all campaigns at once, or losing it loses work.
 *
 * See docs/agents/outreach.md §5.
 * ────────────────────────────────────────────────────────────────────────── */

/** How a reply was read. `question` = interested but asked something first. */
export type OutreachClassification = 'yes' | 'question' | 'not_now' | 'never' | 'other';

/**
 * The `yes` → Verdiict account handoff. `existing` means an account was already
 * there and we resent the link rather than creating a second one.
 */
export type OutreachFulfilmentStatus = 'none' | 'pending' | 'created' | 'existing' | 'failed';

export const outreachProspectState = pgTable(
  'outreach_prospect_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Normalised: lowercased and trimmed. This is the prospect's identity. */
    email: text('email').notNull(),
    /**
     * Google's place id — the only stable identity Maps gives us, and the
     * cross-RUN dedupe key (migration 0093). Email is the identity for
     * *sending*; it is a poor identity for a *business*, because a practice that
     * changes from info@ to hello@ reads as brand new and gets emailed twice.
     * `placeId` doesn't move. Nullable: rows scraped before 0093, and anything
     * Outscraper returns without one, have none.
     */
    placeId: text('place_id'),
    businessName: text('business_name'),
    website: text('website'),
    /**
     * The scraped street address — what Smartlead is given as `location`, and
     * what `{{location}}` resolves to. Stored (migration 0106) because it was
     * being uploaded and then thrown away, which left the template preview with
     * nothing to render and a hardcoded blank in its place.
     */
    address: text('address'),
    /**
     * The scraped phone number (migration 0109). Stored for the same reason as
     * `address`: it is already uploaded to Smartlead's `phone_number` field and
     * was being dropped on the way, which left the one contact detail an email
     * address cannot substitute for readable only inside Smartlead. NULL on
     * anything pushed before 0109 — the candidate set it came from is gone.
     */
    phone: text('phone'),
    /** What Maps called the business. */
    category: text('category'),
    /**
     * Maps review count and star rating, both free in the Apify base item.
     * For a reviews product these two integers ARE the pitch — see
     * outreach-apify.md §5 — so they are stored rather than collapsed into a
     * personalisation string, which keeps them available for scoring and for
     * merge tags at the same time.
     */
    reviewsCount: integer('reviews_count'),
    rating: numeric('rating', { precision: 3, scale: 2 }),
    /**
     * The composed review-count opener — `{{hook}}`. Stored, not recomputed:
     * it compares this business against the median of the run that scraped it,
     * a number that exists nowhere else once the run is gone. Recomputing it
     * later would produce a different sentence from the one that was actually
     * sent, which would make the template preview a lie.
     */
    reviewHook: text('review_hook'),
    /** The campaign bucket WE chose — drives which campaign they're pushed into. */
    vertical: text('vertical'),
    // The one concrete detail the personalisation pass extracted. NULL is a
    // first-class value: a blocked or detail-less site keeps the contact, so
    // every template must degrade gracefully when this is missing.
    personalisationDetail: text('personalisation_detail'),
    source: text('source'),
    /** Which of the four sending domains was used — reply routing keys off it. */
    sendingDomain: text('sending_domain'),
    smartleadCampaignId: bigint('smartlead_campaign_id', { mode: 'number' }),
    /** Returned by the lead upload (settings.return_lead_ids); the thread fetch needs it. */
    smartleadLeadId: text('smartlead_lead_id'),
    classification: text('classification').$type<OutreachClassification>(),
    classificationReasoning: text('classification_reasoning'),
    classificationConfidence: numeric('classification_confidence', { precision: 4, scale: 3 }),
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
    // Human override, kept separate so a correction never destroys the model's
    // original call.
    manualClassification: text('manual_classification').$type<OutreachClassification>(),
    manualClassificationByUserId: uuid('manual_classification_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    manualClassificationAt: timestamp('manual_classification_at', { withTimezone: true }),
    fulfilmentStatus: text('fulfilment_status')
      .$type<OutreachFulfilmentStatus>()
      .notNull()
      .default('none'),
    fulfilmentAt: timestamp('fulfilment_at', { withTimezone: true }),
    /** The account is created against the address that REPLIED, not always the one we prospected. */
    fulfilmentEmail: text('fulfilment_email'),
    fulfilmentBrandId: uuid('fulfilment_brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    // Maintained from webhooks so the list can sort and filter on them without
    // fanning out across every campaign in Smartlead.
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('outreach_prospect_state_email_uq').on(t.email),
    // Partial: legacy rows and Outscraper rows have no place id, and NULLs are
    // distinct in a plain unique index anyway — being explicit documents that
    // "no place id" is a normal state, not a violation.
    uniqueIndex('outreach_prospect_state_place_id_uq')
      .on(t.placeId)
      .where(sql`${t.placeId} IS NOT NULL`),
    index('outreach_prospect_state_created_idx').on(t.createdAt.desc(), t.id.desc()),
    index('outreach_prospect_state_classification_idx').on(t.classification),
    index('outreach_prospect_state_vertical_idx').on(t.vertical),
    index('outreach_prospect_state_sending_domain_idx').on(t.sendingDomain),
    index('outreach_prospect_state_campaign_idx').on(t.smartleadCampaignId),
    // `source` is 'list-build:<run id>' for everything the List Builder pushed,
    // and a run's prospects are counted and deleted as a set — both scan on it.
    index('outreach_prospect_state_source_idx').on(t.source),
    check(
      'outreach_prospect_state_classification_ck',
      sql`${t.classification} IS NULL OR ${t.classification} IN ('yes', 'question', 'not_now', 'never', 'other')`,
    ),
    check(
      'outreach_prospect_state_manual_classification_ck',
      sql`${t.manualClassification} IS NULL OR ${t.manualClassification} IN ('yes', 'question', 'not_now', 'never', 'other')`,
    ),
    check(
      'outreach_prospect_state_fulfilment_ck',
      sql`${t.fulfilmentStatus} IN ('none', 'pending', 'created', 'existing', 'failed')`,
    ),
  ],
);
export type OutreachProspectState = typeof outreachProspectState.$inferSelect;
export type InsertOutreachProspectState = typeof outreachProspectState.$inferInsert;

/**
 * The plain body an operator typed, before the letter shell was wrapped around it.
 *
 * Smartlead holds the rendered HTML, which is what the prospect receives and
 * what the campaign screen reports on. It cannot hold the source, because the
 * render is one-way: reading a designed letter back out and calling it "the
 * body" would mean every save re-wrapped the previous save's markup.
 *
 * So the two live apart, deliberately — Smartlead owns what was sent, we own
 * what was written. A step with no row here is one written before migration
 * 0106, and the editor falls back to Smartlead's HTML for it.
 */
export const outreachSequenceSource = pgTable(
  'outreach_sequence_source',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
    /**
     * The step's position, not its Smartlead id: a step deleted and re-added
     * returns with a new id and the same position, and the position is what the
     * operator is editing.
     */
    seqNumber: integer('seq_number').notNull(),
    subject: text('subject').notNull().default(''),
    /** The small markup documented in modules/outreach/email-shell.ts. Never HTML. */
    body: text('body').notNull().default(''),
    /**
     * Days to wait before this step sends. NULL = saved before migration 0108,
     * so the editor falls back to whatever Smartlead reports; 0 is a real
     * answer, meaning the first touch goes out immediately.
     */
    delayInDays: integer('delay_in_days'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('outreach_sequence_source_step_idx').on(t.campaignId, t.seqNumber)],
);
export type OutreachSequenceSource = typeof outreachSequenceSource.$inferSelect;

export type OutreachReplyDraftStatus = 'pending' | 'approved' | 'edited' | 'sent' | 'discarded';

export const outreachReplyDrafts = pgTable(
  'outreach_reply_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    prospectId: uuid('prospect_id').references(() => outreachProspectState.id, {
      onDelete: 'set null',
    }),
    /** Denormalised so a draft stays readable if the prospect row is rebuilt. */
    email: text('email').notNull(),
    smartleadCampaignId: bigint('smartlead_campaign_id', { mode: 'number' }),
    /** The only identifier Smartlead's reply-email-thread actually requires. */
    smartleadEmailStatsId: text('smartlead_email_stats_id'),
    smartleadMessageId: text('smartlead_message_id'),
    /** What the model wrote, preserved verbatim even after a human edits it. */
    draftBody: text('draft_body').notNull(),
    /** What actually went out. NULL until sent. */
    sentBody: text('sent_body'),
    status: text('status').$type<OutreachReplyDraftStatus>().notNull().default('pending'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    discardedAt: timestamp('discarded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The queue reads "pending first, oldest first" — that ordering is the index.
    index('outreach_reply_drafts_status_idx').on(t.status, t.createdAt),
    index('outreach_reply_drafts_email_idx').on(t.email),
    check(
      'outreach_reply_drafts_status_ck',
      sql`${t.status} IN ('pending', 'approved', 'edited', 'sent', 'discarded')`,
    ),
  ],
);
export type OutreachReplyDraft = typeof outreachReplyDrafts.$inferSelect;
export type InsertOutreachReplyDraft = typeof outreachReplyDrafts.$inferInsert;

/**
 * The global suppression master across all 4 domains and 20 mailboxes. Written
 * here FIRST, then pushed to Smartlead — `pushedAt` is what tells the two apart,
 * because a row that never reached Smartlead is a row that can still be emailed.
 */
export const outreachSuppression = pgTable(
  'outreach_suppression',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** A normalised email address, or a bare domain. */
    value: text('value').notNull(),
    kind: text('kind').$type<'email' | 'domain'>().notNull(),
    reason: text('reason'),
    source: text('source'),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    pushError: text('push_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('outreach_suppression_value_uq').on(t.value),
    /** The sweep that retries un-pushed entries. */
    index('outreach_suppression_pushed_idx').on(t.pushedAt),
    check('outreach_suppression_kind_ck', sql`${t.kind} IN ('email', 'domain')`),
  ],
);
export type OutreachSuppression = typeof outreachSuppression.$inferSelect;
export type InsertOutreachSuppression = typeof outreachSuppression.$inferInsert;

/**
 * Webhook receipts only — for idempotency and replay, not reporting.
 *
 * Smartlead's payloads carry no unique event id and no signature, so
 * `idempotencyKey` is SYNTHETIC: a hash of event type + campaign + recipient +
 * event timestamp. `smartleadEventId` stays nullable in case they ever send one.
 */
export const outreachEvents = pgTable(
  'outreach_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    smartleadEventId: text('smartlead_event_id'),
    eventType: text('event_type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processError: text('process_error'),
    /**
     * How many times the reconcile sweep has tried to apply this event.
     *
     * The sweep gives up after `MAX_PROCESS_ATTEMPTS` (webhook.ts). Without a
     * bound it replayed every never-succeeding receipt every fifteen minutes
     * forever — and an EMAIL_REPLY replay is an LLM call, so one poisoned row
     * billed a classification four times an hour indefinitely.
     */
    processAttempts: integer('process_attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('outreach_events_idempotency_key_uq').on(t.idempotencyKey),
    /** Drives both the retention trim and the reconcile cron. */
    index('outreach_events_received_idx').on(t.receivedAt),
    index('outreach_events_unprocessed_idx')
      .on(t.processedAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);
export type OutreachEvent = typeof outreachEvents.$inferSelect;
export type InsertOutreachEvent = typeof outreachEvents.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * OUTREACH LIST RUNS (migration 0093)
 *
 * The deliberate FIFTH table. §5 fixes the model at four on the criteria
 * "Smartlead has no field for it", "must be queried across all campaigns", or
 * "losing it loses work". A scrape ledger meets the third one twice over:
 * losing it means re-PAYING Apify for a region we already bought, and — worse —
 * re-emailing people we already contacted.
 *
 * It does two jobs beyond bookkeeping:
 *
 *  1. **Crash safety.** Apify has no idempotency key on run start, so a Worker
 *     that dies between `startRun` and persisting the run id would pay for the
 *     whole scrape a second time on retry. The row is written as `starting`
 *     BEFORE Apify is called, which is what makes the orphan-adoption path in
 *     list-builder/ledger.ts possible at all.
 *  2. **The coverage map.** Greater Sydney is a depleting resource — roughly
 *     45–60k listings across our verticals, ~6–9 months at the planned volume.
 *     Which (vertical × region) pairs are already spent is the number that
 *     tells the operator when to open Melbourne, so it's a visible surface,
 *     not an implementation detail.
 *
 * See docs/agents/outreach-apify.md §7 and §8.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * `starting` exists solely to be crash-visible: a row in this state means we may
 * have paid for a run whose id we never recorded. `superseded` is how a
 * deliberate monthly top-up gets past the one-run-per-region rule without
 * weakening it for everyone else.
 */
export type OutreachListRunStatus =
  | 'starting'
  | 'running'
  | 'review'
  | 'pushing'
  | 'done'
  | 'failed'
  | 'superseded';

export const outreachListRuns = pgTable(
  'outreach_list_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    /** Pinned per row: changing APIFY_MAPS_ACTOR_ID must not rewrite history. */
    actorId: text('actor_id'),
    /**
     * The search term, normalised (lowercased, whitespace-collapsed) because it
     * is half of the uniqueness key.
     *
     * This IS the string handed to the actor — there is no separate
     * `search_term`, deliberately. A uniqueness rule that guards a label rather
     * than the query pays twice the moment two labels resolve to one search.
     * See regions.ts.
     */
    vertical: text('vertical').notNull(),
    /**
     * An LGA or a whole metro, normalised. NEVER a suburb — see
     * outreach-apify.md §2. Half of the uniqueness key, so it is lowercased and
     * whitespace-collapsed; `regionLabel` carries the readable form.
     */
    regionKey: text('region_key').notNull(),
    /** What the operator picked, as they'd recognise it. Display only. */
    regionLabel: text('region_label'),
    /** ISO 3166-1 alpha-2. Part of the actor input, so it lives on the row. */
    countryCode: text('country_code').notNull().default('au'),
    /**
     * Google's id for the region. A stronger identity than the name: two
     * spellings of one council resolve to one id, and a name can't be relied on
     * not to drift.
     *
     * Nullable only for the rows that predate region search, and for the e2e
     * script, which drives `createRun` directly. Every run the UI starts has
     * one — the curated-dropdown path it was optional for is gone.
     */
    placeId: text('place_id'),
    /**
     * The region's boundary as simplified GeoJSON — the area actually scraped.
     *
     * Stored rather than re-fetched, and that is a correctness requirement
     * rather than a cache. `input_hash` is derived from the actor input, and
     * orphan adoption rebuilds it from this row; OSM boundaries are edited
     * continuously, so a re-fetch could return a different polygon, produce a
     * different hash, fail to match a run we already started, and buy the same
     * scrape twice.
     *
     * Null on rows written before boundaries were stored. Those fall back to
     * the region-name path in apify.ts, so their hash still reproduces exactly.
     */
    regionBoundary: jsonb('region_boundary').$type<GeoJsonArea>(),
    /** Hash of the actor input, so an orphan run can be matched on resume. */
    inputHash: text('input_hash').notNull(),
    /** The provider's ids. Null until the run has actually been started. */
    runId: text('run_id'),
    datasetId: text('dataset_id'),
    status: text('status').$type<OutreachListRunStatus>().notNull().default('starting'),
    /** Fine-grained progress within `status` — what the stage rail renders. */
    stage: text('stage').notNull().default('starting'),
    maxRecords: integer('max_records').notNull(),
    /** Whether the optional Haiku homepage crawl ran (§5: off by default). */
    personalise: boolean('personalise').notNull().default(false),
    campaignId: bigint('campaign_id', { mode: 'number' }),
    sendingDomain: text('sending_domain'),
    /** found / noEmail / duplicate / suppressed / unverified / hooked / pushed. */
    counts: jsonb('counts').notNull().default(sql`'{}'::jsonb`),
    /** Shown before the run starts: cap × $3.00/1k. An upper bound. */
    costEstimateUsd: numeric('cost_estimate_usd', { precision: 10, scale: 4 }),
    /** What the provider actually billed, read back off the finished run. */
    costActualUsd: numeric('cost_actual_usd', { precision: 10, scale: 4 }),
    error: text('error'),
    /**
     * When this run pushes itself, if nobody intervenes.
     *
     * Stamped five minutes ahead the moment the run reaches `review`. The review
     * stop is a HOLD, not a gate: by then the contacts are scraped, paid for,
     * deduped and verified, and the only decision left is one that was always
     * being answered yes.
     *
     * NULL means held — an operator skipped the run, or the row predates the
     * column. A NULL never auto-pushes, which is the safe direction for a field
     * whose other value ends in email reaching strangers.
     */
    autoPushAt: timestamp('auto_push_at', { withTimezone: true }),
    /**
     * This run's place in the SEND queue.
     *
     * Scraping is parallel — several regions can be billing at once. Sending is
     * not: every run lands in the same one campaign, so which region's contacts
     * start receiving email first is a real decision, and this column is where
     * that decision is written down.
     *
     * The order is STRICT. A run may only push when nothing ahead of it is
     * still unsent, including runs that are merely still scraping — otherwise
     * "first" would mean "whichever finished scraping first", which is the thing
     * this replaces. `skippedAt` is the escape hatch that makes strictness
     * liveable.
     *
     * It spans every run, sent and unsent alike, so a finished run keeps the
     * position it sent in and the list reads as a history as well as a plan.
     */
    queuePosition: integer('queue_position').notNull().default(0),
    /**
     * Parked out of the send queue: passed over, and — the point — not blocking
     * the runs behind it.
     *
     * Distinct from a failed or superseded run, which is out of the queue
     * because it is finished with. A skipped run is a run someone will probably
     * come back to; it keeps its position, so unskipping restores it to exactly
     * where it was rather than to the end.
     *
     * Skipping also stops the run's own auto-push countdown, because a run that
     * the queue is passing over must not push itself the moment it reaches the
     * front.
     */
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * Rule 1 of the cost model — never scrape the same (vertical, region) twice —
     * enforced by the database rather than by discipline, because the only way to
     * genuinely waste money here is to forget that you already ran it.
     *
     * Partial on purpose. A `failed` run bought nothing worth keeping, so
     * retrying it must not require ceremony; and a `superseded` row is one an
     * operator explicitly retired to run the ~1–2%/month top-up §8 calls for.
     * Everything else — including a run still `starting` — blocks a repeat.
     */
    uniqueIndex('outreach_list_runs_vertical_region_uq')
      .on(t.vertical, t.regionKey)
      .where(sql`${t.status} NOT IN ('failed', 'superseded')`),
    /**
     * The same rule, keyed on Google's id instead of our string. Catches the
     * case the name index can't: one council, two spellings, two bills.
     */
    uniqueIndex('outreach_list_runs_vertical_place_uq')
      .on(t.vertical, t.placeId)
      .where(sql`${t.placeId} IS NOT NULL AND ${t.status} NOT IN ('failed', 'superseded')`),
    /** One ledger row per provider run, so adoption can't bind the same run twice. */
    uniqueIndex('outreach_list_runs_run_id_uq')
      .on(t.runId)
      .where(sql`${t.runId} IS NOT NULL`),
    index('outreach_list_runs_status_idx').on(t.status),
    index('outreach_list_runs_created_idx').on(t.createdAt.desc(), t.id.desc()),
    check(
      'outreach_list_runs_status_ck',
      sql`${t.status} IN ('starting', 'running', 'review', 'pushing', 'done', 'failed', 'superseded')`,
    ),
  ],
);
export type OutreachListRun = typeof outreachListRuns.$inferSelect;
export type InsertOutreachListRun = typeof outreachListRuns.$inferInsert;

/**
 * The gazetteer — what is inside what, discovered from OpenStreetMap.
 *
 * There used to be a hand-written list of 38 region names in regions.ts doing
 * this job. It matched on strings, so a whole-metro run left the 33 councils it
 * had just paid for looking unscraped; its names disagreed with the ones region
 * search actually returns; and it asserted a "Greater Sydney" containing three
 * councils that OSM's Sydney polygon does not. Migration 0104 has the full
 * account.
 *
 * Rows arrive one of two ways: as a PARENT, written when a run is started for
 * a region, or as a CHILD, written when that parent's contents are enumerated.
 * Both are keyed on the OSM object id, which is also `outreach_list_runs.
 * place_id` — so a child cell finds its own run, if it has one, by id.
 *
 * Deliberately not scoped to a vertical. "These 30 councils are inside Sydney"
 * is a fact about the world; one vertical pays the Overpass round trip and
 * every vertical reads the answer.
 */
export const outreachRegions = pgTable(
  'outreach_regions',
  {
    /** "R1251053" — osm_type initial + osm_id. Nominatim's own id is not stable. */
    osmId: text('osm_id').primaryKey(),
    label: text('label').notNull(),
    countryCode: text('country_code').notNull().default('au'),
    /**
     * OSM's hierarchy depth, when it has one. Null is normal and meaningful:
     * "Sydney" is `place=city` with no admin_level, because Australia has no
     * metropolitan tier between state (4) and council (6).
     */
    adminLevel: integer('admin_level'),
    /**
     * A point guaranteed to be INSIDE this region — see `interiorPointOf`. Not
     * a centroid: on this coastline a centroid lands in the harbour often
     * enough to drop real councils from their own parent.
     */
    point: jsonb('point').$type<[number, number]>().notNull(),
    /** Where we found it. A breadcrumb — containment is recomputed, not read. */
    parentOsmId: text('parent_osm_id'),
    /** The level the children came back at, once we know it. */
    childrenAdminLevel: integer('children_admin_level'),
    /** Null = never asked. Set even on failure, so a retry is a decision. */
    childrenFetchedAt: timestamp('children_fetched_at', { withTimezone: true }),
    /** Why the enumeration failed, so an empty grid can say which empty it is. */
    childrenError: text('children_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('outreach_regions_parent_idx').on(t.parentOsmId),
    index('outreach_regions_fetched_idx')
      .on(t.childrenFetchedAt)
      .where(sql`${t.childrenFetchedAt} IS NOT NULL`),
  ],
);
export type OutreachRegion = typeof outreachRegions.$inferSelect;
