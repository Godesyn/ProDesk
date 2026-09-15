# KEYMASTR — Design Spec

The Prodesk password vault (`clients/passwords`, port 5183). Product name
**KEYMASTR**; the codebase calls it `passwords` everywhere (workspace name, client
id, permission keys, routes).

This document is the complete specification. The frontend in this directory is a
**static skeleton** — every screen is built and navigable against mock data in
`src/data/mock.ts`. There is no `passwords` backend module yet, no encryption yet.
This file is what turns the skeleton into the product.

---

## 1 · Where this sits in the market

| Segment | Who | What they get right | What they leave open |
| --- | --- | --- | --- |
| Horizontal consumer→enterprise | 1Password, Bitwarden, Dashlane, NordPass, Proton Pass, Keeper | Autofill, device sync, passkeys, price | The org chart is yours to build and yours to tear down. Sharing outside the company is a bolt-on. |
| Agency / MSP niche | Hypervault, Passwork, TeamPassword, All Pass Hub | Client-scoped vaults, free external collaborators, data templates | Thin design, no governance artefacts, still a filing cabinet you maintain by hand |
| Developer secrets | Doppler, Infisical, HashiCorp Vault | Rotation, environments, CI injection | Not for humans. A marketing manager will never open one. |

**The gap.** Every one of them has the same hardest problem — *who is this person,
which client do they work on, and what happens the day they leave* — and every one
of them makes you answer it manually.

**Our position.** KEYMASTR is the only vault that **already knows the org chart.**
It lives inside Prodesk, which already holds brands, agencies, staff, per-tool
permissions, projects and invoices. Brands, people and the relationships between
them are tables we already own. So the two operations that define the category —
**provisioning** and **de-provisioning** — are free here and expensive everywhere
else.

Three consequences we design around:

1. **Zero-setup.** A brand exists → its vault exists. Staff joins → they inherit the
   right access. Staff leaves → access revokes and the exposed keys queue themselves
   for rotation. Nobody builds a tree by hand and nobody has to remember to burn it down.
2. **Two-sided by construction.** Agency and brand are both first-class tenants with
   an existing relationship. So we can ship the thing nobody ships: **the client can
   see exactly what their agency can see**, live, in plain English, from their own side.
3. **Access, not just passwords.** For platforms where sharing a password is actively
   harmful — Meta Business Manager and Google Ads flag cross-country logins as fraud —
   the right answer is a *delegated grant*, not a stored secret. KEYMASTR models both
   and steers to the safer one. That is the difference between a password manager and
   an **access manager**, and it is the actual job an agency has.

### The one security claim worth making loudly

In February 2026, ETH Zürich researchers showed that Bitwarden, LastPass and Dashlane
enterprise recovery flows fetch a recipient's public key from the server **without
authenticating it** — a malicious or compromised server can substitute its own key and
be handed the vault. KEYMASTR shows the recipient's **key fingerprint as a six-word
phrase** at every first share and requires one confirmation. *We show you the key.
They can't swap it.* This is a real, checkable, competitor-shaped differentiator, and
§10 makes it a designed screen rather than a whitepaper footnote.

---

## 2 · Design thesis

Logo Studio's doctrine is _"Great marks are born in black & white. Colour is a
decision."_ KEYMASTR wears the **same kit** and mirrors the doctrine:

> ### The secret stays dark. The access is glass.

Every competitor has this backwards. They are casual about **secrets** — an eye
icon, one click, plaintext on screen indefinitely, no record — and opaque about
**access**, which is buried in an admin console nobody opens.

We invert both:

- **Secrets are dark by default and never the fast path.** Copying is one click and
  the clipboard self-clears. *Revealing* is deliberate, time-boxed, and recorded.
- **Access is glass.** Who can open what, who did open it, and what breaks if they
  leave is the most visible, best-designed thing in the product.

### The pigment doctrine — colour means exposure

Logo Studio rations the Forest accent to moments of **commitment**. KEYMASTR rations
the identical accent to moments of **exposure**:

> **Pigment appears if and only if something is open right now.**

A revealed field, a live Send link, a running TOTP, a temporary grant, a break-glass
session. At rest the entire app is achromatic ink-on-paper. When colour appears,
something is exposed — and **the colour drains away as the exposure closes.** One
rule, learned in three seconds, that makes every screen readable at a glance.

