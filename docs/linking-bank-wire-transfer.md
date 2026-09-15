# Linking a Bank Wire Transfer (Wise payouts)

How a user (or agency) links a bank account to receive payouts by **wire transfer**,
which is powered by [Wise](https://wise.com). "Linking" means turning a form full of
bank details into a validated **Wise recipient account** whose id we store; the actual
money movement is a separate flow (§8).

The same UI and server logic back **two** owners:

- **Personal** — a member's own payout account. UI: `client/src/pages/profile/withdraw-methods.tsx`. Server: `server/src/routers/users.ts`.
- **Agency** — the agency's payout account (commissions). UI: `client/src/pages/agency/agency-bank-account.tsx` (reuses the personal page's `WireDialog`/`MethodCard`). Server: `server/src/routers/agencies.ts`.

Shared billing modules: `server/src/modules/billing/wise.ts` (env + thin wrapper) and
`server/src/modules/billing/wise-recipient.ts` (the framework-agnostic resolver core).

> **Canonical-copy warning.** `wise-recipient.ts` is kept **byte-identical** to a copy in
> the Firebase `functions` repo (`functions/src/modules/billing/wise-recipient.ts`). The two
> packages can't share an import. Any change here must be mirrored there; only the import
> path differs (`.js` extension in this ESM package, omitted in `functions`).

---

## 1. The user journey

1. On **Payout Settings** the user picks **Wire transfer → Connect** (or **Update** on an
   already-linked wire method — §6). This opens `WireDialog`.
2. They fill in account holder, bank country, bank name, account number / IBAN, a routing
   code and/or SWIFT, and (when required) a residential address.
3. Client-side `validate()` runs (§5). On submit the form calls the
   `linkWiseRecipient` mutation.
4. The server creates a Wise recipient (§3–4), and on success stores the details +
   `recipientId` and marks the owner payout-ready.

There is also a stubbed **Wise OAuth import** ("Connect with Wise") path that would let a
user pick an existing Wise recipient instead of typing details. It is **disabled** in the
UI and the server endpoints (`getWiseAuthUrl` / `exchangeWiseCode`) return empty/stub
results unless `WISE_CLIENT_ID` / `WISE_CLIENT_SECRET` are configured.

---

## 2. Data model & storage

There is no dedicated table. The linked account lives in the owner row's
`payoutMethods` JSON column (`users.payoutMethods` / `agencies.payoutMethods`):

```jsonc
payoutMethods: {
  wire: {
    accountHolderName, bankName, accountNumber,
    routingNumber, swiftCode, country, accountType,
    address: { firstLine, city, state, postCode, country },
    currency,           // sent as null by the form; Wise resolves it
    recipientId         // the Wise account id, or null in dev (§7)
  }
}
```

Two sibling columns track the active provider:

- `activePayoutMethod` — `'wire'` | `'stripe'` | null. Only **one** method is active at a time.
- `bankAccountLinked` — boolean, set true once a wire (or Stripe) account is linked.

`hasWire` (UI) is derived as `!!wire.bankName && !!wire.accountNumber`.

---

## 3. Server endpoints

All on the `users`/`agencies` tRPC routers (the agency variants take an extra `agencyId`):

| Procedure | Purpose |
|-----------|---------|
| `linkWiseRecipient` | Create the Wise recipient, store `{ ...input, recipientId }`, set `activePayoutMethod='wire'` + `bankAccountLinked=true`. Wise errors are surfaced as `BAD_REQUEST` so the human-readable reason reaches the toast. |
| `validateWireDetails` | Dry-run validation: runs the same `createWiseRecipient` and returns `{ ok, error }` instead of throwing. (Available for pre-save checks; the form currently validates by linking directly.) |
| `setActivePayoutMethod` / `removePayoutMethod` | Switch / disconnect a method. |

`createWiseRecipient` (in `wise.ts`) is the thin wrapper: it reads env, and when Wise is
**not configured returns `null`** (dev still stores details locally). When configured it
delegates to `createWiseRecipient` in `wise-recipient.ts` with `sourceCurrency: 'AUD'`.

---

## 4. How a recipient is resolved (`wise-recipient.ts`)

