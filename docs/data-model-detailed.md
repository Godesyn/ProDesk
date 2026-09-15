# Prodesk — Detailed Data Model & Relationships

**Audience:** Executive / Business Analyst / Technical stakeholder
**Purpose:** A complete reference of every major entity in the Prodesk platform — its purpose, each property and what it means, the relationships between entities (with direction and cardinality), the controlled value lists (enums), and the embedded sub-structures.

Prodesk connects three customer types — **Brands** (clients), **Agencies** (sellers/deliverers), and **Contractors** (freelance production talent) — across the full sales → delivery → payout lifecycle.

---

## How to read this document

- **Cardinality notation:**
  - `1 → many` : one record on the left relates to many on the right (e.g. one Agency → many Services).
  - `many ↔ many` : both sides can relate to many of the other (handled by a join/link record).
  - `1 → 1` : one-to-one.
- **"Reference"** means the property stores the ID of another record (a foreign key).
- **"Embedded (list)"** means the data is stored _inside_ this record as a structured block, rather than as a separate table — used for snapshot/config data that's always read together. These are expanded in the _Embedded Structures_ sections.
- **"Snapshot"** means a copy of data taken at a point in time (e.g. the agency's name copied onto a proposal) so historical documents don't change when the source later changes.

---

## Controlled value lists (Enums)

| Enum                      | Allowed values                                                                                                                                                                                                              | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **User Role**             | brandOwner, agencyOwner, individualContractor, agencyStaff, brandStaff, superAdmin                                                                                                                                          | The user's primary capacity on the platform.                          |
| **Staff Type**            | agency, brand, contractor                                                                                                                                                                                                   | Which kind of organization a staff record belongs to.                 |
| **Staff Status**          | pending, active, removed                                                                                                                                                                                                    | Lifecycle of a team-member invitation.                                |
| **Connection Status**     | pendingInvite, pendingApplication, active, rejected, revoked                                                                                                                                                                | State of an agency↔contractor relationship.                           |
| **Service Type**          | oneOff, recurring, digital, meeting                                                                                                                                                                                         | How a service is delivered and billed.                                |
| **Deliverable Frequency** | oneTime, weekly, fortnightly, monthly, quarterly                                                                                                                                                                            | Cadence of recurring deliverables.                                    |
| **Proposal Status**       | draft, sent, viewed, accepted, rejected, paid, expired, changeRequested                                                                                                                                                     | Sales lifecycle of a quote.                                           |
| **Purchase Type**         | marketplace, proposal                                                                                                                                                                                                       | Whether a transaction came from a direct buy or an accepted proposal. |
| **Purchase Status**       | pending, pendingPayment, paid, processing, completed, failed                                                                                                                                                                | Lifecycle of a transaction.                                           |
| **Project Status**        | clientBrief, upcoming, brief, allocate, production, internalApproval, revision, clientApproval, completed                                                                                                                   | The production pipeline stage of a piece of work.                     |
| **Assignee Type**         | none, staff, contractor                                                                                                                                                                                                     | Who is doing the production work on a project.                        |
| **Invoice Status**        | unpaid, paid, dispatched, processing, processingByPaypal/Wire/Stripe, received                                                                                                                                     | Billing-document state across payment providers.                      |
| **Payout Status**         | upcoming, pending, processing, paid, failed, dispatched, processingBy[Paypal/Wire/Stripe], received                                                                                                                | Disbursement state across payout providers.                           |
| **Payout As**             | admin, owner, staff, contractor, agency                                                                                                                                                                                     | The capacity in which a beneficiary is being paid (`agency` = the agency itself receives it). |
| **Payout Method**         | stripe, paypal, wire                                                                                                                                                                                              | Channel used to pay a beneficiary.                                    |
| **Thread Type**           | all, you, brandAgencyStaff, agencyStaff, brandStaff, brandAgencyPersonal, agencyPersonal, brandPersonal, agencyContractorPersonal, platformAdmin, interAgency                                                               | The conversation grouping/scope.                                      |
| **Message Type**          | system, text, image, video, document                                                                                                                                                                                        | The content kind of a chat message.                                   |
| **Task Type**             | staffInvitation, agencyApproval, proposalPending, proposalAccepted, clientApprovalRequest, agencyWorkflowAction, connectionRequest, componentApproval, proposalChangeRequested, disciplineRequest, resourceApproval, manual | What triggered/what kind of action a task represents.                 |
| **Task Category**         | inbox, todo, completed, archived                                                                                                                                                                                            | The task board column.                                                |
| **Meeting Status**        | scheduled, cancelled, completed                                                                                                                                                                                             | State of a booked meeting.                                            |

---

# 1. People & Identity

## User

**Purpose:** Every person with a login. The identity and access anchor for the whole platform; the user ID mirrors the authentication system's user ID.

| Property             | Type               | Description                                                      |
| -------------------- | ------------------ | ---------------------------------------------------------------- |
| id                   | ID                 | Unique user identifier (same as the auth provider's user ID).    |
| email                | text (unique)      | Login email; no two users share one.                             |
| role                 | User Role          | The user's primary capacity (see enum).                          |
| firstName / lastName | text               | Personal name.                                                   |
| profileUrl           | text               | Avatar/profile image URL.                                        |
| selectedAgencyId     | Reference → Agency | The agency the user is currently "acting as" (context switcher). |
| selectedBrandId      | Reference → Brand  | The brand the user is currently acting as.                       |
| referredByUserId     | Reference → User   | The user who referred them (affiliate tracking).                 |
| referredByAgencyId   | Reference → Agency | The agency that referred them.                                   |
| isEmailVerified      | yes/no             | Whether the email has been confirmed.                            |
| isSuperAdmin         | yes/no             | Platform-admin flag (gates super-admin areas).                   |
| stripeAccountId      | text               | Connected Stripe account for receiving funds.                    |
| bankAccountLinked    | yes/no             | Whether a payout bank account is set up.                         |
| activePayoutMethod   | Payout Method      | Which channel they're paid through.                              |
| payoutMethods        | structured block   | Method-specific details (e.g. PayPal email, bank/SWIFT data).    |
| uiPreferences        | structured block   | Saved interface preferences.                                     |
| lastTasksViewedAt    | date/time          | When they last viewed their task board (for unread badges).      |
| createdAt            | date/time          | Account creation timestamp.                                      |

**Relationships:**

- User `1 → many` Brand (a user can own several brands) and `1 → many` Agency (own several agencies).
- User `many ↔ many` Brand and `many ↔ many` Agency via **membership** links (can be a member of organizations they don't own).
- User `1 → 1` Contractor (a user may have one contractor profile).
- User `1 → many` Staff (a user can hold staff records in multiple organizations).
- User is referenced as beneficiary on **Payouts**, author on **Chat Messages**, assignee on **Tasks**, owner on **Brands/Agencies**.

## Contractor

**Purpose:** The professional profile of a freelancer. Shares its ID with the User record (1-to-1 extension).

| Property                   | Type                       | Description                                 |
| -------------------------- | -------------------------- | ------------------------------------------- |
| id                         | Reference → User (also PK) | Same ID as the user; ties profile to login. |
| name / email               | text                       | Display name and contact email.             |
| bio / tagline              | text                       | Long and short professional summaries.      |
| skills                     | list of text               | Skill tags used for discovery/matching.     |
| hourlyRate                 | number                     | Quoted rate.                                |
| isAvailable                | yes/no                     | Whether open to new work.                   |
| resumeUrl / resumeFileName | text                       | Uploaded résumé.                            |
| websiteUrl / linkedinUrl   | text                       | External profile links.                     |
| portfolioItems             | Embedded (list)            | Portfolio entries (title, media, links).    |
| experienceItems            | Embedded (list)            | Work-history entries.                       |
| createdAt                  | date/time                  | Profile creation.                           |

**Relationships:** Contractor `1 → 1` User. Contractor `many ↔ many` Agency via **Agency–Contractor Connections**. Referenced as `productionAssigneeId` on **Projects**.

---

# 2. Organizations

## Brand

**Purpose:** A client business that purchases services. The "buyer" account.

| Property                                                    | Type                         | Description                                          |
| ----------------------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| id                                                          | ID                           | Unique brand identifier.                             |
| ownerId                                                     | Reference → User             | The brand's owner.                                   |
| businessName / legalName                                    | text                         | Trading and legal names.                             |
| email / contactName / phone / address / website             | text                         | Contact details.                                     |
| industry / yearFounded / targetAudience / competitors / usp | text                         | Business profile fields used in briefs and matching. |
| brandValues / toneOfVoice / keyMessaging                    | text                         | Brand guideline content.                             |
| logoUrl / logoUrls                                          | text / list                  | Primary and additional logos.                        |
| colors / typography                                         | list of text                 | Brand palette and fonts.                             |
| favouriteServiceIds                                         | list of References → Service | Saved/favourited services.                           |
| referralToken                                               | text                         | Token used in referral links.                        |
| createdAt                                                   | date/time                    | Creation timestamp.                                  |

**Relationships:**

- Brand `many → 1` User (owner). Brand `many ↔ many` User via membership.
- Brand `many ↔ many` Agency via **Brand–Agency Connections**.
- Brand `1 → many` Project, `1 → many` Proposal, `1 → many` Purchase, `1 → many` File/Folder.

## Agency

**Purpose:** A service-provider business that sells and delivers work. The "seller" account; supports white-label storefronts.

| Property                                                                             | Type                              | Description                                     |
| ------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------- |
| id                                                                                   | ID                                | Unique agency identifier.                       |
| ownerId                                                                              | Reference → User                  | The agency's owner.                             |
| businessName / legalName / businessEmail / phone / address / website / abn           | text                              | Business identity & contact.                    |
| username                                                                             | text (unique)                     | Subdomain key for white-label storefront.       |
| logoUrl / description / shortDescription                                             | text                              | Branding/marketing copy.                        |
| disciplines / services                                                               | list of text                      | Capabilities/categories offered.                |
| isVerified                                                                           | yes/no                            | Platform-approved status (gates selling).       |
| isSalesAgency                                                                        | yes/no                            | Whether it operates as a sales/reseller agency. |
| isDefault                                                                            | yes/no                            | Flag for the platform's default agency.         |
| rejectionReason                                                                      | text                              | If verification was declined.                   |

| briefingDesigneeId / allocationDesigneeId / approvalDesigneeId                       | References → Staff/User           | Staff assigned to key workflow steps.           |
| salesStaffIds                                                                        | list of References                | Designated sales staff.                         |
| salesPersonCommissions                                                               | structured block (per-user rates) | Commission % per salesperson.                   |
| productionManagerCommission / briefingManagerCommission / internalApprovalCommission | number                            | Role-based commission rates.                    |
| infin8Substages                                                                      | list of text                      | Custom marketplace sub-stages.                  |
| social                                                                               | Embedded (object)                 | Facebook / X / Instagram URLs.                  |
| stripeAccountId / bankAccountLinked / activePayoutMethod / payoutMethods             | mixed                             | Payout configuration.                           |
| createdAt                                                                            | date/time                         | Creation timestamp.                             |

**Relationships:**

- Agency `many → 1` User (owner). Agency `many ↔ many` User via membership.
- Agency `1 → many` Service, `1 → many` Package.
- Agency `many ↔ many` Brand via connections; `many ↔ many` Contractor via connections.
- Agency `1 → many` Proposal, Project, Payout, Invoice, Resource, Meeting.

---

# 3. Team & Access

## Staff

**Purpose:** A team member within a brand or agency, carrying granular permissions. The basis of role-based access control.

| Property               | Type                            | Description                                                                                    |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| id                     | ID                              | Unique staff record.                                                                           |
| email                  | text                            | Invitee/member email.                                                                          |
| organizationId         | Reference → Brand **or** Agency | The organization this membership belongs to.                                                   |
| type                   | Staff Type                      | agency / brand / contractor.                                                                   |
| userId                 | Reference → User (nullable)     | Linked user; empty while an invite is pending.                                                 |
| displayName            | text                            | Member's display name.                                                                         |
| permissions            | list of text                    | Granular rights (e.g. clients, catalog, proposals, invoice, staffManagement, chatWithBrands…). |
| status                 | Staff Status                    | pending / active / removed.                                                                    |
| invitedBy              | Reference → User                | Who sent the invite.                                                                           |
| invitedAt / acceptedAt | date/time                       | Invitation timeline.                                                                           |

**Relationships:** Staff `many → 1` Organization (Brand or Agency, via `organizationId`). Staff `many → 1` User. Referenced by Agency designee fields and sales staff lists.

## Memberships — `user_agencies` & `user_brands`

**Purpose:** Link records that record which users belong to which organizations (one person can be in many businesses).

| Property           | Type                       | Description       |
| ------------------ | -------------------------- | ----------------- |
| userId             | Reference → User           | The member.       |
| agencyId / brandId | Reference → Agency / Brand | The organization. |

**Relationships:** These implement the User `many ↔ many` Agency and User `many ↔ many` Brand relationships.

---

# 4. Relationships (Connections)

## Brand–Agency Connection

**Purpose:** A confirmed working relationship between a brand and an agency. Gates all collaboration.

| Property              | Type               | Description        |
| --------------------- | ------------------ | ------------------ |
| id                    | ID                 | Unique connection. |
| brandId               | Reference → Brand  | The brand side.    |
| agencyId              | Reference → Agency | The agency side.   |
| createdAt / updatedAt | date/time          | Timeline.          |

**Relationships:** Implements Brand `many ↔ many` Agency. Referenced by **Chat Threads** (`connectionId`). Unique per brand+agency pair.

## Brand–Agency Connection Request

**Purpose:** A pending invitation that, once accepted, becomes a connection.

| Property              | Type             | Description      |
| --------------------- | ---------------- | ---------------- |
| id                    | ID               | Unique request.  |
| brandId / agencyId    | References       | The two parties. |
| createdBy             | Reference → User | Who initiated.   |
| createdAt / updatedAt | date/time        | Timeline.        |

## Agency–Contractor Connection

**Purpose:** The agency↔freelancer working relationship, with an invite/apply/approve lifecycle.

| Property                            | Type               | Description                                                       |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------- |
| id                                  | ID                 | Unique connection.                                                |
| agencyId                            | Reference → Agency | The agency.                                                       |
| contractorId                        | Reference → User   | The contractor.                                                   |
| status                              | Connection Status  | pendingInvite / pendingApplication / active / rejected / revoked. |
| initiatedByUserId                   | Reference → User   | Who started it (invite vs application).                           |
| note                                | text               | Optional message.                                                 |
| createdAt / updatedAt / respondedAt | date/time          | Lifecycle timestamps.                                             |

**Relationships:** Implements Agency `many ↔ many` Contractor. Unique per agency+contractor pair.

---

# 5. Catalog (What Agencies Sell)

## Service

**Purpose:** A single sellable offering. The fundamental unit of revenue; defines price, billing model, configuration, and commission split.

| Property                                            | Type               | Description                                                  |
| --------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| id                                                  | ID                 | Unique service.                                              |
| agencyId                                            | Reference → Agency | Owner agency.                                                |
| name / description                                  | text               | Offering details.                                            |
| type                                                | Service Type       | oneOff / recurring / digital / meeting.                      |
| price / upfrontFee / recurringFee                   | number             | Pricing components.                                          |
| upfrontDeliveryFee / recurringDeliveryFee           | number             | Delivery surcharges.                                         |
| imageUrl / videoUrl / imageAspectRatio              | media              | Marketing media.                                             |
| stage / subStage                                    | text               | Marketplace categorization.                                  |
| disciplines                                         | list of text       | Relevant disciplines.                                        |
| allowBuyNow / allowBookMeeting / allowSalesProposal | yes/no             | Permitted purchase paths.                                    |
| isActive                                            | yes/no             | Whether listed.                                              |
| deliverableFrequency / repeatsEvery                 | enum / number      | Recurring cadence.                                           |
| sortOrder                                           | number             | Display order.                                               |
| isHeading / headingText                             | yes/no / text      | Section-heading rows in a catalog.                           |
| digitalProductFileUrl / digitalProductFileName      | text               | Deliverable for digital products.                            |
| customFields                                        | Embedded (list)    | Intake questions asked at purchase.                          |
| assignedStaff                                       | Embedded (list)    | Staff attached to delivery.                                  |
| options / variants / addons                         | Embedded (lists)   | Configurable choices & up-sells (see _Embedded Structures_). |
| upfrontProjectConfig / recurringProjectConfig       | Embedded (object)  | How the resulting project(s) are set up.                     |
| salesPersonCommissions + role commissions           | block / numbers    | Commission overrides for this service.                       |
| createdAt / deletedAt                               | date/time          | Lifecycle (soft delete).                                     |

**Relationships:** Service `many → 1` Agency. Referenced by Proposals/Purchases/Projects (by ID and by snapshot), and favourited by Brands.

## Package

**Purpose:** A bundle of services sold as one.

| Property                                                       | Type               | Description                      |
| -------------------------------------------------------------- | ------------------ | -------------------------------- |
| id                                                             | ID                 | Unique package.                  |
| agencyId                                                       | Reference → Agency | Owner agency.                    |
| name / description / media                                     | mixed              | Bundle details.                  |
| disciplines                                                    | list of text       | Relevant disciplines.            |
| allowBuyNow / allowBookMeeting / allowSalesProposal / isActive | yes/no             | Listing & purchase settings.     |
| sortOrder                                                      | number             | Display order.                   |
| items                                                          | Embedded (list)    | The included service line items. |
| assignedStaff / salesPersonCommissions                         | Embedded           | Delivery & commission config.    |
| createdAt / deletedAt                                          | date/time          | Lifecycle.                       |

**Relationships:** Package `many → 1` Agency; its `items` reference Services.

---

# 6. Sales

## Proposal

**Purpose:** A formal quote from an agency to a brand. Tracks a deal from draft through negotiation to acceptance, then converts to a purchase + projects.

| Property                                                       | Type               | Description                                                               |
| -------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| id                                                             | ID                 | Unique proposal.                                                          |
| agencyId / brandId                                             | References         | The selling agency and receiving brand.                                   |
| title / description                                            | text               | Proposal heading & summary.                                               |
| totalAmount                                                    | number             | Quoted total — the full pay-in-full one-off subtotal (Σ amount×qty of non-recurring, non-heading items), independent of payment plan; NOT the amount due today. A plan only changes the deposit/schedule, never this value. |
| proposalSentById                                               | Reference → User   | The sender.                                                               |
| proposalSentByAgencyId                                         | Reference → Agency | Sending agency (may differ for sales agencies).                           |
| createdBySalesAgencyId                                         | Reference → Agency | Originating sales agency, if applicable.                                  |
| status                                                         | Proposal Status    | draft → sent → viewed → accepted/rejected/changeRequested → paid/expired. |
| items                                                          | Embedded (list)    | Line items (services, headings, custom).                                  |
| phases                                                         | Embedded (list)    | Delivery phases/stages.                                                   |
| documents                                                      | Embedded (list)    | Attached files.                                                           |
| comments                                                       | Embedded (list)    | Negotiation thread between brand/agency/sales.                            |
| agencyIds                                                      | list of References | For multi-agency proposals.                                               |
| agencySnapshot / brandSnapshot                                 | Snapshot blocks    | Party contact details copied at send time.                                |
| termsAndConditions / paymentTerms / validityDays               | text / number      | Commercial terms.                                                         |
| internalNotes / clientNotes / changeRequestNote                | text               | Notes (internal vs client-facing) and change requests.                    |
| invoiceNumber                                                  | text               | Linked invoice reference.                                                 |
| createdAt / sentAt / viewedAt / decidedAt / paidAt / expiresAt | date/time          | Full lifecycle timeline.                                                  |

**Relationships:** Proposal `many → 1` Brand and `many → 1` Agency. Proposal `1 → 1` Purchase (on acceptance/payment). `items` reference Services/Packages.

---

# 7. Transactions

## Purchase

**Purpose:** The financial system of record for a transaction (marketplace buy or accepted proposal). Triggers project creation and drives recurring billing & payouts.

| Property                                                                     | Type                         | Description                                       |
| ---------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| id                                                                           | ID                           | Unique purchase.                                  |
| brandId                                                                      | Reference → Brand            | The buyer organization.                           |
| userId                                                                       | Reference → User             | The purchasing user.                              |
| type                                                                         | Purchase Type                | marketplace / proposal.                           |
| status                                                                       | Purchase Status              | pending → paid → processing → completed / failed. |
| isInternal                                                                   | yes/no                       | Internal (agency→brand) billing vs external.      |
| errorMessage                                                                 | text                         | Failure detail, if any.                           |
| proposalId                                                                   | Reference → Proposal         | Source proposal, if applicable.                   |
| proposalSentById / proposalSentByAgencyId                                    | References                   | Who/which agency sold it.                         |
| items                                                                        | Embedded (list)              | Purchased line items with pricing snapshots.      |
| customFieldResponses                                                         | Embedded (map)               | Buyer answers to service intake questions.        |
| paymentPlans / selectedPaymentPlan                                           | Embedded                     | Available and chosen payment schedules.           |
| amount                                                                       | Embedded (object)            | One-off / recurring amount breakdown.             |
| agencyCommission / affiliateCommission / prodeskCommission / salesAgencyCommission | number                       | Commission split.                                 |
| projectIds                                                                   | list of References → Project | Projects spawned by this purchase.                |
| paymentCount                                                                 | number                       | Number of payments received (recurring tracking). |
| paymentReceived                                                              | number                       | Total collected to date.                          |
| stripeSessionId / stripePaymentIntentId / stripeUrl                          | text                         | Payment-processor references.                     |
| viewableToBrand                                                              | yes/no                       | Visibility control.                               |
| createdAt / completedAt / paidAt                                             | date/time                    | Lifecycle timeline.                               |

**Relationships:** Purchase `many → 1` Brand & User; `0..1 → 1` Proposal; Purchase `1 → many` Project; Purchase `1 → many` Invoice; referenced by Payouts.

---

# 8. Delivery

## Project

**Purpose:** A unit of deliverable work created from a purchase. The operational core; moves through a defined production pipeline with handoffs between client, agency, and contractor.

| Property                                                           | Type                        | Description                                                                                             |
| ------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| id                                                                 | ID                          | Unique project.                                                                                         |
| title / taskTitle / description                                    | text                        | Project naming and brief summary.                                                                       |
| purchaseId                                                         | Reference → Purchase        | Originating transaction.                                                                                |
| brandId / agencyId                                                 | References                  | Client and delivering agency.                                                                           |
| serviceId / serviceName / serviceType                              | Reference + snapshot        | The service being delivered.                                                                            |
| packageId / packageName                                            | Reference + snapshot        | Parent package, if any.                                                                                 |
| proposalSentById / proposalSentByAgencyId                          | References                  | Sales attribution.                                                                                      |
| status                                                             | Project Status              | clientBrief → brief → allocate → production → internalApproval → revision → clientApproval → completed. |
| assigneeType                                                       | Assignee Type               | none / staff / contractor.                                                                              |
| productionAssigneeId                                               | Reference → User/Contractor | Who's doing the work.                                                                                   |
| viewableToBrand                                                    | yes/no                      | Whether the client can see it yet.                                                                      |
| isInternal                                                         | yes/no                      | Internal project flag.                                                                                  |
| amount                                                             | Embedded (object)           | Financials for this project.                                                                            |
| contractorBudget / contractorBudgetNote                            | number / text               | Pay allocated to the contractor.                                                                        |
| estimatedContractorDurationInHours                                 | number                      | Effort estimate.                                                                                        |
| briefContext                                                       | text                        | Brief narrative.                                                                                        |
| tags / attachments                                                 | lists                       | Labels and attached files.                                                                              |
| briefDocuments                                                     | Embedded (list)             | Brief files (with uploader/source).                                                                     |
| deliverables                                                       | Embedded (list)             | Submitted work items with review state.                                                                 |
| revisions                                                          | Embedded (list)             | Revision requests/threads.                                                                              |
| notes                                                              | Embedded (list)             | Internal/client notes.                                                                                  |
| customFieldResponses                                               | Embedded (list)             | Intake answers carried into delivery.                                                                   |
| paymentPlans / selectedPaymentPlan                                 | Embedded                    | Billing schedule.                                                                                       |
| commissions                                                        | Embedded (object)           | Full commission split for this project.                                                                 |
| selectedVariantId / selectedOptions / selectedAddons               | mixed                       | Chosen service configuration.                                                                           |
| upfrontProjectConfig / recurringProjectConfig                      | Embedded                    | Project setup config.                                                                                   |
| deliverableFrequency / repeatsEvery / cycleCount / nextCycleAt     | enum/number/date            | Recurring-work scheduling.                                                                              |
| revisionCount / clientRevisionCount                                | number                      | Revision counters.                                                                                      |
| deadline                                                           | date/time                   | Due date.                                                                                               |
| approvedBy / approvalMethod / approvedAt                           | text/date                   | Approval record.                                                                                        |
| createdAt / updatedAt / cancelledAt / deletedAt / softDeleteExpiry | date/time                   | Lifecycle (incl. soft delete).                                                                          |

**Relationships:** Project `many → 1` Purchase, Brand, Agency. Project references a Service/Package (by ID + snapshot) and a contractor/staff assignee. Projects are referenced by Chat Messages, Tasks, Files, and Payout breakdowns.

---

# 9. Finance

## Invoice

**Purpose:** A formal billing document tied to a purchase cycle, between two parties.

| Property            | Type                 | Description                                            |
| ------------------- | -------------------- | ------------------------------------------------------ |
| id                  | ID                   | Unique invoice.                                        |
| purchaseId          | Reference → Purchase | Source transaction.                                    |
| payoutId            | Reference → Payout   | Linked payout, if any.                                 |
| cycle               | number               | Billing cycle number (for recurring).                  |
| commissionType      | text                 | Which commission this invoice represents.              |
| status              | Invoice Status       | unpaid / paid / processing-by-provider / received…     |
| fromParty / toParty | Embedded (objects)   | Payer and payee identity (agency/brand/user/platform). |
| items               | Embedded (list)      | Line items (name, qty, total, options).                |
| createdAt           | date/time            | Issued timestamp.                                      |

**Relationships:** Invoice `many → 1` Purchase; `0..1 → 1` Payout.

## Payout

**Purpose:** Money owed to a beneficiary. The disbursement engine across multiple providers, with line-item traceability.

| Property                               | Type                 | Description                                                         |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------- |
| id                                     | ID                   | Unique payout.                                                      |
| amount / paidAmount                    | number               | Owed and paid-to-date amounts.                                      |
| currency                               | text                 | Currency (default AUD).                                             |
| beneficiaryId                          | Reference → User     | Who is paid, when the payee is a USER. Null for agency payouts. Exactly one of beneficiaryId / beneficiaryAgencyId is set (check `payouts_one_beneficiary`). |
| beneficiaryAgencyId                    | Reference → Agency   | Set when the AGENCY itself receives the money (its own bank account). Null for user payouts. |
| agencyId                               | Reference → Agency   | The SOURCE/owning agency of the services (context) — NOT necessarily the payee. |
| purchaseId                             | Reference → Purchase | Source transaction.                                                 |
| status                                 | Payout Status        | upcoming → pending → processing-by-provider → paid/received/failed. |
| as                                     | Payout As            | admin / owner / staff / contractor / agency.                        |
| sourceBrandName                        | text (snapshot)      | Where the earnings came from.                                       |
| transactionId                          | text                 | Provider transaction reference.                                     |
| breakdown                              | Embedded (list)      | Per-project/role line items (amount, role, GST, week…).             |
| createdAt / toPayAt / completelyPaidAt | date/time            | Scheduling & completion.                                            |

**Relationships:** Payout `many → 1` User (beneficiary) OR Agency (beneficiaryAgencyId), plus source Agency, Purchase. Referenced by Invoices.

---

# 10. Communication

## Chat Thread

**Purpose:** A conversation container, scoped to a relationship/context.

| Property                        | Type                                | Description                                                 |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| id                              | ID                                  | Unique thread.                                              |
| connectionId                    | Reference → Brand–Agency Connection | The relationship context.                                   |
| name                            | text                                | Thread name.                                                |
| type                            | Thread Type                         | group / private / personal / platform-admin / inter-agency… |
| memberIds                       | list of References → User           | Participants.                                               |
| agencyIds / brandId             | References                          | Org context.                                                |
| participantAId / participantBId | References → User                   | The two people in a 1-to-1 thread.                          |
| contractorId                    | Reference → User                    | Contractor participant, if relevant.                        |
| createdBy                       | Reference → User                    | Thread creator.                                             |
| lastMessage / lastMessageAt     | text / date                         | Preview & sort key.                                         |
| unreadCounts                    | map (per user)                      | Unread message count per participant.                       |
| lastReadMessageId               | map (per user)                      | Read position per participant.                              |
| isArchived                      | yes/no                              | Archived state.                                             |
| createdAt / updatedAt           | date/time                           | Timeline.                                                   |

## Chat Message

**Purpose:** An individual message within a thread.

| Property                                                    | Type                      | Description                                |
| ----------------------------------------------------------- | ------------------------- | ------------------------------------------ |
| id                                                          | ID                        | Unique message.                            |
| threadId                                                    | Reference → Chat Thread   | Owning thread.                             |
| senderId                                                    | Reference → User          | Author.                                    |
| senderName / senderAvatar / senderRole / senderBusinessName | snapshots                 | Sender display info captured at send time. |
| content                                                     | text                      | Message body.                              |
| type                                                        | Message Type              | system / text / image / video / document.  |
| fileUrl / fileName / thumbnailUrl / fileSize                | mixed                     | Attachment data.                           |
| readBy                                                      | list of References → User | Who has read it.                           |
| replyToId                                                   | Reference → Chat Message  | Threaded reply target.                     |
| projectId                                                   | Reference → Project       | Linked project, if any.                    |
| timestamp                                                   | date/time                 | Sent time.                                 |

**Relationships:** Thread `1 → many` Message. Thread `many → 1` Connection. Messages reference Users and optionally Projects.

---

# 11. Productivity

## Task

**Purpose:** An action/notification item routed to a user; powers workflow hand-offs.

| Property                                                   | Type                      | Description                           |
| ---------------------------------------------------------- | ------------------------- | ------------------------------------- |
| id                                                         | ID                        | Unique task.                          |
| type                                                       | Task Type                 | The triggering event/action kind.     |
| category                                                   | Task Category             | inbox / todo / completed / archived.  |
| title / description                                        | text                      | Task content.                         |
| assigneeId                                                 | Reference → User          | Owner of the task.                    |
| assignedBy                                                 | text                      | Who/what created it (often "system"). |
| sortOrder                                                  | number                    | Ordering within a column.             |
| relatedEntityId                                            | Reference (polymorphic)   | The record this task concerns.        |
| organizationId / organizationName / agencyName / brandName | Reference + snapshots     | Org context.                          |
| projectId / proposalId                                     | References                | Linked work items.                    |
| visibleTo                                                  | list of References → User | Who can see it.                       |
| disableMailing                                             | yes/no                    | Suppress email notification.          |
| attachments                                                | list                      | Attached files.                       |
| metadata                                                   | structured block          | Type-specific extra data.             |
| createdAt / updatedAt                                      | date/time                 | Timeline.                             |

**Relationships:** Task `many → 1` User (assignee), and references Projects/Proposals/organizations depending on type.

---

# 12. Content & Resources

## Folder

**Purpose:** Organizing structure for files (supports nesting).

| Property           | Type               | Description                  |
| ------------------ | ------------------ | ---------------------------- |
| id                 | ID                 | Unique folder.               |
| name               | text               | Folder name.                 |
| brandId / agencyId | References         | Ownership context.           |
| parentId           | Reference → Folder | Parent folder (for nesting). |
| isPrivate          | yes/no             | Visibility.                  |
| createdBy          | Reference → User   | Creator.                     |
| createdAt          | date/time          | Timeline.                    |

## File

**Purpose:** An uploaded asset (logo, brief, deliverable, document).

| Property                        | Type                 | Description                                                      |
| ------------------------------- | -------------------- | ---------------------------------------------------------------- |
| id                              | ID                   | Unique file.                                                     |
| name / url                      | text                 | Filename and storage URL.                                        |
| brandId / agencyId / folderId   | References           | Ownership & placement.                                           |
| projectId / projectTitle        | Reference + snapshot | Linked project.                                                  |
| uploadedBy / agencyWhoUploaded  | References           | Provenance.                                                      |
| size / type / category / source | mixed                | File metadata (image/doc; logo/brief/deliverable; brand/agency). |
| isPrivate                       | yes/no               | Visibility.                                                      |
| deletedAt                       | date/time            | Soft-delete marker.                                              |
| uploadedAt                      | date/time            | Upload time.                                                     |

**Relationships:** File `many → 1` Folder, Brand, Agency, Project. Folder `1 → many` File and `1 → many` Folder (self-nesting).

## Resource

**Purpose:** Shared template/asset, from the platform (admin) or an agency.

| Property                | Type                          | Description                          |
| ----------------------- | ----------------------------- | ------------------------------------ |
| id                      | ID                            | Unique resource.                     |
| title / description     | text                          | Resource details.                    |
| url / linkUrl           | text                          | File or external link.               |
| categories              | list of text                  | Tags for browsing.                   |
| agencyId                | Reference → Agency (nullable) | Owner agency; empty = platform-wide. |
| uploadedBy              | Reference → User              | Uploader.                            |
| uploadedAt / acceptedAt | date/time                     | Timeline.                            |

---

# 13. Scheduling

## Meeting

**Purpose:** A booked meeting between a brand user and an agency contact, often tied to a service; integrates with Google Calendar.

| Property                                                    | Type                | Description                        |
| ----------------------------------------------------------- | ------------------- | ---------------------------------- |
| id                                                          | ID                  | Unique meeting.                    |
| serviceId                                                   | Reference → Service | Service the meeting is about.      |
| agencyId / brandId                                          | References          | The two organizations.             |
| brandUserId / assigneeUserId                                | References → User   | Attendees (client + agency rep).   |
| serviceName / assigneeName / brandUserName / brandUserEmail | snapshots           | Display details.                   |
| googleEventId / meetUrl                                     | text                | Calendar & video-call links.       |
| status                                                      | Meeting Status      | scheduled / cancelled / completed. |
| startTime / endTime                                         | date/time           | Time window.                       |
| createdAt / cancelledAt                                     | date/time           | Timeline.                          |

**Relationships:** Meeting `many → 1` Agency, Brand, Service, and two Users.

---

# 14. Platform Configuration

## Global Settings (single record)

**Purpose:** Platform-wide defaults controlled by administrators — the economic and taxonomy control panel.

| Property               | Type             | Description                      |
| ---------------------- | ---------------- | -------------------------------- |
| prodeskCommission      | number           | Platform's commission %.         |
| affiliateCommission    | number           | Affiliate/referral commission %. |
| agencyCommission       | number           | Default agency commission %.     |
| salesAgencyCommission        | number           | Default sales commission %.      |
| defaultPaymentPlans    | Embedded (list)  | Default installment schedules.   |
| disciplines / services | lists of text    | Master taxonomy lists.           |
| updatedBy              | Reference → User | Last editor.                     |
| updatedAt              | date/time        | Last change.                     |

---

# Embedded Structures (expanded)

These are structured blocks stored _inside_ their parent record (snapshot/config data read as a unit).

### Proposal / Purchase **Item**

A single line on a quote or order: type (service / heading / custom), description, amount, quantity, the source service ID, recurring flag & billing cycle, upfront fee, optional/excluded flags, the phase it belongs to, selected variant/options/add-ons, package linkage, delivery config, and the per-line commission split. _Snapshots pricing so historical documents stay fixed._

### Project **Deliverable**

A submitted piece of work: content/file, type (text/document/image), who uploaded it and when, a review **status** (pending/approved/rejected), reviewer, rejection reason, and source (brand/agency).

### Project **Revision** & **Note**

Threaded entries with content, attachments, author (id/name/role), timestamp, and source side. Drives the revision loop and internal/client commentary.

### Purchase/Project **Amount**

A structured money breakdown: **recurring** (upfront + weekly-after) and **one-off** (upfront + weekly-after + number-of-weeks) plus a one-off total. Supports mixed one-time + subscription pricing.

### Payout **Breakdown** line

Per source of earnings: project ID, description, purchase ID, commission type, source service name, amount, the role being paid, brand ID, and metadata (brand name, service name, week, GST). _Gives full audit trail for every dollar paid out._

### Service **Variant / Option / Add-on**

- **Option:** a named choice with a list of values (e.g. "Size": S/M/L).
- **Variant:** a specific combination of option values with price differences (one-off & recurring).
- **Add-on:** an optional extra with its own pricing deltas.

### Service **Project Config**

How a purchased service becomes a project: task name, project duration (days), estimated contractor hours, default contractor budget (absolute or %), and minimum term before cancellation.

---

# Relationship summary (at a glance)

| From                    | Relationship             | To                                              |
| ----------------------- | ------------------------ | ----------------------------------------------- |
| User                    | owns (1→many)            | Brand, Agency                                   |
| User                    | member of (many↔many)    | Brand, Agency _(via membership links)_          |
| User                    | has (1→1)                | Contractor                                      |
| User                    | holds (1→many)           | Staff records                                   |
| Brand                   | connected to (many↔many) | Agency _(via Brand–Agency Connection)_          |
| Agency                  | connected to (many↔many) | Contractor _(via Agency–Contractor Connection)_ |
| Agency                  | offers (1→many)          | Service, Package                                |
| Agency                  | sends (1→many)           | Proposal                                        |
| Brand                   | receives (1→many)        | Proposal                                        |
| Proposal                | converts to (1→1)        | Purchase                                        |
| Purchase                | spawns (1→many)          | Project                                         |
| Purchase                | bills via (1→many)       | Invoice                                         |
| Project                 | assigned to (many→1)     | User / Contractor                               |
| Purchase / Project      | generates (1→many)       | Payout                                          |
| Brand–Agency Connection | scopes (1→many)          | Chat Thread                                     |
| Chat Thread             | contains (1→many)        | Chat Message                                    |
| Folder                  | holds (1→many)           | File (and nested Folders)                       |
| Service                 | is subject of (1→many)   | Meeting                                         |

---

_This document describes the data model of the Prodesk platform (rebuild on React + tRPC + Drizzle + Supabase Postgres), at functional parity with the current application. Properties marked "Embedded" or "Snapshot" are design choices that keep historical documents accurate and group always-together data for performance._