There is exactly one other colour, `--alarm` (oxide red), rationed harder still:
**irreversible or compromised**, nothing else. Revocation, breach, break-glass.

### Signature element — the Aperture

The reveal control, and the app's whole motif. Not an eye toggle.

A 28px ring. **Press and hold** (350ms) — the ring fills with pigment clockwise. On
completion the secret unmasks with a 180ms left-to-right character resolve, and the
ring immediately begins to **drain counterclockwise over 20 seconds**. At zero the
secret re-masks itself. Release early and it snaps back to dark; nothing is revealed
and nothing is logged.

The hold is not friction theatre — it makes accidental reveal (shoulder-surfing, a
stray click in a screen-share) structurally impossible, and it gives the act of
revealing the weight it deserves.

**The same ring is the entire visual vocabulary of time-boxed exposure:**

| Where | What it drains |
| --- | --- |
| A revealed field | 20s until re-mask |
| A TOTP code | the 30s window |
| A copied secret | 45s until the clipboard self-clears |
| A Send link | hours/days until expiry, and opens remaining |
| A temporary access grant | days until it lapses |
| A break-glass session | minutes until it slams shut |

Six mechanisms, one shape. A user who learns the ring once has learned the security
model.

### Signature screen — the Access Map

A bipartite ledger: **people** left, **keys** right, hairlines between. Readable as a
sentence, filterable from either side, exportable as a one-page dated statement, and
viewable **from the client's side**. This is the artefact that wins the deal and the
thing no competitor has.

### The register

The valuable output of this product is not a picture, it is a **record**. So the
specimen frame Logo Studio wraps around marks, KEYMASTR wraps around **ledgers** —
corner ticks, mono tabular figures, hairline rules. An exit certificate, an access
statement and an audit export are all designed objects, not CSV dumps.

---

## 3 · Materials (inherited from Logo Studio, unchanged)

Deliberately the **same kit** so the two apps read as siblings from one house.

- **Type** — Inter Tight (display + UI, 800 / tight tracking), Instrument Serif
  italic (`.quill`, one editorial accent per screen), JetBrains Mono (`.spec`
  labels and *every* number: counts, timestamps, fingerprints, TOTP).
- **Surface** — warm Bone paper stage `--stage #F3F1EA`, Graphite ink rail `#0E0E0C`,
  card `#FBFAF6`, hairline rules at 8% / 14% ink.
- **Pigment** — `var(--color-accent)` (Forest), never overridden; runtime accent stays
  white-labellable.
- **Alarm** — `--alarm: #A6402F` (oxide). New to this app. Irreversible/compromised only.
- **Motion** — `rise` (entrances), `pop` (menus, commit bars), plus KEYMASTR's own
  `drain` (the ring) and `unmask` (character resolve). All respect
  `prefers-reduced-motion`; reduced motion drops the drain animation but **keeps the
  timer** — the secret still re-masks, it just doesn't animate.

Everything bespoke is scoped under `.km-ui`, exactly as Logo Studio scopes `.logo-ui`,
so the shared auth / onboarding / profile pages keep the stock theme. The side panel
is themed by `.psp-theme-keymastr` on top of the shared `psp-ink` dark-rail contract.

### KEYMASTR's additions to the kit

| Class | What it is |
| --- | --- |
| `.aperture` | the drain ring |
| `.masked` | the mask. **Monospace slab, identical width to the revealed value**, so unmasking causes zero layout shift — the single most-missed craft detail in this category |
| `.ledger` | tabular-mono rows, hairline rules, hover lift |
| `.tie` | access-map connector |
| `.stamp` | the dated seal on certificates and statements |

---

## 4 · Information architecture

KEYMASTR is a **user-level** frontend (like `clients/design`): no brand dropdown in
the panel, a plain Profile row above the exit row. The user's whole working life spans
brands, so the vault must too — a switcher would make the cross-brand screens
(Access map, Health, Offboarding) impossible to build.

Brand scoping does not disappear; it moves into the **content**. Every item belongs to
exactly one brand, every screen carries a brand filter, and `useActiveContext` still
supplies the brand list and permissions.

