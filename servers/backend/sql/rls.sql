-- Prodesk — Row-Level Security & Realtime
-- Apply AFTER `npm run db:push` (drizzle does not manage policies):
--   psql "$DIRECT_URL" -f server/sql/rls.sql
--   (or paste into the Supabase SQL editor)
--
-- Rationale: the tRPC server uses the service-role key and BYPASSES RLS, so
-- these policies only constrain what the *browser* Supabase client can read —
-- which today is Realtime (chat) and Storage. Everything else goes through tRPC.

-- ── Chat realtime: a user may read threads/messages they're a member of ──────
alter table chat_threads        enable row level security;
alter table chat_thread_members enable row level security;
alter table chat_messages       enable row level security;

drop policy if exists chat_members_self on chat_thread_members;
create policy chat_members_self on chat_thread_members
  for select using (user_id = auth.uid());

drop policy if exists chat_threads_member on chat_threads;
create policy chat_threads_member on chat_threads
  for select using (
    exists (select 1 from chat_thread_members m where m.thread_id = chat_threads.id and m.user_id = auth.uid())
  );

drop policy if exists chat_messages_member on chat_messages;
create policy chat_messages_member on chat_messages
  for select using (
    exists (select 1 from chat_thread_members m where m.thread_id = chat_messages.thread_id and m.user_id = auth.uid())
  );

-- Writes still go through tRPC (service role), so no INSERT/UPDATE policies here.

-- The unread badge (FloatingMessagePanel) subscribes to UPDATEs of
-- chat_thread_members.unread_count. Realtime needs FULL replica identity to
-- evaluate the RLS policy on UPDATE/DELETE rows — the default ships only the PK,
-- so the policy can't run and the event is dropped (badge never updates live).
alter table chat_thread_members replica identity full;

