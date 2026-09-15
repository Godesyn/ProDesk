# Data Models & Repositories

Authoritative reference for the application's persistent data model and the tRPC procedures that read and write it.

- **Schema:** `server/src/db/schema.ts` (Drizzle / PostgreSQL). All tables, enums, and relations below are defined here.
- **Procedures:** `server/src/routers/*.ts` (tRPC routers).
- **Business logic / side-effects:** `server/src/modules/*.ts` (billing, chat, projects, spot, connections, email, calendar).

## Conventions

- **Money** columns use `numeric(14,2)` (the `money()` helper) — exact decimal, never float. **Percentages** use `numeric(6,3)` (the `pct()` helper).
- `createdAt`/`updatedAt` are timezone-aware timestamps; `updatedAt` auto-bumps on update (`$onUpdate`).
- Primary keys are `uuid` (`defaultRandom()`), except `users.id` (mirrors `auth.users.id`), `contractors.id` (== `users.id`), and `global_settings.id` (singleton integer `1`).
- Enum string literals are **camelCase** in PostgreSQL (`pendingInvite`, `processingByPaypal`, `chatWithContractors`, `staffInvitation`). The exception is `notification_channel`, whose literals are **snake_case** (`staff_invite`, `payment_failed`) to match the mailer's channel keys (`server/src/modules/email/mailer.ts`).
- Soft deletes use a nullable `deletedAt`; partial indexes filter `deletedAt is null` for live reads.
- Membership and many-to-many relations are normalized into join tables (`user_agencies`, `user_brands`, `chat_thread_members`) rather than ID arrays on the parent row.

---

## Enums

Defined at the top of `server/src/db/schema.ts:39-254`.