```
/                    Keyring        — cross-brand home; the brand board
/vault               Vault          — every item, every brand, the dense ledger
/b/:brandId          Brand vault    — one brand's keys, people and health
/item/:id            Item sheet     — the specimen sheet for one key
/access              Access map     — people ↔ keys, both sides, trim-to-used
/health              Watchtower     — hygiene, framed as risk not scolding
/send                Send           — outbound one-time share, no account needed
/intake              Intake         — inbound credential request (the agency wedge)
/offboarding         Exit           — blast radius, rotation queue, exit certificate
/register            Register       — the audit ledger
/team                Team           — scoped `passwords` permission panel
/trust               Trust          — the security model, as a screen
/billing             Billing        — feature subscription + seats
/support             Support        — native screen, shared data layer
/profile             Profile        — native account screen

Public (pre-auth, matched before every gate — mirrors logo's PublicGuidelines):
/s/:token            Send recipient — receive a secret without an account
/i/:token            Intake form    — supply credentials without an account
```

**Panel groups**

```
Vault        Keyring · Vault · Access · Health
Share        Send · Intake
Governance   Offboarding · Register
Account      Team · Trust · Billing
tail         Support
identity     Profile
```

---

## 5 · Screens

### 5.0 · Keyring — home (`pages/Keyring.tsx`)

**Job:** in three seconds, know what needs you today and where everything lives.

**Layout.** Attention strip → split hero → brand board → recent activity.

**Attention strip.** Pinned above the hero, only when non-empty. Horizontal row of
at most four **action chips**, ranked by consequence, each one gesture from done:
`2 people left · rotate 9 keys` (alarm), `Bellweather's DNS password is 3 years old`,
`Priya hasn't opened 11 of her 14 keys — trim?`, `Intake for Northwind: 6 of 9 supplied`.
Empty state is a full-width hairline and one `.quill` line: *"Nothing needs you.
Everything is where it should be."* — the reward state a security tool never gives you.

**Hero.** Left: mono eyebrow `YOUR KEYRING`, a `text-display` headline —
`147 keys across 6 brands` with the count in tabular mono and `brands` set in the
Forest `.quill` — a lede, and the primary action **Find a key ⌘K**. Three stats:
Keys / **Health 82** in pigment / People.

Right: **the keyring specimen.** On the blueprint grid inside a ruled frame with
corner ticks — the brands rendered as a fan of keys on a ring, each key's bit-pattern
derived deterministically from the brand id (so a brand's key silhouette is *stable*
and becomes recognisable). Marks **draw themselves in** on load via `[data-draw]`,
exactly as Logo Studio's marks do. Mono spec labels pinned to the corners:
`6 · BRANDS`, `147 · KEYS`, `AES-256-GCM`, `E2E · ZERO-KNOWLEDGE`.

**Brand board.** The answer to *"the user sees a list of brands and their passwords."*
A responsive grid, one card per brand:

- Brand mark + name; role tag (`Owner` / `Editor` / `Viewer` / `Via Noize Agency`)
- The brand's key silhouette, small
- `24 keys · 5 people · 2 shared out` in mono
- A **health bar** — a thin four-segment rule (strong / weak / stale / breached).
  Segments are ink except breached, which is alarm; a fully strong bar is a single
  clean hairline. Health reads as *texture*, not a number to argue with.
- Footer: stacked avatars of who else is in this vault, and `Last opened 2h ago`
- Hover lifts and reveals `Open vault →`. Click → `/b/:brandId`.

A dashed tile at the end: **+ New brand** (opens the shared `NewBrandDialog`).

**Recent activity.** Six rows of the register, mono, with the actor's avatar — a live
window onto the audit trail so it is never a screen you have to remember to check.

---

### 5.1 · Vault — the ledger (`pages/Vault.tsx`)

**Job:** find any key across any brand in under two seconds; act without revealing it.

**Layout.** Filter rail (220) · dense ledger (fluid). No cards. This screen is for
volume and it is unapologetically a table.

**Filter rail.** Brand list with counts (multi-select, ink fill when on) → type
(Login / Card / Note / Key / Licence / Recovery codes / **Delegated access**) →
health → shared-state → tag cloud. Every filter is reflected in the URL so a filtered
view is a shareable link.

**Ledger rows.** Hairline-ruled, 48px, hover lifts one step:

```
◈  Google Workspace — admin        ops@acme.co     ACME    ●●●○  2h    ⧉  ◍
```

glyph · name + identity · brand chip · health pips · last-used (mono) · **Copy** · **Aperture**

**The core inversion.** `⧉` **Copy is the primary action** — one click, no reveal,
toast reads `Copied. Clears in 45s.` with a drain ring counting it down, and the copy
is written to the register. `◍` **Aperture is the deliberate path** — press and hold.
Every competitor makes reveal primary and copy secondary; it is worse UX *and* worse
security, because the value ends up on screen when all you wanted was it in a form.