-- chat_messages/chat_threads need FULL replica identity too. With the default
-- (PK-only) identity, a logical-decoding UPDATE omits unchanged TOASTed columns
-- from its payload — so an UPDATE that only touches a small column (e.g. attaching
-- a confirm card's pending_actions) ships the large `content` as absent, and
-- Realtime delivers content=null. Clients that merge that echo would blank an
-- already-rendered AI bubble until the next refetch. FULL identity always carries
-- the complete row, so the echo can't drop content.
alter table chat_messages replica identity full;
alter table chat_threads replica identity full;

-- ── Consumer messenger reactions (chat.prodesk.com) ─────────────────────────
-- Same membership rule as messages: you can read reactions in threads you're in.
-- The policy joins through thread_id, which is denormalised onto the row for
-- exactly this reason — and for the browser's per-thread realtime filter.
alter table chat_message_reactions enable row level security;

drop policy if exists chat_reactions_member on chat_message_reactions;
create policy chat_reactions_member on chat_message_reactions
  for select using (
    exists (
      select 1 from chat_thread_members m
      where m.thread_id = chat_message_reactions.thread_id and m.user_id = auth.uid()
    )
  );

-- FULL replica identity is REQUIRED here, not merely advisable. Un-reacting is a
-- DELETE, and under the default PK-only identity the payload carries only
-- (message_id, user_id, emoji) — no thread_id — so the policy above cannot be
-- evaluated and Realtime silently drops the event. The reaction would then vanish
-- for the person who removed it and stay on screen for everyone else.
alter table chat_message_reactions replica identity full;

-- ── Enable Realtime replication for live chat delivery ───────────────────────
-- (Publication membership for chat + all app tables is added idempotently in the
-- consolidated block at the bottom of this file, so this whole file is safe to
-- re-run on every server boot.)

-- ════════════════════════════════════════════════════════════════════════════
-- App data realtime: live updates for boards/lists (tasks, connections, staff,
-- catalog, marketplace). Writes still go through tRPC (service role, bypasses
-- RLS); these SELECT policies only gate what the BROWSER realtime client may
-- receive, scoped so a user only sees rows for orgs they belong to.
-- ════════════════════════════════════════════════════════════════════════════

-- Membership helpers run as SECURITY DEFINER so they bypass RLS on the tables
-- they read — this both avoids policy recursion (staff referencing staff) and
-- keeps the policies fast/simple. `auth.uid()` == users.id in this app.
create or replace function app_is_agency_member(a uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select a is not null and (
    exists (select 1 from agencies ag where ag.id = a and ag.owner_id = auth.uid())
    or exists (select 1 from staff s where s.agency_id = a and s.user_id = auth.uid())
  );
$$;

create or replace function app_is_brand_member(b uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select b is not null and (
    exists (select 1 from brands br where br.id = b and br.owner_id = auth.uid())
    or exists (select 1 from staff s where s.brand_id = b and s.user_id = auth.uid())
  );
$$;

-- Tasks: gates which task rows the browser realtime client may receive. Kept
-- deliberately broad (assignee OR shared-with) — the rendered boards are
-- tRPC-filtered (personal board is assignee-only; team pane uses a broadcast
-- ping), so this only drives query invalidation and never leaks a row into a UI.
alter table tasks enable row level security;
drop policy if exists tasks_visible on tasks;
create policy tasks_visible on tasks
  for select using (assignee_id = auth.uid() or visible_to @> array[auth.uid()]::uuid[]);

-- Agency↔contractor connections: the contractor, or any member of the agency.
alter table agency_contractor_connections enable row level security;
drop policy if exists acc_visible on agency_contractor_connections;
create policy acc_visible on agency_contractor_connections
  for select using (contractor_id = auth.uid() or app_is_agency_member(agency_id));

-- Brand↔agency connections + requests: members of either side.
alter table brand_agency_connections enable row level security;
drop policy if exists bac_visible on brand_agency_connections;
create policy bac_visible on brand_agency_connections
  for select using (app_is_agency_member(agency_id) or app_is_brand_member(brand_id));

alter table brand_agency_connection_requests enable row level security;
drop policy if exists bacr_visible on brand_agency_connection_requests;
create policy bacr_visible on brand_agency_connection_requests
  for select using (app_is_agency_member(agency_id) or app_is_brand_member(brand_id));

-- Staff: your own row, or a row in an org you belong to.
alter table staff enable row level security;
drop policy if exists staff_visible on staff;
create policy staff_visible on staff
  for select using (user_id = auth.uid() or app_is_agency_member(agency_id) or app_is_brand_member(brand_id));

-- Services (agency catalog): members of the owning agency.
alter table services enable row level security;
drop policy if exists services_visible on services;
create policy services_visible on services
  for select using (app_is_agency_member(agency_id));

-- Proposals + purchases (marketplace pipeline): members of either side.
alter table proposals enable row level security;
drop policy if exists proposals_visible on proposals;
create policy proposals_visible on proposals
  for select using (app_is_agency_member(agency_id) or app_is_brand_member(brand_id));

alter table purchases enable row level security;
drop policy if exists purchases_visible on purchases;
create policy purchases_visible on purchases
  for select using (user_id = auth.uid() or app_is_brand_member(brand_id));

-- DELETE events ship only the primary key under the default replica identity, so
-- an RLS policy referencing other columns (agency_id, visible_to, …) can't be
-- evaluated and the event is dropped — meaning deletions (cancelled invites,
-- accepted+removed requests, cleared tasks) wouldn't disappear live. FULL ships
-- the whole old row so the policy can run on DELETE too.
alter table tasks                            replica identity full;
alter table agency_contractor_connections    replica identity full;
alter table brand_agency_connections         replica identity full;
alter table brand_agency_connection_requests replica identity full;
alter table staff                            replica identity full;
alter table services                         replica identity full;
alter table proposals                        replica identity full;
alter table purchases                        replica identity full;

-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2 — collaborative domains: projects (+ deliverables/revisions/notes),
-- proposal children (items/phases/comments/documents), catalog packages, info
-- hub (SPOT), resources, meetings, brand documents, discipline requests.
-- (Financial ledgers — invoices/payouts/breakdowns — are intentionally NOT
-- realtime: not multi-user-live and their visibility is intricate.)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app_is_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.is_super_admin);
$$;

-- Parent-visibility helpers (SECURITY DEFINER → bypass child→parent RLS, no recursion).
create or replace function app_can_see_project(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p where p.id = pid and (
      app_is_agency_member(p.agency_id) or app_is_brand_member(p.brand_id)
      or p.production_assignee_id = auth.uid()
    )
  );
$$;

create or replace function app_can_see_proposal(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from proposals p where p.id = pid and (
      app_is_agency_member(p.agency_id) or app_is_brand_member(p.brand_id)
    )
  );
$$;

-- Projects: agency members, brand members, or the assigned contractor.
alter table projects enable row level security;
drop policy if exists projects_visible on projects;
create policy projects_visible on projects
  for select using (
    app_is_agency_member(agency_id) or app_is_brand_member(brand_id) or production_assignee_id = auth.uid()
  );

alter table project_deliverables enable row level security;
drop policy if exists project_deliverables_visible on project_deliverables;
create policy project_deliverables_visible on project_deliverables for select using (app_can_see_project(project_id));

alter table project_revisions enable row level security;
drop policy if exists project_revisions_visible on project_revisions;
create policy project_revisions_visible on project_revisions for select using (app_can_see_project(project_id));

alter table project_notes enable row level security;
drop policy if exists project_notes_visible on project_notes;
create policy project_notes_visible on project_notes for select using (app_can_see_project(project_id));

-- Proposal children: anyone who can see the parent proposal.
alter table proposal_items enable row level security;
drop policy if exists proposal_items_visible on proposal_items;
create policy proposal_items_visible on proposal_items for select using (app_can_see_proposal(proposal_id));

alter table proposal_phases enable row level security;
drop policy if exists proposal_phases_visible on proposal_phases;
create policy proposal_phases_visible on proposal_phases for select using (app_can_see_proposal(proposal_id));

alter table proposal_comments enable row level security;
drop policy if exists proposal_comments_visible on proposal_comments;
create policy proposal_comments_visible on proposal_comments for select using (app_can_see_proposal(proposal_id));

alter table proposal_documents enable row level security;
drop policy if exists proposal_documents_visible on proposal_documents;
create policy proposal_documents_visible on proposal_documents for select using (app_can_see_proposal(proposal_id));

-- Catalog packages: owning agency members (brand-side marketplace browsing of
-- packages stays non-live for the same fan-out reason as services).
alter table packages enable row level security;
drop policy if exists packages_visible on packages;
create policy packages_visible on packages for select using (app_is_agency_member(agency_id));

-- Info Hub / SPOT: the owning brand + the managing agency.
alter table spot_forms enable row level security;
drop policy if exists spot_forms_visible on spot_forms;
create policy spot_forms_visible on spot_forms
  for select using (app_is_agency_member(agency_id) or app_is_brand_member(brand_id));

alter table spot_components enable row level security;
drop policy if exists spot_components_visible on spot_components;
create policy spot_components_visible on spot_components
  for select using (app_is_brand_member(brand_id) or app_is_agency_member(agency_id) or is_public);

-- Resources: agency members; admin resources (null agency) are shared.
alter table resources enable row level security;
drop policy if exists resources_visible on resources;
create policy resources_visible on resources
  for select using (agency_id is null or app_is_agency_member(agency_id));

-- Meetings: either org's members, or the two participants.
alter table meetings enable row level security;
drop policy if exists meetings_visible on meetings;
create policy meetings_visible on meetings
  for select using (
    app_is_agency_member(agency_id) or app_is_brand_member(brand_id)
    or assignee_user_id = auth.uid() or brand_user_id = auth.uid()
  );

-- Brand documents (folders + files): the owning brand + the managing agency.
alter table folders enable row level security;
drop policy if exists folders_visible on folders;
create policy folders_visible on folders
  for select using (app_is_brand_member(brand_id) or app_is_agency_member(agency_id));

alter table files enable row level security;
drop policy if exists files_visible on files;
create policy files_visible on files
  for select using (app_is_brand_member(brand_id) or app_is_agency_member(agency_id));

-- Discipline requests: the requesting agency + super-admins (who action them).
alter table discipline_requests enable row level security;
drop policy if exists discipline_requests_visible on discipline_requests;
create policy discipline_requests_visible on discipline_requests
  for select using (app_is_agency_member(agency_id) or app_is_super_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- Dashboard (brand workspace) realtime: the Prodesk Suite dashboard is brand-only
-- and reads brands, feature_subscriptions and the signed-in user's own row.
-- These weren't realtime before (only the agency-side boards were), so
-- the dashboard's lists/stats only refreshed on the 30 s staleness window. Gate
-- delivery to the rows a brand member (or, for the user row, the user) may see.
-- ════════════════════════════════════════════════════════════════════════════

-- Brands: members of the brand (owner or brand staff). Agencies read brand
-- records through tRPC (service role); the brand↔agency link itself is its own
-- realtime table (brand_agency_connections), so no agency clause is needed here.
alter table brands enable row level security;
drop policy if exists brands_visible on brands;
create policy brands_visible on brands
  for select using (app_is_brand_member(id));

-- Feature subscriptions: the owner of record (entitlement is owner-scoped), plus
-- brand members of the brand it was bought for (so staff see live billing state).
alter table feature_subscriptions enable row level security;
drop policy if exists feature_subscriptions_visible on feature_subscriptions;
create policy feature_subscriptions_visible on feature_subscriptions
  for select using (user_id = auth.uid() or app_is_brand_member(created_for_brand_id));

-- Users: a user may receive realtime only for their OWN row (account settings:
-- profile + notification preferences). Never exposes other users' rows.
alter table users enable row level security;
drop policy if exists users_self_visible on users;
create policy users_self_visible on users
  for select using (id = auth.uid());

-- Short links (Links & QR): brand members. Links and click events are both
-- brand-scoped, so the whole links workspace goes live for the brand's team.
alter table short_links enable row level security;
drop policy if exists short_links_visible on short_links;
create policy short_links_visible on short_links
  for select using (app_is_brand_member(brand_id));

alter table link_events enable row level security;
drop policy if exists link_events_visible on link_events;
create policy link_events_visible on link_events
  for select using (app_is_brand_member(brand_id));

-- Campaign destination windows have no brand_id of their own — they inherit
-- visibility from the campaign link they belong to.
alter table link_destination_windows enable row level security;
drop policy if exists link_destination_windows_visible on link_destination_windows;
create policy link_destination_windows_visible on link_destination_windows
  for select using (
    exists (
      select 1 from short_links l
       where l.id = link_destination_windows.link_id
         and app_is_brand_member(l.brand_id)
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- Reviews (Verdiict): the whole workspace is brand-scoped, so brand members get
-- live locations / reviews / requests / embeds / rewards / billing. Super-admins
-- additionally receive brand-agnostic events so the Admin Portal stays live.
-- review_embed_views is intentionally NOT realtime: write-only analytics, no
-- client query reads it. Public directory/capture pages are anonymous and stay
-- request/response (an anon realtime socket would be dropped by these policies).
-- ════════════════════════════════════════════════════════════════════════════

-- Child→parent visibility helpers (SECURITY DEFINER → bypass RLS, no recursion).
create or replace function app_can_see_review_location(lid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from review_locations l where l.id = lid
      and (app_is_brand_member(l.brand_id) or app_is_super_admin())
  );
$$;

create or replace function app_can_see_review_collection(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from review_embed_collections c where c.id = cid
      and app_is_brand_member(c.brand_id)
  );
$$;

-- Locations (the review-capture pages) + their per-location children.
alter table review_locations enable row level security;
drop policy if exists review_locations_visible on review_locations;
create policy review_locations_visible on review_locations
  for select using (app_is_brand_member(brand_id) or app_is_super_admin());

alter table review_platforms enable row level security;
drop policy if exists review_platforms_visible on review_platforms;
create policy review_platforms_visible on review_platforms
  for select using (app_can_see_review_location(location_id));

alter table review_win_tags enable row level security;
drop policy if exists review_win_tags_visible on review_win_tags;
create policy review_win_tags_visible on review_win_tags
  for select using (app_can_see_review_location(location_id));

-- Captured reviews / private feedback (also drives the trial entitlement).
alter table review_submissions enable row level security;
drop policy if exists review_submissions_visible on review_submissions;
create policy review_submissions_visible on review_submissions
  for select using (app_can_see_review_location(location_id));

-- Manual outreach requests.
alter table review_requests enable row level security;
drop policy if exists review_requests_visible on review_requests;
create policy review_requests_visible on review_requests
  for select using (app_is_brand_member(brand_id));

-- Embed configs (per location) + account-wide collections.
alter table review_embed_configs enable row level security;
drop policy if exists review_embed_configs_visible on review_embed_configs;
create policy review_embed_configs_visible on review_embed_configs
  for select using (app_can_see_review_location(location_id));

alter table review_embed_collections enable row level security;
drop policy if exists review_embed_collections_visible on review_embed_collections;
create policy review_embed_collections_visible on review_embed_collections
  for select using (app_is_brand_member(brand_id));

alter table review_embed_collection_locations enable row level security;
drop policy if exists review_embed_col_loc_visible on review_embed_collection_locations;
create policy review_embed_col_loc_visible on review_embed_collection_locations
  for select using (app_can_see_review_collection(collection_id));

-- Milestone rewards: the brand, plus super-admins (who mark them shipped).
alter table review_milestone_rewards enable row level security;
drop policy if exists review_milestone_rewards_visible on review_milestone_rewards;
create policy review_milestone_rewards_visible on review_milestone_rewards
  for select using (app_is_brand_member(brand_id) or app_is_super_admin());

-- Industries + tag presets: global catalogues (already public data via the
-- directory), readable by any signed-in user.
alter table review_industries enable row level security;
drop policy if exists review_industries_visible on review_industries;
create policy review_industries_visible on review_industries
  for select to authenticated using (true);

alter table review_tag_presets enable row level security;
drop policy if exists review_tag_presets_visible on review_tag_presets;
create policy review_tag_presets_visible on review_tag_presets
  for select to authenticated using (true);

-- Admin audit trail: super-admins only.
alter table review_admin_audit enable row level security;
drop policy if exists review_admin_audit_visible on review_admin_audit;
create policy review_admin_audit_visible on review_admin_audit
  for select using (app_is_super_admin());

-- Public directory profile: the owning brand's members (the public directory
-- itself is anonymous and reads through tRPC, not realtime).
alter table review_directory_profiles enable row level security;
drop policy if exists review_directory_profiles_visible on review_directory_profiles;
create policy review_directory_profiles_visible on review_directory_profiles
  for select using (app_is_brand_member(brand_id));

-- The two halves of the public directory URL. Same rule: the owning brand's
-- members. Anonymous visitors resolve these through tRPC / the badge routes,
-- which run with the service role, never through realtime.
alter table review_directory_brands enable row level security;
drop policy if exists review_directory_brands_visible on review_directory_brands;
create policy review_directory_brands_visible on review_directory_brands
  for select using (app_is_brand_member(brand_id));

alter table review_directory_slug_aliases enable row level security;
drop policy if exists review_directory_slug_aliases_visible on review_directory_slug_aliases;
create policy review_directory_slug_aliases_visible on review_directory_slug_aliases
  for select using (app_is_brand_member(brand_id));

-- Referral codes: the owner; redemptions: the redeemer or the code's owner.
alter table review_referral_codes enable row level security;
drop policy if exists review_referral_codes_visible on review_referral_codes;
create policy review_referral_codes_visible on review_referral_codes
  for select using (owner_user_id = auth.uid());

alter table review_referral_redemptions enable row level security;
drop policy if exists review_referral_redemptions_visible on review_referral_redemptions;
create policy review_referral_redemptions_visible on review_referral_redemptions
  for select using (
    redeemed_by_user_id = auth.uid()
    or exists (
      select 1 from review_referral_codes c
      where c.code = review_referral_redemptions.code and c.owner_user_id = auth.uid()
    )
  );

alter table projects             replica identity full;
alter table project_deliverables replica identity full;
alter table project_revisions    replica identity full;
alter table project_notes        replica identity full;
alter table proposal_items       replica identity full;
alter table proposal_phases      replica identity full;
alter table proposal_comments    replica identity full;
alter table proposal_documents   replica identity full;
alter table packages             replica identity full;
alter table spot_forms           replica identity full;
alter table spot_components      replica identity full;
alter table resources            replica identity full;
alter table meetings             replica identity full;
alter table folders              replica identity full;
alter table files                replica identity full;
alter table discipline_requests  replica identity full;
alter table brands               replica identity full;
alter table feature_subscriptions replica identity full;
alter table users                replica identity full;
alter table short_links          replica identity full;
alter table link_events          replica identity full;
alter table link_destination_windows replica identity full;
alter table review_locations     replica identity full;
alter table review_platforms     replica identity full;
alter table review_win_tags      replica identity full;
alter table review_submissions   replica identity full;
alter table review_requests      replica identity full;
alter table review_embed_configs replica identity full;
alter table review_embed_collections          replica identity full;
alter table review_embed_collection_locations replica identity full;
alter table review_milestone_rewards          replica identity full;
alter table review_industries    replica identity full;
alter table review_tag_presets   replica identity full;
alter table review_admin_audit   replica identity full;
alter table review_directory_profiles         replica identity full;
alter table review_directory_brands           replica identity full;
alter table review_directory_slug_aliases     replica identity full;
alter table review_referral_codes             replica identity full;
alter table review_referral_redemptions       replica identity full;

-- ════════════════════════════════════════════════════════════════════════════
-- Payments (EziQuotes): the whole workspace is brand-scoped, so brand members
-- get live clients, transactions, installment schedules, recurring invoices,
-- the catalog (products / add-ons / pricing tables / categories / templates /
-- quick sets), brand kit, account state, chase sequences, payer-lifecycle
-- events, client surveys and the activity feed. Payer-facing proposals live in
-- the canonical `proposals` table (marketplace block above), already realtime.
--
-- Write-only ledgers are intentionally excluded (no client query reads them via
-- realtime): audit / email / sms logs, webhook deliveries, client portal tokens
-- (secrets), tier-change history, affiliate ledgers, support tickets.
-- ════════════════════════════════════════════════════════════════════════════

alter table payment_accounts enable row level security;
drop policy if exists payment_accounts_visible on payment_accounts;
create policy payment_accounts_visible on payment_accounts
  for select using (app_is_brand_member(brand_id));

alter table payment_brand_kits enable row level security;
drop policy if exists payment_brand_kits_visible on payment_brand_kits;
create policy payment_brand_kits_visible on payment_brand_kits
  for select using (app_is_brand_member(brand_id));

alter table payment_clients enable row level security;
drop policy if exists payment_clients_visible on payment_clients;
create policy payment_clients_visible on payment_clients
  for select using (app_is_brand_member(brand_id));

alter table payment_templates enable row level security;
drop policy if exists payment_templates_visible on payment_templates;
create policy payment_templates_visible on payment_templates
  for select using (app_is_brand_member(brand_id));

alter table payment_products enable row level security;
drop policy if exists payment_products_visible on payment_products;
create policy payment_products_visible on payment_products
  for select using (app_is_brand_member(brand_id));

alter table payment_addons enable row level security;
drop policy if exists payment_addons_visible on payment_addons;
create policy payment_addons_visible on payment_addons
  for select using (app_is_brand_member(brand_id));

alter table payment_pricing_tables enable row level security;
drop policy if exists payment_pricing_tables_visible on payment_pricing_tables;
create policy payment_pricing_tables_visible on payment_pricing_tables
  for select using (app_is_brand_member(brand_id));

alter table payment_quick_sets enable row level security;
drop policy if exists payment_quick_sets_visible on payment_quick_sets;
create policy payment_quick_sets_visible on payment_quick_sets
  for select using (app_is_brand_member(brand_id));

alter table payment_categories enable row level security;
drop policy if exists payment_categories_visible on payment_categories;
create policy payment_categories_visible on payment_categories
  for select using (app_is_brand_member(brand_id));

alter table payment_transactions enable row level security;
drop policy if exists payment_transactions_visible on payment_transactions;
create policy payment_transactions_visible on payment_transactions
  for select using (app_is_brand_member(brand_id));

alter table payment_installment_schedules enable row level security;
drop policy if exists payment_installment_schedules_visible on payment_installment_schedules;
create policy payment_installment_schedules_visible on payment_installment_schedules
  for select using (app_is_brand_member(brand_id));

alter table payment_recurring_invoices enable row level security;
drop policy if exists payment_recurring_invoices_visible on payment_recurring_invoices;
create policy payment_recurring_invoices_visible on payment_recurring_invoices
  for select using (app_is_brand_member(brand_id));

alter table payment_client_surveys enable row level security;
drop policy if exists payment_client_surveys_visible on payment_client_surveys;
create policy payment_client_surveys_visible on payment_client_surveys
  for select using (app_is_brand_member(brand_id));

alter table payment_activity_log enable row level security;
drop policy if exists payment_activity_log_visible on payment_activity_log;
create policy payment_activity_log_visible on payment_activity_log
  for select using (app_is_brand_member(brand_id));

alter table payment_sequence_definitions enable row level security;
drop policy if exists payment_sequence_definitions_visible on payment_sequence_definitions;
create policy payment_sequence_definitions_visible on payment_sequence_definitions
  for select using (app_is_brand_member(brand_id));

alter table payment_sequence_runs enable row level security;
drop policy if exists payment_sequence_runs_visible on payment_sequence_runs;
create policy payment_sequence_runs_visible on payment_sequence_runs
  for select using (app_is_brand_member(brand_id));

alter table payment_payer_lifecycle_events enable row level security;
drop policy if exists payment_payer_lifecycle_events_visible on payment_payer_lifecycle_events;
create policy payment_payer_lifecycle_events_visible on payment_payer_lifecycle_events
  for select using (app_is_brand_member(brand_id));

alter table payment_accounts               replica identity full;
alter table payment_brand_kits             replica identity full;
alter table payment_clients                replica identity full;
alter table payment_templates              replica identity full;
alter table payment_products               replica identity full;
alter table payment_addons                 replica identity full;
alter table payment_pricing_tables         replica identity full;
alter table payment_quick_sets             replica identity full;
alter table payment_categories             replica identity full;
alter table payment_transactions           replica identity full;
alter table payment_installment_schedules  replica identity full;
alter table payment_recurring_invoices     replica identity full;
alter table payment_client_surveys         replica identity full;
alter table payment_activity_log           replica identity full;
alter table payment_sequence_definitions   replica identity full;
alter table payment_sequence_runs          replica identity full;
alter table payment_payer_lifecycle_events replica identity full;

-- ── Realtime publication membership (idempotent) ─────────────────────────────
-- `alter publication … add table` errors if the table is already a member, which
-- would break re-running this file on boot. Add each only if missing so the whole
-- script is safe to apply on every server restart.
do $$
declare t text;
begin
  foreach t in array array[
    'chat_messages','chat_threads','chat_thread_members','chat_message_reactions',
    'tasks','agency_contractor_connections','brand_agency_connections',
    'brand_agency_connection_requests','staff','services','proposals','purchases',
    'projects','project_deliverables','project_revisions','project_notes',
    'proposal_items','proposal_phases','proposal_comments','proposal_documents',
    'packages','spot_forms','spot_components','resources','meetings',
    'folders','files','discipline_requests',
    'brands','feature_subscriptions','users',
    'short_links','link_events','link_destination_windows',
    'review_locations','review_platforms','review_win_tags','review_submissions',
    'review_requests','review_embed_configs','review_embed_collections',
    'review_embed_collection_locations','review_milestone_rewards',
    'review_industries','review_tag_presets','review_admin_audit',
    'review_directory_profiles','review_directory_brands','review_directory_slug_aliases',
    'review_referral_codes','review_referral_redemptions',
    'payment_accounts','payment_brand_kits','payment_clients','payment_templates',
    'payment_products','payment_addons','payment_pricing_tables','payment_quick_sets',
    'payment_categories','payment_transactions','payment_installment_schedules',
    'payment_recurring_invoices','payment_client_surveys','payment_activity_log',
    'payment_sequence_definitions','payment_sequence_runs','payment_payer_lifecycle_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ── Storage: authenticated browser uploads to the app's known buckets ────────
-- The buckets are public (read), but a public bucket only grants public *read* —
-- inserting an object still requires an RLS policy on storage.objects, or the
-- browser upload fails with "new row violates row-level security policy".
--
-- Access model: any signed-in user may upload to / modify / delete objects in
-- the app's known buckets. Per-user folder scoping isn't used because uploads
-- are namespaced by entity (profiles/<uid>, projects/<id>, brands/<id>, …), not
-- by uploader, and these hold shared content. Reads stay public via the bucket
-- flag. Writes that need finer authorization already go through tRPC (service
-- role), which bypasses RLS entirely.

drop policy if exists app_buckets_read   on storage.objects;
drop policy if exists app_buckets_insert on storage.objects;
drop policy if exists app_buckets_update on storage.objects;
drop policy if exists app_buckets_delete on storage.objects;

-- Anyone may read (buckets are public; this makes intent explicit).
create policy app_buckets_read on storage.objects
  for select using (bucket_id in ('uploads','project-files','brand-files','chat-files','resources'));

-- Signed-in users may upload to the app buckets.
create policy app_buckets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('uploads','project-files','brand-files','chat-files','resources'));

-- Signed-in users may overwrite (upsert) objects in the app buckets.
create policy app_buckets_update on storage.objects
  for update to authenticated
  using (bucket_id in ('uploads','project-files','brand-files','chat-files','resources'))
  with check (bucket_id in ('uploads','project-files','brand-files','chat-files','resources'));

-- Signed-in users may delete objects in the app buckets.
create policy app_buckets_delete on storage.objects
  for delete to authenticated
  using (bucket_id in ('uploads','project-files','brand-files','chat-files','resources'));

-- ── Deny-by-default: every table the browser must never reach ────────────────
-- Everything above this line has RLS *and* a policy, because Realtime consults
-- the policy to decide who receives a postgres_changes event. The tables below
-- are the opposite case: they are not in the supabase_realtime publication and
-- nothing outside tRPC ever reads them (there is not a single `.from()` call in
-- the repo — server or client). They still need RLS on, because PostgREST is a
-- second door onto the same database that never passes through our backend, and
-- Supabase's default privileges grant anon/authenticated full DML on tables the
-- `postgres` role creates — which is exactly how our drizzle migrations create
-- them. RLS with no policy = deny-all for anon/authenticated; the tRPC server
-- connects as the owning `postgres` role and is unaffected.
--
-- Adding a policy here is almost always a mistake. If a table needs to be read
-- by the browser it should move up into a realtime section with an explicit
-- visibility policy, not gain a permissive one down here.
--
-- The relrowsecurity guard matters: `alter table … enable row level security`
-- takes an AccessExclusiveLock, and this file runs on every boot. Checking first
-- means a steady-state deploy takes no locks at all here (see apply-rls.ts for
-- why lock contention during a rolling deploy is a live concern). to_regclass
-- skips tables that don't exist yet, so this list can't break a boot that runs
-- ahead of a migration.
do $$
declare t text;
begin
  foreach t in array array[
    -- core platform
    'agencies','contractors','user_agencies','user_brands',
    'brand_kits','brand_notes','brand_referrals',
    'global_settings','init_task_runs','service_headings',
    'project_cycles','project_tags','projects_to_tags',
    'purchase_items','pending_purchases',
    'support_tickets','support_ticket_comments','email_unsubscribes',
    -- money: invoicing, deposits, contractor payouts, feature-sub catalogue
    'invoices','invoice_items','deposits','payouts','payout_breakdowns',
    'feature_subscription_products','feature_subscription_prices',
    'feature_subscription_tiers',
    -- ai
    'ai_plan_items','ai_usage',
    -- consumer messenger: state the browser never reads directly. Blocks and
    -- pending invites are answered THROUGH tRPC (chat.listBlocked, the invite
    -- flow), never subscribed to — and a readable chat_invites would be an
    -- address list. Deny-by-default is the correct policy for both; do NOT add
    -- a select policy here to "make them work".
    'chat_user_blocks','chat_invites',
    -- beta programme
    'beta_versions','beta_notices','beta_extensions',
    -- logo builder
    'logo_projects','logo_generations',
    -- outreach (super-admin only)
    'outreach_events','outreach_prospect_state','outreach_reply_drafts',
    'outreach_suppression','outreach_list_runs',
    -- reviews (the two tables outside the realtime set)
    'review_embed_views','review_location_slug_history',
    -- signatures
    'saved_signatures','signature_members','signature_campaigns',
    'signature_campaign_banners','signature_analytics_events',
    -- payments satellite (the non-realtime remainder)
    'payment_account_reviews','payment_affiliates','payment_affiliate_payouts',
    'payment_affiliate_referrals','payment_audit_logs','payment_client_notes',
    'payment_client_portal_tokens','payment_client_referrals',
    'payment_email_logs','payment_email_templates','payment_feature_flags',
    'payment_lifecycle_requests','payment_outbound_webhook_deliveries',
    'payment_plan_tiers','payment_plan_tier_rate_audit',
    'payment_proposal_annotations','payment_proposal_questions',
    'payment_proposal_revisions','payment_recover_waitlist',
    'payment_renewal_reminders','payment_sequence_message_log',
    'payment_sms_logs','payment_sms_messages','payment_sms_opt_outs',
    'payment_support_tickets','payment_tier_changes',
    'payment_webhook_deliveries','payment_webhook_endpoints'
  ] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      execute format('alter table %I enable row level security', t);
    end if;
  end loop;
end $$;
