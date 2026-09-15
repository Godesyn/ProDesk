# Invoices — Single Source of Truth

This document defines what **invoice documents** a purchase emits, who the payer
(`fromParty`) and payee (`toParty`) are on each one, the amount each carries, when it
is written, and which payout it links to. It is the canonical reference for any work
touching the invoice ledger, the invoices router, or the tax-invoice PDF. If code and
this document disagree, treat the discrepancy as a bug and reconcile here.

> **Invoices are NOT payouts.** A **payout** is one disbursement to one beneficiary's
> bank account (see `commissions.md`). An **invoice** is a _document recording a
> transaction between two parties_ — a payer and a payee — for the tax/accounting
> ledger. The split **percentages** live in `commissions.md`; this file is about the
> **documents** those amounts are written onto and the **direction** money flows.

> This document is the spec **and** matches the current code — the collector model and
> payout-derived status are implemented (see **§8. Implementation status**). If code and
> this document ever disagree, fix the code to match the document, not the reverse.

**Code that implements this:**

- Invoice drafts: `server/src/modules/billing/fulfillment.ts` → `computePayoutSplit`
  (the `inv(...)` helper and the legs, ~lines 850–1003).
- Persistence: `server/src/modules/billing/fulfillment.ts` → `runPayoutSplit`
  (`db.insert(invoices)` + `invoice_items`, ~lines 1146–1172).
- Party resolution (read-time): `server/src/modules/billing/invoice-parties.ts`.
- Schema: `server/src/db/schema.ts` → `invoices` / `invoiceItems` (lines 1156–1195).
- Display number: `formatInvoiceNumber` (`#INV_0001`).

This is the web port of the Flutter `invoices_calculator.getInvoicesByProjectAndCycle`
(which legs are emitted per cycle) and `InvoiceService.invoiceItemToServiceUser`
(read-time party resolution).

---

## 0. Directional rounding — charge UP, pay out DOWN

Every invoice total mirrors the directional rounding of the money it records (same
rule as `commissions.md` §0):

- The **brand charge** invoice is a collection → its total rounds **UP**
  (`roundChargeUp`), passed as `kind: 'charge'`.
- **Every commission invoice** is a disbursement obligation → its total rounds
  **DOWN** (`roundPayoutDown`), the default `kind: 'payout'`.

`inv()` rounds, then **drops any invoice whose rounded total ≤ 0**. A leg with no
eligible amount is silently not written.

---

## 1. The core model — the "collector"

The whole topology turns on one question: **who collects the brand's money?** That
party is the **collector**, and it is the merchant of record on the brand-facing
invoice. Every other party then settles against the collector — either the collector
invoices them, or they invoice the collector.

> **Collector = the distinct sales-earning agency if one exists, otherwise Prodesk.**
> A sales-earning agency exists when the order was sold by an agency that is **not**
> the producing agency: a proposal sent by a different agency, or a brand whose
> `referredByAgencyId` points at a different agency. If the producing agency sold its
> own service (self-sent proposal), or there is no sales agency at all (plain
> marketplace), **Prodesk is the collector.**

Once the collector is fixed, the rules are mechanical:

1. **Collector → Brand**, full gross, **PAID**. (The cash was already taken at checkout.)
2. The **producing agency** always invoices the **collector** for its retained share
   (its agency cut after the sales cut is removed).
3. **Prodesk reconciles with the collector:**
   - If the collector is a **sales agency** → **Prodesk invoices the collector** for
     Prodesk's own cut **plus the affiliate's cut** (Prodesk is the one who pays the
     affiliate). The sales agency keeps its own sales cut by simply not being invoiced
     for it.
   - If the collector is **Prodesk** → no such invoice; Prodesk already holds the cash
     and keeps its share after paying everyone else.
4. The **affiliate** (when one exists) invoices **Prodesk** for the affiliate cut.
5. The producing agency's **staff designees and any contractor** invoice the
   **producing agency** — their cuts are carved out of the agency's retained share.