**Keyboard.** This screen is driven from the keys. `j`/`k` move, `/` focuses search,
`c` copies the password, `u` copies the username, `o` opens the URL, `Enter` opens the
sheet, `Space` press-and-hold reveals, `x` selects, `⌘A` selects all. A persistent
hairline footer shows the four most relevant bindings — discoverable without a modal.

**Bulk bar** (`pop`, pinned bottom-centre, only when a selection exists): `9 selected`
→ Move to brand · Share · Add tag · Queue rotation · Delete. Delete always previews
blast radius first (§5.3).

**⌘K Quick find** — the most-used interaction in any password manager, so it gets the
most attention. Overlay, opens in <50ms, searches names/identities/URLs/tags across
every brand. Results carry a brand chip. `Enter` copies the password and dismisses,
`⇧Enter` copies the username, `⌘Enter` opens the site in a new tab and copies,
`→` opens the sheet. You can go from keyboard shortcut to pasted password in under a
second without the value ever being drawn on screen.

---

### 5.2 · Item sheet (`pages/Item.tsx`)

**Job:** everything about one key, including the two questions no competitor answers —
*who else can open this* and *what breaks if it goes*.

Not a modal. A full **specimen sheet**, because here the item is the artefact.

**Layout.** Header (glyph, name, brand chip, tags, `Launch ↗`, `⋯`) → two columns:
fields (fluid) · access + history rail (320, sticky).

**Fields.** Each row is label (mono) / value / actions. Masked values use `.masked` —
same width revealed or not, so nothing moves. Supported types, and this list is
deliberately longer than the category norm because agency reality is:

- **Password** — masked, strength meter as a hairline, age in mono, Aperture + Copy
- **Username / email** — plain, Copy
- **TOTP** — the live six digits in mono, **the drain ring as the 30s window**, Copy.
  Shared 2FA without sharing a phone; the single most-requested team feature.
- **URLs** — multiple, each with `Launch ↗`
- **Recovery codes** — first-class, not a note. A mono grid; each code **strikes
  itself through once copied** and the count updates (`4 of 10 unused`). Everyone
  stores these in a text file and nobody tracks which are spent.
- **Custom fields** — text / masked / date / number
- **Files** — routed through the suite's Document Locker (see the locker hook rule)
- **Security questions** — Q/A pairs, answers masked
- **Who to call** — the human who owns this account, plus the billing contact. When a
  key breaks at 6pm on a Friday this is the field that saves the night.
- **Delegated access** — *not a secret.* Platform, the account id, the permission
  level, who granted it, when, and a `Revoke at source ↗` deep link. Renders with a
  distinct hairline-dashed border so it never reads as something you can copy.

**Access rail.** The item's own miniature Access Map: every person who can open this,
with `opened 4× · last Tue` or a quiet `never opened` in ink-40. A shared-out block
lists live Send links with their drain rings and a **Revoke** that is instant and
alarm-coloured. Bottom: **"If you delete this"** — a standing impact preview (3 people
lose access · 1 live share breaks · referenced by 2 projects), not a dialog you meet
after you have decided.

**History.** Every version kept. A mono register — `v4 · Priya · 12 Jul · password, url`
— expandable to a field-level diff with the old value itself masked and Aperture-gated.
`Restore` on any version.

**Footer.** `Rotate this key →` opens the rotation flow: the provider's change-password
deep link, a generated candidate, and a **"paste the new one back"** field, so rotating
is a guided round-trip rather than an errand you abandon halfway.

---

### 5.3 · Access map (`pages/Access.tsx`) — the flagship

**Job:** make least-privilege a thing you can see and fix in one gesture. Give the
client something no agency has ever been able to show them.

**Layout.** Side toggle + brand filter → the bipartite ledger → the trim panel.

**Side toggle.** A segmented control that reframes the entire screen:

- **Our side** — every person who can reach this brand's keys
- **Client's side** — what the brand owner sees of *us*. Same data, their words, their
  order of concern. An agency can open this in a client meeting.

**The ledger.** People left, keys right, `.tie` hairlines between. Hovering a person
lights their ties and dims everything else; hovering a key lights everyone who holds
it. Ties carry weight: **solid ink = used in the last 90 days, dashed ink-20 = granted
but never used.** A wall of dashed lines is instantly legible as over-provisioning —
you don't need to read a single label to know something is wrong.