The core idea: **don't guess Wise's account shape.** We resolve only the target currency,
then ask Wise what fields it needs and map our inputs in. Flow inside `createWiseRecipient`:

### 4.1 Resolve the target currency — `resolveTargetCurrency`
Priority order (never silently defaults to AUD — throws `WiseCurrencyError` if it can't tell):

1. An explicit, non-`AUD` `currency` (AUD is the platform default sentinel, treated as a weak hint).
2. The country prefix of an **IBAN** account number.
3. The selected **bank country** (`CURRENCY_BY_COUNTRY`).
4. The country embedded in the **SWIFT/BIC** (chars 5–6).
5. Explicit `AUD`, else throw.

### 4.2 Ask Wise what it needs — `fetchAccountRequirements`
`GET /v1/account-requirements?source=AUD&target=<currency>&sourceAmount=1000` with
`Accept-Minor-Version: 1`. Returns the list of account **types** and their required fields.

> **Dependent fields (the two-step refresh).** Wise hides some required fields until
> you echo back the value they depend on, flagging the trigger field with
> `refreshRequirementsOnChange: true`. The canonical case is **US `address.state`**: the
> first GET response doesn't mention it at all, and its `valuesAllowed` list only appears
> once `address.country: "US"` is **POSTed back** to `/v1/account-requirements`. So after
> picking the type we re-`POST` the partial `details` and re-map our inputs into the
> newly-revealed fields, iterating until the field set stops growing (Wise's documented
> guidance). Skipping this is why a correctly-filled state was still rejected with
> "address.state: Please enter a state" — state was simply never in the requirements we
> mapped against, so it was never sent.

### 4.3 Map our inputs — `buildCandidates`
Builds a case-insensitive dictionary of every key Wise might ask for. **The key names must
match Wise's spec exactly** ([recipient field reference](https://github.com/transferwise/api-docs/blob/master/source/includes/reference/_recipients.md)):

| Our input | Wise key(s) we populate | Used by type |
|-----------|-------------------------|--------------|
| account number | `accountNumber`, plus `IBAN` if IBAN-shaped | all / `iban` |
| SWIFT/BIC | `bic`, `swiftCode` | `swift_code` |
| routing number | `sortCode` (GBP), **`bsbCode`** (AUD), `abartn` (USD ABA), `bankCode` (SGD…), `routingNumber` | local types |
| routing number (CA, 9-digit) | `institutionNumber` + `transitNumber` (split) | `canadian` |
| account type | `accountType` | `aba`, `canadian` |
| address | `address.firstLine`, `address.city`, `address.state`, `address.postCode`, `address.country` | `aba` + many SWIFT/USD/PHP/THB/TRY |
| (always) | `legalType: 'PRIVATE'`, `accountHolderName` | all |

`fillRequirement` matches each Wise field against this dictionary. When a field has a
`valuesAllowed` list (e.g. `accountType`, US/CA `address.state`), we resolve the user's
value against the entry **key *and* name**, case-insensitively, and send the canonical key
— so `CA`, `ca`, and `California` all map to `CA`.

### 4.4 Choose the type — `selectRecipientType`
Scores each candidate type by how many required fields we can fill (fewer missing = better),
then by a structural preference (IBAN → an iban type +3; a present BIC → a swift type +2).

> **Domestic rule.** When the payout is **domestic** (the recipient bank country is the home
> country of the resolved currency, e.g. USD→US, AUD→AU), Wise forbids SWIFT rails. If any
> non-SWIFT local type exists for the currency we **drop the SWIFT types** entirely. This
> forces e.g. `aba`/`australian`, and if a required field is missing we raise a clear
> "Missing bank details…" error instead of letting Wise reject an invalid SWIFT recipient.

### 4.5 Create — `POST /v1/accounts`
`{ profile, accountHolderName, currency, type, details }`. On success returns the recipient id.
Non-2xx bodies are parsed into a readable `Error` (Wise's per-field messages, joined).

---

## 5. Client-side validation (`WireDialog.validate`)

Catches the common Wise rejections before a network call:

- Account holder ≥ 2 chars; account number 4–34 chars, alphanumeric/space/dash.
- SWIFT (if given) matches `^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$`.
- **AU**: BSB required, exactly 6 digits.
- **US**: ABA routing required, exactly 9 digits (SWIFT can't substitute — it's domestic).
- **CA**: routing required, 8–9 digits (institution + transit).
- Either a SWIFT **or** a routing code is required.
- **Address** required when the bank is US/CA **or** a SWIFT is present. Within it, **State /
  Province is required whenever the address block shows**; for US/CA it must be the **2-letter
  code** (e.g. `CA`, `NY`, `ON`) — Wise validates US/CA state against a fixed list.

The address `state` is upper-cased to the canonical 2-letter code for US/CA on submit.

---

## 6. Editing an existing wire account

An active wire method shows **Disconnect** and **Update**. **Update** reopens `WireDialog`
pre-filled from the stored record (`initial={pm.wire}`) and re-links on save (the dialog
title switches to "Update Bank Wire Transfer"). Switching providers always confirms first
and disconnects the old one.

---

## 7. Environments & configuration

`wise.ts` selects the Wise base URL by `NODE_ENV`:

- production → `https://api.transferwise.com`
- anything else → `https://api.sandbox.transferwise.tech`

| Env var | Meaning |
|---------|---------|
| `WISE_API_TOKEN` | Bearer token. **Must match the environment** (a sandbox token against the prod base, or vice-versa, fails auth). |
| `WISE_PROFILE_ID` | Wise profile that owns the recipients. |
| `WISE_STRIPE_CONNECT_ACCOUNT_ID` | Stripe Connect account used to fund the Wise balance (§8). |
| `WISE_CLIENT_ID` / `WISE_CLIENT_SECRET` | OAuth import (optional; disabled by default). |

**Dev without Wise:** if `WISE_API_TOKEN` or `WISE_PROFILE_ID` is unset, `createWiseRecipient`
returns `null` — the bank details are stored with `recipientId: null` and no network call is
made, so the rest of the UI works locally.

> Sandbox rejects real-world bank data (e.g. a real BSB can come back "not found"). Test with
> Wise's published sandbox values, and confirm prod runs `NODE_ENV=production` with a live token.

---

## 8. After linking: how payouts actually send (pointer)

Linking only creates the recipient. Sending money is funded through Stripe in
`wise.ts` and runs in three legs:

1. **1a** Stripe transfer: platform balance → Wise's Stripe Connect account.
2. **1b** Stripe payout: connected account → its linked bank (the Wise account), tagged `purpose=wise-funding`.
3. **2** Wise transfer: Wise balance → the recipient (`payViaWise`, using the stored `recipientId`), triggered by the Stripe `payout.paid` webhook.

See `server/src/modules/billing/wise.ts` and the parity notes in
[`docs/parity/09-earnings-profile.md`](parity/09-earnings-profile.md).

---

## 9. Troubleshooting (real bugs this feature has hit)

| Wise / app error | Cause | Fix in place |
|------------------|-------|--------------|
| `swiftCode: …can't send USD via Swift to accounts inside the United States` | A SWIFT type was chosen for a domestic account. | Domestic rule (§4.4) drops SWIFT when a local type exists. |
| `address.state: Please enter a state` | Wise hides `address.state` until `address.country` is echoed back (`refreshRequirementsOnChange`), so a single GET never includes it and the state — even when filled — was never sent. | Two-step requirements refresh (§4.2) re-POSTs the details to reveal state, then `valuesAllowed` name→key resolution (§4.3) maps it; client also requires the 2-letter code (§5). |
| Missing / not-found **BSB** for an AU account | BSB mapped to the wrong key (`bsb` instead of Wise's `bsbCode`). | `buildCandidates` now sets `bsbCode` (§4.3). |
| `Could not determine the payout currency…` | None of the currency signals matched (§4.1). | Ask the user for the account currency / correct the bank country. |
| `Missing bank details required by Wise…` | The chosen local type needs a field we don't have (routing, address state). | Surface to the user — collect the field; don't fall back to SWIFT. |

Regression tests for the type selection, BSB key, and state resolution live in
`server/src/modules/billing/wise-recipient.test.ts`.