---

## 2. The invoice data model

`invoices` (`schema.ts:1156`) — one row per transaction document:

| Field            | Type             | Meaning                                                                                 |
| ---------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `id`             | uuid             | PK.                                                                                     |
| `number`         | int (identity)   | Global monotonic sequence shared across **all** invoice types; rendered `#INV_0001`.    |
| `purchaseId`     | uuid → purchases | The source transaction.                                                                 |
| `payoutId`       | uuid → payouts   | The payout this invoice settles (nullable — see §6).                                    |
| `cycle`          | int (default 0)  | Billing cycle the invoice belongs to (`opts.week`); recurring/reimbursement cycles > 0. |
| `commissionType` | text (nullable)  | Which cut this invoice represents; `null` for the brand charge.                         |
| `fromIsProdesk`  | boolean          | }                                                                                       |
| `fromAgencyId`   | uuid → agencies  | } Exactly one of these is set per party — enforced by `*_one_party` CHECKs.             |
| `fromBrandId`    | uuid → brands    | } Together they identify the payer (`from`) and payee (`to`).                           |
| `fromUserId`     | uuid → users     | }                                                                                       |
| `toIsProdesk`    | boolean          | }                                                                                       |
| `toAgencyId`     | uuid → agencies  | }                                                                                       |
| `toBrandId`      | uuid → brands    | }                                                                                       |
| `toUserId`       | uuid → users     | }                                                                                       |
| `total`          | money            | The invoice amount (rounded per §0).                                                    |

`invoiceItems` (`schema.ts:1182`) — line items; today exactly **one per invoice**,
`qty: 1`, `totalPrice == invoices.total`, carrying the `serviceName`, package, and the
buyer's `selectedOptions` / `selectedAddons` for display.

---

## 3. Party references & read-time resolution

`fromParty` / `toParty` store a **compact reference**, not a frozen identity — one of
four mutually-exclusive shapes (`InvoicePartyRef`):

| Ref shape             | Party                                    |
| --------------------- | ---------------------------------------- |
| `{ isProdesk: true }` | The platform (Prodesk).                  |
| `{ agencyId }`        | An agency.                               |
| `{ brandId }`         | A brand (the buyer).                     |
| `{ userId }`          | A user (staff / affiliate / contractor). |

At **creation** the brand's business name is denormalised onto the ref (`brandName`)
as a render fallback, but identities are **resolved lazily at read time** in the
invoices router via `buildPartyResolver` / `resolveParties` (`invoice-parties.ts`):

- `isProdesk` → the constant `PRODESK_IDENTITY`.
- `agencyId` → prefers `legalName`, falls back to `businessName` (tax-invoice parity).
- `brandId` → `businessName`, else the stamped `brandName`.
- `userId` → `firstName + lastName`, else email.

> **Why resolve at read time?** So existing invoices render correctly without a
> backfill, and edits to an agency/brand/user profile flow through to how their past
> invoices display. Parity with the Flutter app (resolves parties at PDF-render time).

---

## 4. Invoice numbering & display

`number` is `generatedByDefaultAsIdentity()` — one Postgres sequence shared across
**every** invoice regardless of type (parity with the Flutter `counter/global.invoice`
counter). `formatInvoiceNumber(n)` renders it `#INV_${n.padStart(4,'0')}` → `#INV_0001`.

---

## 5. The scenarios (one $100 one-off item; rates 50 / 30 / 13 / 7)

These are the three shapes the collector model produces. Amounts use the seeded
defaults from `commissions.md` §1.

> **Initial status is NOT uniform.** The brand-charge leg is always **`paid`** — the
> money was already collected at checkout (and it has no payout link). Every other leg
> derives its status from the linked payout (§7). Don't assume a new invoice is `unpaid`.

### Scenario A — a distinct sales / referred-by agency exists (sales agency = collector)