**Read it as a sentence.** Selecting a person replaces the header with plain English:

> **Priya Raghunathan** · Noize Agency · Editor
> can open **14 of Acme's 24 keys**. She has opened **3** in the last 30 days.
> **11 have never been opened.** Her access was granted by Sajat on 4 Mar 2026.

**Trim to what's used.** The panel's one pigment button, and the feature no competitor
ships. It proposes revoking every grant unused for 90 days, as a reviewable list with
per-row keep/revoke, a running count (`Revoking 11 grants across 3 people`), and a
plain warning about what could break. Confirm → revoked, logged, and the affected
people get one notification with a one-click **Request it back**. Least privilege
becomes a Tuesday-afternoon gesture instead of a project.

**Access statement.** `Export ↗` renders a one-page, specimen-framed, dated PDF —
*"Access statement — Acme Coffee, as at 7 August 2026"* — listing every human, their
organisation, their scope and their last use, under a `.stamp` seal. For the agency it
is a sales weapon; for the brand it is the trust artefact; for both it is audit
evidence generated as a by-product of doing the right thing.

---

### 5.4 · Offboarding (`pages/Offboarding.tsx`)

**Job:** the day someone leaves, be finished in twenty minutes with a record to prove
it. This is the highest-value screen in the product and **no competitor has designed
this flow at all** — they give you a delete-user button and wish you luck.

**Layout.** Person picker → blast radius → rotation queue → certificate.

**Person picker.** Everyone with any access, staff and external. Anyone already
removed from Prodesk staff is pinned to the top with an alarm pip and
`Left 12 Aug · not yet closed out` — the screen arms itself.

**Blast radius.** Three specimen-framed panels, ordered by consequence, because the
distinction between them is the entire point:

1. **Reached and opened** (alarm) — they hold these values. `9 keys · must rotate.`
2. **Reached, never opened** (ink) — revoke, don't rotate. `22 keys · revoke.`
3. **Only they knew** (alarm, `.quill` note) — sole holder. Rotating locks you out if
   you don't recover it first. `2 keys · recover before rotating.`

Two-panel products merge 1 and 2 and make you rotate 31 keys instead of 9. Splitting
them is the difference between a flow people finish and one they abandon.

**Rotation queue.** A working checklist, ordered by risk. Each row: key, brand, why it
ranks there, an assignee, and **Rotate →** (the same guided round-trip as §5.2 — deep
link, generated candidate, paste back). A progress rule fills across the top in pigment
as the queue drains. The queue survives navigation; this is a job you finish over an
afternoon, not in one sitting.

**Exit certificate.** When the queue empties, a specimen-framed, `.stamp`-sealed,
exportable record:

> **Exit certificate — Marcus Webb**
> Access ended 12 Aug 2026 · closed out 12 Aug 2026, 4:41pm AEST
> 31 keys were in reach · 9 opened and rotated · 22 revoked unused · 0 outstanding
> Closed out by Sajat Sivakumar

Your SOC 2 / ISO evidence, produced automatically by doing the work.

---

### 5.5 · Send (`pages/Send.tsx`) + the recipient page (`pages/PublicSend.tsx`)

**Job:** get a secret to someone outside the vault without email, Slack or a Google
Doc — and make receiving it feel like receiving something valuable.

**Compose.** Three steps down one column, no wizard chrome.

1. **What** — pick items from the vault, or type a one-off value that is never stored.
2. **The envelope** — this is the screen, and every control is a plain-English sentence
   with an inline field, not a form:
   - *Expires in* `[24 hours ▾]`
   - *Can be opened* `[1 ▾]` time
   - *Only by* `[jo@northwind.com]` (a code is emailed; no account needed)
   - *After they enter* `[a passphrase you tell them by phone]` — optional, and the
     copy says exactly why: it splits the secret across two channels
   - *Watermark their email across the view* `[✓]`
   - *Block copy — they must type it* `[ ]`
3. **The seal** — a preview of exactly what the recipient will see, then **Seal and
   send**. The link is shown once, with a copy button and a drain ring already running.

**Sent panel.** Live sends, each with its drain ring, opens used, and an alarm-coloured
**Revoke** that kills the link instantly. Delivery receipts in mono:
`Opened 14:02 · Melbourne AU · Chrome`. Unopened after half its life → a **Chase** button.