| Enum | Values |
|---|---|
| `user_role` | `brandOwner`, `agencyOwner`, `individualContractor`, `agencyStaff`, `brandStaff`, `superAdmin` |
| `staff_type` | `agency`, `brand`, `contractor` |
| `staff_status` | `pending`, `active`, `removed` |
| `staff_permission` | Tab/action grants — see [Staff permissions](#staff-permissions) below |
| `connection_status` | `pendingInvite`, `pendingApplication`, `active`, `rejected`, `revoked` |
| `service_type` | `subscription`, `oneOffService`, `recurringService`, `oneOffProductShips`, `recurringProductShips`, `digitalProduct`, `section` |
| `deliverable_frequency` | `daily`, `weekly`, `monthly`, `yearly` |
| `proposal_status` | `draft`, `sent`, `viewed`, `accepted`, `rejected`, `paid` (deprecated), `expired`, `changeRequested`, `internal` |
| `proposal_item_type` | `service`, `heading`, `custom` |
| `purchase_type` | `marketplace`, `proposal` |
| `purchase_status` | `pending`, `pendingPayment`, `paid`, `processing`, `completed`, `failed` |
| `project_status` | `clientBrief`, `upcoming`, `brief`, `allocate`, `production`, `internalApproval`, `revision`, `clientApproval`, `completed` |
| `assignee_type` | `none`, `staff`, `contractor` |
| `deliverable_type` | `text`, `document`, `image` |
| `deliverable_status` | `pending`, `approved`, `rejected` |
| `party_side` | `brand`, `agency`, `sales` |
| `invoice_status` | `unpaid`, `paid`, `dispatched`, `processing`, `processingByPaypal`, `processingByWire`, `processingByStripe`, `received` |
| `payout_status` | `upcoming`, `pending`, `processing`, `paid`, `failed`, `dispatched`, `processingByPaypal`, `processingByWire`, `processingByStripe`, `received` |
| `payout_as` | `admin`, `owner`, `staff`, `contractor`, `agency` |
| `payout_method` | `stripe`, `paypal`, `wire` |
| `thread_type` | `all`, `you`, `brandAgencyStaff`, `agencyStaff`, `brandStaff`, `brandAgencyPersonal`, `agencyPersonal`, `brandPersonal`, `agencyContractorPersonal`, `platformAdmin`, `interAgency` |
| `message_type` | `system`, `text`, `image`, `video`, `document` |
| `task_type` | `staffInvitation`, `agencyApproval`, `proposalPending`, `proposalAccepted`, `clientApprovalRequest`, `agencyWorkflowAction`, `connectionRequest`, `componentApproval`, `proposalChangeRequested`, `disciplineRequest`, `resourceApproval`, `manual` |
| `task_category` | `inbox`, `todo`, `completed`, `archived` |
| `meeting_status` | `scheduled`, `cancelled`, `completed` |
| `notification_channel` | `staff_invite`, `agency_invite`, `request_completion`, `proposal`, `payment_failed`, `digital_product`, `cancel_subscription`, `verification`, `task`, `chat`, `partial_refund`, `cancellation_request`, `brand_added_you`, `referral_invite` |

Some enums retain deprecated values that PostgreSQL cannot cleanly drop:
- `proposal_status.paid` — proposals are never marked `paid`; `accepted` is the terminal billable state and payment state lives on the purchase.
- `staff_permission.businessInfo` — split into `agencyBusinessInfo` / `brandBusinessInfo`.
- `staff_permission.chat` — replaced by the three granular `chatWith*` permissions.

---

## Identity

### `users` (`schema.ts:260`)
The root identity row, keyed by the Supabase `auth.users.id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | == Supabase auth user id |
| `email` | text, unique | |
| `role` | `user_role` | nullable until role selection |
| `firstName`, `lastName`, `profileUrl` | text | |
| `selectedAgencyId`, `selectedBrandId` | uuid FK | active org context (`users.setActiveContext`) |
| `referredByUserId`, `referredByAgencyId` | uuid FK | referral attribution (commission routing) |
| `isEmailVerified`, `isSuperAdmin` | boolean | |
| `requiresPasswordReset` | boolean | set for imported accounts that lack a portable password hash, forcing a reset on first sign-in |
| `resetOtpHash`, `resetOtpExpiresAt`, `resetOtpAttempts` | text / ts / int | app-owned 4-digit recovery OTP (SHA-256 of `${code}:${userId}`) |
| `stripeAccountId`, `bankAccountLinked`, `activePayoutMethod`, `payoutMethods` | text / bool / `payout_method` / jsonb | payout configuration |
| `uiPreferences`, `customData` | jsonb (default `{}`) | |
| `googleCalendarLinked` | boolean | Google Calendar/Meet linked |
| `googleCalendarToken` | jsonb | server-only OAuth tokens `{ accessToken, refreshToken, expiryDate }` |
| `lastTasksViewedAt`, `lastSeenAt` | ts | task badge + presence heartbeat |

Org membership is normalized into `user_agencies` and `user_brands` (composite-PK join tables, `schema.ts:420`/`430`). Read paths JOIN these rather than reading an array on the user.

### `contractors` (`schema.ts:301`)
Contractor profile, 1:1 with `users` (`id` references `users.id`, cascade delete). Holds `name`, `email`, `bio`, `tagline`, `skills` (text array, GIN-indexed), `hourlyRate`, `isAvailable`, résumé/website/LinkedIn links, and `portfolioItems`/`experienceItems` jsonb arrays.

---

## Organizations

### `agencies` (`schema.ts:324`)
Profile, verification, commission configuration, and payout settings for an agency.

Profile: `ownerId`, `businessName`, `legalName`, `businessEmail`, `username` (case-insensitive unique), `website`, `phone`, `address`, `abn`, `logoUrl`, `description`, `shortDescription`, `disciplines[]`, `services[]`, `social` jsonb (`facebookUrl`/`xUrl`/`instagramUrl`).

Status flags: `emailVerified` (column `is_verified` — the agency confirmed its business email), `isSalesAgency`, `platformVerified` (column `is_default` — a Prodesk-curated agency; drives the verified badge), `rejectionReason`.

Commission redirect flags route each commission type to the agency's own bank account instead of staff/contractor: `redirectBriefingCommissionToBankAccount`, `redirectProductionCommissionToBankAccount`, `redirectSalesPersonCommissionToBankAccount` (redirects the *salesperson* cut, not the 30% agency-sales commission), `redirectInternalApprovalCommissionToBankAccount`.

Workflow designees and commissions: `briefingDesigneeId`, `allocationDesigneeId`, `approvalDesigneeId`, `salesStaffIds[]`, `salesPersonCommissions` jsonb, `productionManagerCommission`, `briefingManagerCommission`, `internalApprovalCommission`, `infin8Substages[]`, `ammortizedProjectCount`.

Payout: `stripeAccountId`, `bankAccountLinked`, `activePayoutMethod`, `payoutMethods` jsonb, plus `uiPreferences`.

### `brands` (`schema.ts:384`)
`ownerId`, `businessName`, `legalName`, `email`, `contactName`, `website`, `phone`, `address`, `abn` (shown on tax invoices where the brand is a party), `industry`, `yearFounded`, `targetAudience`, `competitors`, `usp`, `brandValues`, `toneOfVoice`, `keyMessaging`, `logoUrl`, `logoUrls[]`, `colors[]`, `typography[]`, `favouriteServiceIds[]`, `referralToken`.

---

## Staff

### `staff` (`schema.ts:444`)
A staff membership belongs to **exactly one** organization, enforced by `check('staff_one_org', num_nonnulls(agencyId, brandId) = 1)`. Columns: `email`, `type` (`staff_type`), `agencyId`/`brandId` (one set), `userId` (linked once the invite is accepted), `displayName`, `permissions` (`staff_permission[]`, default `{}`), `status` (`staff_status`), `invitedBy`, `invitedAt`, `acceptedAt`.

### Staff permissions
`staff_permission` (`schema.ts:52`) — granular tab and workflow grants:

- **Agency tabs:** `agencyDashboard`, `clients`, `catalog`, `agencyProjects`, `manageResources`, `documents`, `resources`, `brandGuidelines`, `invoice`, `subscriptions`, `bankAccount`, `staffManagement`, `rolesAndCommissions`, `manageContractors`, `proposals`, `infin8`, `agencyBusinessInfo`, `agencyInfo`, `agencies`.
- **Brand tabs:** `brandDashboard`, `brandProjects`, `brandBusinessInfo`, `payments`, `subscriptions`.
- **Chat:** `chatWithContractors`, `chatWithStaffs`, `chatWithBrands`.
- **Kanban workflow:** `projectBoard`, `production`, `addBrief`, `allocatePeople`, `approveDeliverable`, `moveToInternalApproval`, `fromClientApprovalToCompleted`.
- **Deprecated (retained for migrated rows):** `businessInfo`, `chat`.

Granting or revoking chat permissions creates/revokes the corresponding personal chat threads as a side-effect of `staff.updatePermissions` (`server/src/routers/staff.ts:137`, via `server/src/modules/chat/threads.ts`).

---

## Connections

| Table | File | Purpose |
|---|---|---|
| `brand_agency_connections` | `schema.ts:475` | Active brand↔agency link. Unique on `(brandId, agencyId)`. Chat threads reference it via `chat_threads.connectionId`. |
| `brand_agency_connection_requests` | `schema.ts:490` | Pending request (`brandId`, `agencyId`, `createdBy`). Unique on `(brandId, agencyId)`. Brand/agency display names and logos are resolved by JOIN at read time. |
| `agency_contractor_connections` | `schema.ts:503` | Agency↔contractor link with `status` (`connection_status`). `contractorId` is null for email-only invites (`pendingEmail` set); filled in when the invitee signs up. Partial unique indexes guard one connection per `(agency, contractor)` and one outstanding invite per `(agency, email)`. Carries `initiatedByUserId`, `note`, `respondedAt`. |

Connection lifecycle and the associated chat-thread provisioning live in `server/src/modules/connections/connect.ts` and `server/src/modules/contractor/connect.ts`; procedures are in `server/src/routers/connections.ts` and `server/src/routers/contractor.ts`.

---

## Catalog

### `services` (`schema.ts:537`)
Per-agency catalog entry. `agencyId`, `name`, `description`, `type` (`service_type`), pricing (`price`, `upfrontFee`, `recurringFee`, `upfrontDeliveryFee`, `recurringDeliveryFee`), media (`imageUrl` + `imagePath` storage key for delete-on-replace, `imageAspectRatio`, `videoUrl` + `videoPath`), Infin8 placement (`stage`, `subStage`), `disciplines[]`, availability flags (`allowBuyNow`, `allowBookMeeting`, `allowSalesProposal`, `isActive`), recurrence (`deliverableFrequency`, `repeatsEvery`), `sortOrder`, digital product fields, and jsonb arrays for `customFields`, `assignedStaff`, `options`, `variants`, `addons`. `upfrontProjectConfig`/`recurringProjectConfig` jsonb carry the per-mode project config (task name, minimum term, contractor default budget). Commission overrides: `salesPersonCommissions` jsonb, `productionManagerCommission`, `briefingManagerCommission`, `internalApprovalCommission`. Soft-deleted via `deletedAt`.

### `service_headings` (`schema.ts:596`)
Catalog section labels. A heading is not a service, so it has its own table; headings and services share one per-agency `sortOrder` sequence so the organize dialog interleaves them.

### `packages` (`schema.ts:612`)
Bundled offering: `agencyId`, `name`, `description`, media (`imageUrl`/`imagePath`/`videoUrl`/`videoPath`), `disciplines[]`, availability flags, `sortOrder`, `items` jsonb (proposal-item shapes), `assignedStaff` jsonb, `salesPersonCommissions` jsonb. Soft-deleted via `deletedAt`.

Custom-field definitions and `ServiceStaff` scheduling (working days / start / end / timezone) are stored within the `customFields` and `assignedStaff` jsonb arrays.

---

## Proposals

Proposals are normalized: header in `proposals`, with first-class `proposal_phases`, `proposal_items`, `proposal_documents`, and `proposal_comments`.

### `proposals` (`schema.ts:640`)
`agencyId`, `brandId`, `title`, `description`, `totalAmount`, sender attribution (`proposalSentById`, `proposalSentByAgencyId`, `createdBySalesAgencyId`), `status` (`proposal_status`), `isBillable` (false → submitting creates projects internally without sending to a client), `agencyIds[]`, PDF snapshots (`agencySnapshot`/`brandSnapshot` jsonb), `termsAndConditions`, `paymentTerms`, `validityDays`, `internalNotes`, `clientNotes`, `changeRequestNote`, `selectedPaymentPlan` jsonb, `paymentMethod`, `paymentReference`, `invoiceNumber`, and lifecycle timestamps `sentAt`/`viewedAt`/`decidedAt`/`paidAt`/`expiresAt`.

### `proposal_phases` (`schema.ts:684`)
`proposalId`, `name`, `sortOrder`, `startDelayDays` (defers a phase's projects/billing).

### `proposal_items` (`schema.ts:696`)
`proposalId`, `phaseId`, `type` (`proposal_item_type`), `serviceId`/`packageId`/`agencyId`, `description`, `headingText`, `amount`, `quantity`, fee fields, recurrence (`isRecurring`, `billingCycle`, `serviceType`, `deliverableFrequency`, `repeatsEvery`, `projectDurationDays`), brand-side exclusion flags (`isOptional`, `isExcludedByBrand`, `removalProposedByBrand`), `selectedVariantId`/`selectedOptions`/`selectedAddons`, `commissions` jsonb, `upfrontProjectConfig`/`recurringProjectConfig`, `sortOrder`.

### `proposal_documents` (`schema.ts:738`) / `proposal_comments` (`schema.ts:752`)
Attached files and the comment thread (`authorRole` is a `party_side`).

---

## Purchases

### `purchases` (`schema.ts:770`)
The paid (or internal, non-billable) purchase record. `brandId`, `userId`, `type` (`purchase_type`), `status` (`purchase_status`), `isInternal`, `errorMessage`, proposal linkage (`proposalId`, `proposalSentById`, `proposalSentByAgencyId`), `customFieldResponses`, `paymentPlans`/`selectedPaymentPlan` jsonb, `amount` jsonb (nested recurring/one-off), denormalized `totalAmount`, frozen commission split (`agencyCommission`, `affiliateCommission`, `prodeskCommission`, `salesAgencyCommission` — the 30% agency-sales rate frozen at purchase time), `paymentCount`, `paymentReceived`, Stripe linkage (`stripeSessionId`, `stripePaymentIntentId`, `stripeSubscriptionId`, `stripeCustomerId`, `stripeUrl`), `viewableToBrand`, `completedAt`/`paidAt`.

### `purchase_items` (`schema.ts:817`)
Line items carrying the frozen snapshot each spawned project inherits: service/package/agency refs, `proposalItemId`, `projectId`, `serviceName`/`serviceType`, `amount` jsonb, `lineTotal`, `quantity`, recurrence/fees, exclusion flags, variant/option/addon selections, `commissions`/`salesPersonCommissions`, `upfront`/`recurringProjectConfig`, phase scheduling (`phaseId`, `startDelayDays`), and `stripeSubscriptionItemId` (so a single recurring project can be cancelled without killing the whole subscription). `cancelledAt` marks line cancellation.

### `pending_purchases` (`schema.ts:883`)
A checkout writes the **full** purchase snapshot here, never into `purchases`. On the Stripe `checkout.session.completed` webhook the snapshot is promoted into `purchases` + `purchase_items` under the same id and the pending row deleted (`server/src/modules/billing/pending-purchase.ts`). The `data` jsonb is the canonical snapshot `{ purchase, items[] }`; item ids are minted at checkout because they are embedded in Stripe product metadata.

Fulfillment (purchase → projects + payouts + invoices on paid) runs in `server/src/modules/billing/fulfillment.ts`, triggered by the Stripe webhook (`server/src/modules/stripe/webhook.ts`). Recurring-cycle advancement runs from `server/src/modules/billing/recurring.ts`.

---

## Projects

Projects are normalized: header in `projects`, with first-class `project_deliverables`, `project_revisions`, `project_notes`.

### `projects` (`schema.ts:898`)
Source linkage: `purchaseId`, `purchaseItemId`, `stripeSubscriptionItemId`, `serviceId`/`serviceName`/`serviceType`, `packageId`/`packageName`, sender attribution.

Identity/ownership: `title`, `taskTitle`, `description`, `brandId` + free-text `brandName` (for internal projects with no registered brand), `agencyId`.

Workflow: `status` (`project_status`), `assigneeType` (`assignee_type`), `productionAssigneeId`, `viewableToBrand`, `isInternal`.

Money/config: `amount` jsonb, `contractorBudget`, `contractorBudgetNote`, `estimatedContractorDurationInHours`, `commissions` jsonb, variant/option/addon selections, `upfront`/`recurringProjectConfig`, `paymentPlans`/`selectedPaymentPlan`, `upfrontDeliveryFee`, `recurringDeliveryFee`.

Brief/content: `briefContext`, `tags[]`, `attachments[]`, `briefDocuments` jsonb, `brandWorkspaceNotes` jsonb (brand↔agency text posts hidden from contractors), `customFieldResponses` jsonb.

Recurrence/revision: `deliverableFrequency`, `repeatsEvery`, `cycleCount`, `revisionCount`, `clientRevisionCount`, plus inline revision/refund fields `revisionNote`, `revisionComments[]`, `revisionAttachmentUrl`, `revisionAttachmentUrls[]`, `proposedRefundAmount`.

Timestamps/tokens: `deadline`, `nextCycleAt` (recurring cron scan), `approvedBy`/`approvalMethod`/`approvedAt`, `cancelledAt`, `deletedAt`, `softDeleteExpiry`/`softDeleteToken` (brand-confirm-via-email), `completionExpiry`/`completionToken` (brand-one-click-complete-via-email).

### `project_deliverables` (`schema.ts:986`)
`type` (`deliverable_type`), `content`, `fileName`, `description`, `status` (`deliverable_status`), `source` (`party_side`), `uploadedBy`, `reviewedBy`, `rejectionReason`, `sortOrder`, `uploadedAt`/`reviewedAt`.

### `project_revisions` (`schema.ts:1014`) / `project_notes` (`schema.ts:1030`)
Revision history and notes, each with `authorId`/`authorName`/`authorRole`/`source` (`party_side`). Revisions carry `attachmentUrls[]`.

The Kanban workflow transitions are first-class procedures in `server/src/routers/projects.ts`: `submitBrief`/`completeBrief` (brief stage), `addBriefDocument`, `allocate` (validates the contractor's active agency connection and moves status to production), `assign`, `internalApprovalDecision`, `clientApprovalDecision`, `markProjectComplete` (triggers the brand completion-confirmation email), plus deliverable review and recurring-item cancellation.

---

## Finance

### `payouts` (`schema.ts:1049`)
A payout has exactly one beneficiary — a **user** (`beneficiaryId`) **or** an **agency** (`beneficiaryAgencyId`), enforced by `check('payouts_one_beneficiary', num_nonnulls(beneficiaryId, beneficiaryAgencyId) = 1)`. `agencyId` is the source/owning agency of the work (distinct from the beneficiary agency). Columns: `amount`, `paidAmount` (`<= amount`, checked), `currency` (default `AUD`), `purchaseId`, `status` (`payout_status`), `as` (`payout_as`), `method` (`payout_method`), `sourceBrandName`, `transactionId`, `wiseFunding` jsonb (Wise-via-Stripe funding sub-state), `toPayAt`/`completelyPaidAt`.

### `payout_breakdowns` (`schema.ts:1105`)
Per-line attribution: `payoutId`, `projectId`, `purchaseId`, `brandId`, `description`, `commissionType`, `role`, `sourceServiceName`, `amount`, `gst`, `week`, `metadata` jsonb, `paidAt`.

### `deposits` (`schema.ts:1137`)
Realized money-out records (mainly Wise-funded contractor payouts): `amount`, `currency`, `beneficiaryId`, `method` (free-text role, not the payout-method enum), `gatewayStatus`, `transactionId`, `breakdown` jsonb, `rawResponse` jsonb (provider response retained for reconciliation), `paidAt`.

### `invoices` (`schema.ts:1158`)
`number` — a global monotonic sequential identity (`generatedByDefaultAsIdentity`) rendered as `#INV_0001`. `purchaseId`, `payoutId`, `cycle`, `commissionType`, `status` (`invoice_status`), `fromParty`/`toParty` jsonb (each carries the party's details incl. `isProdesk`), `total`. Line items in `invoice_items` (`schema.ts:1184`).

Payout dispatch and Wise/Stripe payout handling live in `server/src/modules/billing/dispatch.ts`, `payout-providers.ts`, `payout-recipient.ts`, `payout-webhooks.ts`, and `wise.ts`. Invoice PDF generation is `invoices.pdf` (`server/src/routers/invoices.ts:144`).

---

## Chat

Membership and unread state are normalized into `chat_thread_members`.

### `chat_threads` (`schema.ts:1203`)
`connectionId` (→ `brand_agency_connections`), `name`, `type` (`thread_type`), `agencyIds[]`, `brandId`, `participantAId`/`participantBId`, `contractorId`, `createdBy`, `lastMessage`/`lastMessageAt`, `isArchived`.

### `chat_thread_members` (`schema.ts:1228`)
Composite PK `(threadId, userId)`. Per-member `role`, `unreadCount`, `lastReadMessageId`/`lastReadAt`, `isArchived`.

### `chat_messages` (`schema.ts:1247`)
`threadId`, `senderId`, denormalized sender fields (`senderName`, `senderAvatar`, `senderRole`, `senderBusinessName`), `content`, `type` (`message_type`), file fields (`fileUrl`, `fileName`, `thumbnailUrl`, `fileSize`), `replyToId`, `projectId`, `timestamp`.

Chat identity resolution (brand / agency / contractor / platform-admin / user) is in `server/src/modules/chat/identity.ts`; thread typing in `thread-types.ts`; provisioning in `threads.ts`.

---

## Tasks

### `tasks` (`schema.ts:1274`)
`type` (`task_type`), `category` (`task_category`), `title`, `description`, `assigneeId`, `assignedBy`, `sortOrder`, `relatedEntityId`, `organizationId`/`organizationName`, `agencyName`, `brandName`, `projectId`, `proposalId`, `visibleTo[]` (GIN-indexed), `disableMailing`, `attachments[]`, `metadata` jsonb. Procedures: `server/src/routers/tasks.ts`.

---

## Files, Folders, Resources, Meetings, Settings

### `folders` (`schema.ts:1309`)
Brand-created organizational containers: `name`, `brandId`, `agencyId`, `parentId`, `isPrivate`, `isPublic` (false = Agency Documents tab, true = Public Brand Assets tab), `createdBy`.

### `files` (`schema.ts:1330`)
`name`, `url`, `brandId`, `agencyId` (primary owning agency) + `agencyIds[]` (a file shared in a group chat may belong to several), `folderId`, `projectId`/`projectTitle`, `uploadedBy`, `agencyWhoUploaded`, `size`, `type`, `category`, `source`, `isPrivate`, `isPublic`, `sortOrder`. Document Locker auto-sourcing: `sourceType`/`sourceId` (e.g. `chat`/`deliverable`/`infohub`/`proposalDoc`/`briefDoc`/`questionnaire`) with a partial unique index for idempotent inserts, and a human-readable `note`. Soft-deleted via `deletedAt`. Locker auto-recording logic is in `server/src/modules/locker/record.ts`.

### `resources` (`schema.ts:1390`)
`title`, `description`, `url`, `linkUrl`, `categories[]`, `agencyId` (null = admin/global resource), `uploadedBy`, `acceptedAt` (approval flow — super-admin approve/reject in `server/src/routers/resources.ts`).

### `meetings` (`schema.ts:1407`)
`serviceId`, `agencyId`, `brandId`, `brandUserId`, `assigneeUserId`, denormalized names/email, `googleEventId`, `meetUrl`, `status` (`meeting_status`), `startTime`/`endTime`, `cancelledAt`. Calendar OAuth link/unlink, slot availability, and Google Calendar/Meet event creation are in `server/src/routers/meetings.ts` (`calendarAuthUrl`, `linkCalendar`, `unlinkCalendar`, `availableSlots`, `create`, `cancel`) backed by `server/src/modules/calendar/google.ts`.

### `global_settings` (`schema.ts:1431`)
Singleton row (`id = 1`, checked). Platform commission rates (`prodeskCommission`, `affiliateCommission`, `agencyCommission`, `salesAgencyCommission`), `defaultPaymentPlans` jsonb, `disciplines[]`, `services[]`, `infin8Stages` jsonb (admin-editable ordered stages with substages), `updatedBy`. Managed via `superAdmin.getSettings`/`updateSettings` and the Infin8/discipline mutations in `server/src/routers/superAdmin.ts`.

---

## SPOT — brand-profile custom forms

### `spot_forms` (`schema.ts:1458`)
Reusable question templates. `agencyId` (null = global/default template), `brandId` (set when a brand builds its own one-off section), `name`, `description`, `questions` jsonb (`SpotQuestionModel[]`: `{ id, text, type, options[], isRequired }`), `isDefault`, `isSecret`.

### `spot_components` (`schema.ts:1478`)
A filled section on a brand profile. `templateId` (snapshot ref, null for a brand's own inline section), `templateName`, `agencyId`, `brandId`, inline `questions` jsonb (for template-less sections), `answers` jsonb (`questionId -> answer`), `isPublic`, `isSecret`, `order` (column `sort_order`), `questionOrder[]`, `createdByUserId`.

Procedures: `server/src/routers/spot.ts` (form CRUD, component create/update/answer/reorder/visibility, public profile views). Component provisioning is in `server/src/modules/spot/provision.ts`.

---

## Discipline Requests, Brand Referrals, Email Preferences

### `discipline_requests` (`schema.ts:1511`)
`discipline`, `agencyId`, `createdAt`. Managed via `superAdmin.disciplineRequests`/`approveDisciplineRequest`/`deleteDisciplineRequest`.

### `brand_referrals` (`schema.ts:1522`)
Agency-recorded referral lead: `businessName`, `agencyId`, `email`. Created via `brands.createReferral` (`server/src/routers/brands.ts:210`). Distinct from buyer attribution, which lives on `users.referredByAgencyId`.

### `email_unsubscribes` (`schema.ts:1535`)
Per-email unsubscribe state keyed by `email`, with a `channels` array of `notification_channel`. Read/toggled via `users.unsubscribedChannels`/`toggleUnsubscribeChannel` (`server/src/routers/users.ts:45-66`); the mailer checks it in `server/src/modules/email/unsubscribe.ts` and `mailer.ts`.

---

## Relations

Drizzle `relations()` declarations (`schema.ts:1545-1685`) wire up the read graph: `users` → contractor / agencies / brands; `agencies` → owner / services / packages / members; `brands` → owner / members / projects; `proposals` → items / phases / documents / comments; `purchases` → brand / user / proposal / items / projects; `projects` → brand / agency / purchase / assignee / deliverables / revisions / notes; `payouts` → beneficiary / agency / breakdown; `invoices` → purchase / payout / items; `chat_threads` → connection / members / messages; `spot_forms`/`spot_components` → agency / brand; `discipline_requests`/`brand_referrals` → agency.

---

## Procedure index by router

`server/src/routers/`: `auth`, `users`, `brands`, `agencies`, `staff`, `connections`, `contractor`, `services`, `packages`, `proposals`, `purchases`, `projects`, `payouts`, `invoices`, `billing`, `marketplace`, `chat`, `tasks`, `files`, `media`, `meetings`, `resources`, `spot`, `superAdmin`.

Cross-cutting business logic lives in `server/src/modules/`: `billing/` (fulfillment, recurring cycles, payouts, Stripe, Wise, subscriptions, invoices, earnings prediction), `projects/` (fulfillment-core, recurring schedule, kanban reset), `chat/` (identity, thread types, provisioning, navigation), `connections/` & `contractor/` (connection lifecycle + thread provisioning), `spot/` (component provisioning), `email/` (mailer, templates, unsubscribe), `calendar/` (Google), `locker/` (Document Locker auto-recording), `media/` (transcode), `stripe/` (webhook, client), `partner/` (partner API).