The sales agency (proposal sender, or the brand's `referredByAgencyId`) sold a service
owned by a **different** producing agency.

| #   | From (issuer)               | To                   | Total           | `commissionType`        | Notes                                                                                |
| --- | --------------------------- | -------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| 1   | **Sales agency**            | Brand                | $100            | `null`                  | Full gross; sales agency is merchant of record.                                      |
| 2   | **Prodesk**                 | Sales agency         | $20             | Prodesk + affiliate cut | Prodesk bills the collector for its 13 **plus** the 7 it must pass to the affiliate. |
| 3   | **Affiliate user**          | Prodesk              | $7              | `affiliateCommission`   | **Only if an affiliate exists.** Prodesk pays it out of the 7 it collected in #2.    |
| 4   | **Producing agency**        | Sales agency         | $50             | `agencyOwnerCommission` | The producing agency's retained 50% (owner + staff combined).                        |
| 5   | Staff designee / contractor | **Producing agency** | carved from $50 | per role (§6)           | Each distinct staff cut + contractor fee, billed to the producing agency.            |

**Net:** sales agency keeps **$30** (collected $100 − $20 to Prodesk − $50 to producing
agency); Prodesk nets **$13**; affiliate **$7**; producing agency **$50**.

> If there is **no** affiliate, invoice #3 is dropped and Prodesk keeps the full $20
> from #2 (the affiliate's 7 folds into Prodesk's remainder — `commissions.md` §4).

### Scenario B — no sales agency (plain marketplace, Prodesk = collector)

The brand has **no** `referredByAgencyId` and there is no proposal.

| #   | From (issuer)               | To                   | Total           | `commissionType`        | Notes                          |
| --- | --------------------------- | -------------------- | --------------- | ----------------------- | ------------------------------ |
| 1   | **Prodesk**                 | Brand                | $100            | `null`                  | Prodesk is merchant of record. |
| 2   | **Affiliate user**          | Prodesk              | $7              | `affiliateCommission`   | Only if an affiliate exists.   |
| 3   | **Producing agency**        | Prodesk              | $50             | `agencyOwnerCommission` | Retained 50% (owner + staff).  |
| 4   | Staff designee / contractor | **Producing agency** | carved from $50 | per role (§6)           | As in Scenario A.              |

**Net:** Prodesk keeps **$43** ($100 − $50 − $7) = its 13 + the unclaimed 30 sales cut
that folds into Prodesk when no sales agency is present.

### Scenario C — producing agency self-sent the proposal (Prodesk = collector)

The agency that owns the service is also the proposal sender. It keeps the sales **and**
affiliate cuts; the affiliate is suppressed entirely (`commissions.md` §4, Scenario 2).

| #   | From (issuer)               | To                   | Total           | `commissionType`        | Notes                                    |
| --- | --------------------------- | -------------------- | --------------- | ----------------------- | ---------------------------------------- |
| 1   | **Prodesk**                 | Brand                | $100            | `null`                  | Prodesk is merchant of record.           |
| 2   | **Producing agency**        | Prodesk              | $87             | `agencyOwnerCommission` | 50 + freed 30 sales + freed 7 affiliate. |
| 3   | Staff designee / contractor | **Producing agency** | carved from $87 | per role (§6)           | As above.                                |

**Net:** Prodesk keeps **$13**; producing agency **$87**. No affiliate invoice.

---

## 6. Sub-invoices to the producing agency (designees & contractor)

> ⚠️ **The agency owner (a user) is never a party and never gets a payout.** Every cut
> that belongs to "the agency" — including the one whose `commissionType` is
> `'agencyOwnerCommission'` — is paid to the **agency entity** (`beneficiaryAgencyId`,
> `as: 'agency'`, into the agency's own bank account) and invoiced **to/from the agency
> id**, never to `agency.ownerId`. The word "owner" in the commission-type name is
> historical; it does **not** mean the owner user receives anything. `agency.ownerId`
> appears in the code only as a **comparison** — "is this designee a distinct person, or
> is it just the agency itself?" — not as a payee.

The producing agency's retained share (the $50 / $87 above) is itself carved up. Each
**distinct** staff member or contractor — i.e. a designee that is **not** the agency
itself (`designee !== agency.ownerId`) — issues an invoice **to the producing agency**
for their slice:

| Sub-invoice (From → To)               | Amount             | `commissionType`                | Emitted when                                |
| ------------------------------------- | ------------------ | ------------------------------- | ------------------------------------------- |
| Briefing manager → producing agency   | `briefingAmt`      | `'briefingManagerCommission'`   | `briefingDesignee && ≠ owner`               |
| Internal approval → producing agency  | `approvalAmt`      | `'internalApprovalCommission'`  | `approvalDesignee && ≠ owner`               |
| Production manager → producing agency | `productionAmt`    | `'productionManagerCommission'` | `productionDesignee && ≠ owner`             |
| Salesperson → producing agency        | `salesPersonAmt`   | `'salesPersonCommission'`       | `salesPersonId && ≠ owner`                  |
| Contractor → producing agency         | `contractorBudget` | (contractor fee)                | project with a contractor enters production |

When a cut is redirected to the agency (its `redirect…ToBankAccount` flag is on, or no
designee is assigned), **no separate sub-invoice is written** — that money stays inside
the agency's retained share, paid to the agency entity. See `commissions.md` §7 for the
redirect flags and the contractor-fee deduction.

### Which payout each invoice links to (`payoutId`)

**Every commission invoice links to the payout that settles that exact commission** —
the invoice is the document, the payout is the disbursement, and `payoutId` ties them
together. Only the brand charge has no payout (it is a collection, not a disbursement).

| Invoice                                                     | Links to the payout for…                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Brand charge (collector → brand)                            | — none; a collection, not a disbursement.                                                                                         |
| **Producing agency → collector** (retained share)           | the `agencyOwnerCommission` payout — paid to the **agency entity** (`beneficiaryAgencyId`, `as: 'agency'`), never the owner user. |
| **Briefing manager → producing agency**                     | the **briefing-manager commission** payout.                                                                                       |
| **Internal approval → producing agency**                    | the **internal-approval commission** payout.                                                                                      |
| **Production manager → producing agency**                   | the **production-manager commission** payout.                                                                                     |
| **Salesperson → producing agency**                          | the **salesperson commission** payout.                                                                                            |
| **Contractor → producing agency**                           | the **contractor-fee** payout.                                                                                                    |
| **Affiliate → Prodesk**                                     | the **affiliate commission** payout.                                                                                              |
| Prodesk ↔ collector reconciliation (Prodesk → sales agency) | the **Prodesk (platform) commission** payout (its affiliate portion is reconciled by the affiliate's own invoice above).          |

> **Implementation note.** `runPayoutSplit` inserts payouts first, then resolves each
> invoice's `payoutId` from a `payoutByBeneficiary` map keyed `${beneficiaryId}:${projectId}`.
> The key is the payout's single beneficiary — **a user OR an agency** (`beneficiaryId ??
beneficiaryAgencyId`) — so the designee, contractor, affiliate **and** agency-owner
> invoices all link to their settling payout. The Prodesk↔collector reconciliation
> invoice links via the super-admin's Prodesk payout. Only the brand charge stays
> `null` (no payout).

---

## 7. Emission gating & status lifecycle

### Each invoice is written exactly once over the lifecycle

A purchase splits across multiple runs (fulfilment, each recurring weekly cycle, the
payment-plan reimbursement cycle). Each invoice must be written **once**, on the run
that pays that cut — mirroring the Flutter `invoices_calculator`, where priority
commissions are zeroed on cycles ≥ 5 so their invoices never regenerate. Three flags
gate emission (the same per-item `tier` that gates payouts):

| Flag                      | Value                    | Gates                                   |
| ------------------------- | ------------------------ | --------------------------------------- |
| `emitBrandInvoice`        | `!opts.reimbursement`    | The brand charge.                       |
| `emitPriorityInvoices`    | `tier !== 'nonPriority'` | Producing-agency retained + designees.  |
| `emitNonPriorityInvoices` | `tier !== 'priority'`    | Sales/affiliate/Prodesk reconciliation. |

Consequences: the brand charge is not re-emitted on a reimbursement cycle; a
payment-plan one-off emits its sales/affiliate legs once, at the reimbursement cycle; a
recurring **setup fee** splits across all legs at fulfilment (`tier: 'all'` per item —
`commissions.md` §2b). Without this gating a payment-plan purchase duplicated the brand
and agency invoices on every cycle. Guarded by `fulfillment.integration.test.ts`.

### Status is DERIVED from the linked payout — there is no stored column

There is **no `status` column** on the `invoices` table. An invoice's effective status
is computed at read time from its linked payout:

- **Brand charge** (no payout) → always **`paid`** (the cash was collected at checkout).
- **Every commission invoice** → the **linked payout's status**, mapped onto the invoice
  status values. The payout's three pre-settlement states (`upcoming` / `pending` /
  `failed`) collapse to **`unpaid`**; the rest map 1:1.

The possible derived status values are: `unpaid` / `paid` / `dispatched` / `processing` /
`processingByPaypal` / `processingByWire` / `processingByStripe` / `received` / `stopped`.

`stopped` is the one that is easy to get wrong. A stopped payout has been deliberately
taken out of circulation and will never settle, so its invoice is **closed**, not
`unpaid` — `unpaid` means the money is still coming. The map in `invoice-parties.ts`
must therefore carry an entry for **every** `payout_status` value: its `?? 'unpaid'`
fallback turns any omission into a silent misreport rather than an error. A unit test
(`invoice-status.test.ts`) fails when a new payout status is added without one.

The read layer (`routers/invoices.ts`) does this in two forms: `deriveStatus()` for
single invoices (`byId`, `pdf`) and a `derivedStatusSql` `CASE` for the `list` query (so
the status **filter** and the returned value both reflect the payout).

> **Why derived, not stored?** A stored status column would need to be kept in sync with
> every payout status transition — a dual-write that can drift. Deriving at read time
> removes that failure mode entirely. This is also why §6 requires _every_ commission
> invoice to link a payout via `payoutId`.

---

## 8. Implementation status

The collector model (§1–§6) and payout-derived status (§7) are **implemented**:

- `computePayoutSplit` (`fulfillment.ts`) emits the brand charge from the **collector**
  (`salesBeneficiaryAgencyId` → that agency, else Prodesk), the producing-agency→collector
  retained leg **always** (linked to the agency-owner payout via `payoutBeneficiaryId =
agency.id`), the designee legs, the **Prodesk→collector reconciliation** leg
  (`prodeskCommission` = `prodeskAmt + affiliateAmt`, only when a sales agency is the
  collector), and the affiliate leg. The old `agencySalesCommission` **invoice** leg is
  gone (the sales agency keeps its cut as the collector); `agencySalesCommission` still
  exists as a **payout** breakdown.
- `runPayoutSplit` keys `payoutByBeneficiary` by `beneficiaryId ?? beneficiaryAgencyId`,
  so the agency-owner invoice links its payout.
- The `invoices.status` column has been **dropped** (migration `0012`). All status
  derivation is handled at read time by `routers/invoices.ts`.
- Invoice parties use typed FK columns (`from_user_id`, `from_agency_id`, etc.) with
  `*_one_party` CHECK constraints — the old `from_party` / `to_party` JSON was dropped
  in migration `0011`.

Guarded by `fulfillment.integration.test.ts` (collector legs per scenario, the $40
reconciliation leg, agency-owner `payoutId` linkage). If you change a leg's direction or
amount, update §1–§6 here first, then the code and tests.