**The recipient page** — public, no account, and the app's viral surface. Every send is
a demo, so it gets the full paper stage: the sender's brand mark, one `.quill` line
(*"Sajat at Noize sent you something."*), the drain ring showing how long they have,
and the secret behind a single Aperture press-and-hold. Watermark tiled at 4% ink if
enabled. On expiry the page does not 404 — it renders a calm, designed *"This has
closed."* with a **Ask for a new one** button that pings the sender.

---

### 5.6 · Intake (`pages/Intake.tsx`) + the public form (`pages/PublicIntake.tsx`)

**Job:** the reverse of Send, and the real agency wedge. Get credentials *from* a
client without either party doing something stupid.

The status quo is a Google Doc, an email thread, or a Slack DM. Every agency does this
every time they onboard, and it is universally awful.

**Build a request.** Start from a template — **New client onboarding** (Google Ads,
Meta Business, WordPress admin, DNS registrar, Google Analytics, hosting, email
platform), **Website handover**, **Ad platforms**, **Blank** — or compose your own.
Each row: what you need, why (shown to the client, and it visibly raises completion),
and required/optional.

**The best-practice steer — the part that makes this an access manager.** For platforms
where password-sharing is actively harmful, the row does not ask for a password at all.
It offers **"Grant access instead"** with the exact click-path for that platform, and
records a *delegated grant* (§5.2) rather than a stored secret:

> **Meta Business Manager**
> Don't send us your password — Meta flags cross-country logins as fraud and can
> restrict the ad account. Add us as a Partner instead: Business Settings → Partners →
> Add → paste `**********`. ⟶ *Show me the steps*

The client's completion rate goes up, the agency's risk goes down, and the vault ends
up holding the *right* artefact. No competitor models the distinction.

**The public form.** Paper stage, agency's brand mark, a progress rule, one field per
screenful on mobile. Every value is encrypted **in the client's browser** to the vault's
public key before it is sent — the agency's server never sees plaintext and the client
is told so in one plain sentence with a link to §5.10. They can save and resume from
the same link. On submit: a calm confirmation and, optionally, a copy of what they
supplied.

**Progress tracking.** `6 of 9 supplied · 2 delegated · 1 outstanding`, a per-row
timeline, and **Chase** — one click, a pre-written nudge naming only the missing items.
On completion everything files itself into the right brand vault, correctly typed,
correctly shared, correctly tagged with the intake it came from.

---

### 5.7 · Watchtower (`pages/Health.tsx`)

**Job:** make hygiene something people actually fix. Hygiene dashboards die for two
reasons: they scold, and you can't dismiss them. Fix both.

**Layout.** Score header → findings, ranked by consequence → the fixed strip.

**Score header.** One number, big, tabular mono, with its trend as a sparkline rule —
and immediately beside it in `.quill`, the sentence that matters: *"Three keys are
reused between Acme and Bellweather. If one leaks, both do."* **Framed as consequence,
never as a grade.**

**Findings.** Each is a specimen-framed row: what, which keys, what could happen in one
plain sentence, and **one gesture to fix it.**

| Check | Framing |
| --- | --- |
| Reused across brands | *the* agency-specific risk — one leak, many clients |
| Weak | zxcvbn score, with the actual guess-time |
| Stale | **per-type age policy** — a DNS registrar at 3 years is urgent, a newsletter tool is not. A flat 90-day rule is why people stop believing these screens. |
| Breached | HIBP range API, k-anonymity — the password never leaves the browser |
| No 2FA on a critical account | ranked by what the account controls |
| Shared too widely | more than N holders for the sensitivity |
| Orphaned | the only person who used it has left |
| Dormant | untouched in 12 months → a deletion candidate, and deleting is a win |
| Expiring | cards, certificates, domains, API keys with a known end date |

**Snooze with a reason.** Every finding can be snoozed for 30/90 days **with a written
reason**, which is recorded in the register and shown on the row when it returns. This
one control is why the screen survives month three. A finding you cannot dismiss is a
finding people learn to scroll past.

**The fixed strip.** A quiet mono line at the foot: `41 findings resolved this quarter`
— the only place the product ever congratulates you, which is what makes it land.

---

### 5.8 · Register (`pages/Register.tsx`)

**Job:** every answer to "who did what" in ten seconds, as an object you would happily
hand to an auditor.

A specimen-framed, corner-ticked sheet — not a log dump. Mono, tabular, hairline-ruled,
virtualised. Columns: when · who · what · which key · which brand · where from.

Filters: person, brand, item, event type, date range. All in the URL. Export CSV or the
framed PDF.

**Anomaly surfacing.** Above the ledger, only when there is something to say, an
alarm-bordered row: *"Priya revealed 11 keys in 4 minutes at 02:14 from a new
location."* Detected on velocity, hour-of-day and new-device. It will fire rarely — and
it is the reason you bought the product.

---

### 5.9 · Team (`pages/Team.tsx`)

Per the template's Team & permissions rules, verbatim: list **every** active teammate
of the brand via `trpc.staff.list` — not only those who already hold the permission —
show whether they have this tool's access with an Editor/Viewer control and a
**Revoke access** that strips only `passwords`, a **Grant access** for those without,
the whole panel gated on `staffManagement`, and **Invite** seeding a new teammate with
`passwords`.

Above that, the KEYMASTR-specific part: **vault-level roles.** Team access grants entry
to the app; a vault grant gives access to a brand's keys. The panel shows both, so
"has the app but no keys" is a visible, fixable state rather than a confusing dead end.

**Access requests.** A teammate without access to a key sees **Request access** rather
than a locked row. An approver gets a card: who, which key, the reason they typed, and
**Grant for [7 days ▾]** — with time-boxed the default. Just-in-time access, one click,
and the grant carries its own drain ring.

---

### 5.10 · Trust (`pages/Trust.tsx`)

**Job:** in this category the security model *is* a feature, and burying it in a PDF is
a lost conversion. So it is a screen.

**The diagram.** A live, animated, plain-language walk of what happens when you save a
secret: typed → encrypted in your browser with a key derived from your passphrase →
the ciphertext goes to the server → **the server has never held the key**. Rendered on
the blueprint grid with the same self-drawing line work Logo Studio uses for marks.

**Key fingerprints — the ETH Zürich wedge (§1).** Every person in your org has a
fingerprint rendered as **six words** (`amber · fjord · lantern · rust · quill · nine`).
The first time you share to someone, KEYMASTR shows their fingerprint and asks you to
confirm it once. If a key ever changes, sharing **stops** and says so in alarm:
*"Priya's key changed on 3 Aug. Confirm the new one before sharing again."*

That is a two-second interaction that structurally closes the public-key-substitution
attack the ETH Zürich team demonstrated against Bitwarden, LastPass and Dashlane. Say
it plainly on this screen, and say it in the marketing: **we show you the key.**

**Emergency access / break-glass.** Named recovery contacts, a stated waiting period,
and a break-glass session that is loud by design: full-screen alarm chrome, a large
drain ring, a mandatory written reason, and immediate notification to every owner.
Recovering access should feel like breaking glass, because it is.

**Recovery.** Recovery kit as a printable specimen sheet, plus the honest sentence
consumer products dodge: *"We cannot reset your passphrase. That is the point. Here is
what to print."*

---

### 5.11 · Brand vault (`pages/BrandVault.tsx`)

One brand's everything: its keys (the §5.1 ledger, pre-filtered), its people, its
health bar, its live shares, its recent register. The screen a brand owner lives in and
the one an agency opens during a client call.

Header carries the brand mark, the role tag and — if the viewer is on the agency side —
a hairline note: *"Acme can see everything on this screen."* Because they can, and
saying so is the whole thesis.

---

### 5.12 · Support, Profile, Billing

**Support** — native screen in the KEYMASTR skin on the shared data layer
(`@shared/pages/support/use-support` + `model`), mounted inside the shell with the
Support tail row lit. Copied from the template and re-skinned.

**Profile** — native account screen (mirrors `clients/logo` `pages/Account.tsx`).

**Billing** — feature subscription + seats (§8). Prices read from the API and formatted
with the money helper; **never hardcoded** (AGENTS.md).

---

## 6 · Data model (to build)

New module `packages/server-shared/src/modules/passwords/`, router `trpc.passwords.*`.
Migrations are **hand-written** `drizzle/NNNN_*.sql` plus a `meta/_journal.json` entry —
never `db:generate`.

```
password_vaults          one per brand; holds the wrapped vault key
password_vault_keys      vault key wrapped per member public key (envelope)
password_items           brand_id, type, name, identity, url, tags, health, timestamps
password_item_secrets    ciphertext + iv + version   (server never sees plaintext)
password_item_versions   full history, restorable
password_grants          person → item|folder, role, granted_by, expires_at, last_used_at
password_delegations     platform grants — NOT secrets (§5.2)
password_sends           one-time outbound shares: envelope rules, opens, receipts
password_intakes         inbound requests + per-row status
password_events          the register — append-only
password_health_findings computed findings + snooze reason/until
password_offboardings    person, blast radius snapshot, queue state, certificate
user_keypairs            public key + fingerprint (shared — other tools will want it)
```

Read cores live in `modules/passwords/queries.ts` so chatbot tools can reuse them with
auth staying in the callers (the established `ai-tool-shared-queries` pattern).

### Encryption

Envelope, per-vault, client-side:

1. Passphrase → Argon2id → **user master key** (never leaves the device).
2. Master key wraps the user's **private key**; the public key is stored with a
   fingerprint.
3. Each vault has a random **vault key**; it is wrapped once per member public key
   (`password_vault_keys`). Adding a member = one wrap. Removing = one delete.
4. Items are AES-256-GCM under the vault key. The server stores ciphertext + IV only.
5. Sharing to a non-user (Send/Intake) mints an ephemeral keypair; the fragment after
   `#` in the URL carries the key and **is never sent to the server**.

Non-negotiable: **public keys are verified by fingerprint before use** (§5.10). That is
the whole point of §1's differentiator, and skipping it reintroduces the exact ETH
Zürich attack.

---

## 7 · Permissions

`passwords` (manage) and `passwordsViewer` (read + copy, no reveal, no share) — the
Links/Reviews split. Add both to the Postgres `staff_permission` enum, the `PERMISSIONS`
allow-list in `routers/staff.ts`, and the labels + per-frontend group in
`packages/shared/src/pages/agency/constants.ts`.

Vault-level roles sit **under** those: `owner` / `editor` / `viewer` / `time-boxed`, per
brand, per folder or per item.

---

## 8 · Billing

A feature subscription (`featureSubscriptions`), **per seat**, monthly, with the
established card-on-file → Checkout fallback (`feature-sub-card-on-file`: handle a null
`url`). Trial mirrors Reviews.

**External client collaborators are free** — deliberately. Hypervault does this and it
is right: the client is the *reason* the agency buys, and charging for them caps
adoption at exactly the wrong boundary.

Every price in the UI comes from the API. None is hardcoded.

---

## 9 · Build order

1. **Skeleton** ✅ (this directory) — every screen, mock data, no backend.
2. Schema + migrations + `trpc.passwords.*` read paths; wire the Vault, Item and Brand
   screens to real data.
3. Crypto: keypairs, vault keys, envelope wrap/unwrap, fingerprints. **Trust screen
   ships with this step, not after it.**
4. Grants + Access map + Trim.
5. Send + the public recipient page.
6. Intake + the public form + the delegation model.
7. Health + the register + anomalies.
8. Offboarding + the exit certificate.
9. Billing, Team, permissions.
10. Browser extension (autofill) and passkey storage — the two things the web app
    alone cannot do, and the reason step 1 makes `Launch ↗` and `⌘K` good enough to
    live without them.

---

## 10 · Wiring done in the skeleton

Per `clients/_template/README.md` and `.agents/AGENTS.md`:

- `clients/passwords` copied from `_template`; `package.json` name, `__PRODESK_CLIENT__`
  and `<title>` set; dev port **5183**
- `scripts/dev.mjs` `FRONTENDS` entry + root `dev:passwords` script
- `.railway/configs/clients/passwords.json` + `.railway/sync.ps1` `$serviceMap` entry
- `<BetaProgram />` mounted; `<UnknownRouteRedirect>` last in every `Switch`
- `/login` + `/signup` post-auth redirect guard
- Native Support screen; user-level `AppShell` (`identity`, no brand dropdown)
- Env only via `@shared/lib/env`
- Public `/s/:token` and `/i/:token` matched **before** every auth gate, as
  `clients/logo` does for `PublicGuidelines`

### Still to do when the backend lands

- Document Locker hook on every file upload (§5.2 files) — **required of every
  brand-scoped upload in every frontend**
- `.env` / `.env.example` / `.railway/envs/shared.*.env` `VITE_PASSWORDS_PRODESK_ORIGIN`,
  exposed via `@shared/lib/origins`
- Add the frontend to the tables in `.agents/AGENTS.md` and `docs/agents/architecture.md`
