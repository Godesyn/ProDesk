# Document Locker

A brand's single home for every document related to it. Files arrive **two ways**:

1. **Manual uploads** by the brand (or super-admin) — the original locker behaviour.
2. **Automatic population** — files created elsewhere are mirrored into the locker by insert-only hooks. This spans the Prodesk core (chat, logos, deliverables, Info Hub, proposals, project briefs, questionnaires) **and every satellite app**: Signatures assets, Payments/proposal brand assets, Verdiict review-page logos, and Support ticket attachments from any frontend.

**The rule for new features: if a user can upload a file against a brand, that upload gets a locker hook.** A satellite app is not exempt — the brand expects one place to find everything it has ever uploaded. §3 lists every hook; add a row when you add an upload.

There are two views of the same `files` data:

- **Brand view** — `client/src/pages/brand/documents.tsx`. Three tabs, folders, search, drag-and-drop, upload, move/delete.
- **Agency view** — the Files tab on `client/src/pages/agency/client-detail.tsx` (Clients → a brand → Files). **Read-only** and **scoped** (see §6).

Server: `server/src/routers/files.ts`. Shared insert helper: `server/src/modules/locker/record.ts`.

---

## 1. The three tabs

| Tab                     | Contains                                                                                                                                            | `files` predicate                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Agency Documents**    | Docs owned by an agency (uploaded by/for an agency), filterable by agency                                                                           | `isPrivate = false AND agencyId IS NOT NULL`           |
| **Public Brand Assets** | Brand-owned public assets (logo, public uploads) **and** agency docs flagged public (e.g. a published Info Hub section, shown with its agency name) | `isPrivate = false AND (agencyId IS NULL OR isPublic)` |
| **Private Documents**   | Brand-only private files                                                                                                                            | `isPrivate = true`                                     |

A public agency doc appears in **both** Agency Documents and Public Brand Assets — `isPublic` is what puts it in the public tab; `agencyId` keeps it in the agency tab.

---

## 2. Data model

### `files`

Key columns (full list in `schema.ts`):

- `brandId` — the owning brand.
- `agencyId` — **primary** owning agency (display / back-compat). `NULL` = brand-owned.
- `agencyIds` (uuid[]) — **all** agencies the file belongs to (see §5). Always includes `agencyId` first.
- `isPrivate` / `isPublic` — drive tab placement (table above).
- `folderId`, `sortOrder` — organisation + manual drag order.
- `projectId`, `projectTitle` — project provenance (deliverables / brief / questionnaire).
- `category`, `source` — informational (`logo`/`chat`/`deliverable`/…, `brand`/`agency`).
- `note` — human provenance shown on hover (§4).
- `sourceType` + `sourceId` — dedup stamp for auto-sourced rows (§3). `NULL` for manual uploads. Partial unique index `files_source_uniq`.

### `folders`

Folders are **always brand-created** organisational containers. Agencies never create folders.

- A folder's **home** tab is captured by `isPrivate` / `isPublic` (NOT `agencyId` — a brand's Agency-tab folder has no owning agency): private = `isPrivate`; public = `!isPrivate && isPublic`; agency = `!isPrivate && !isPublic`.
- Folder listing is **content-aware for the Public tab**: a folder also appears under Public Brand Assets when it holds a public-visible file (`isPrivate=false AND (agencyId IS NULL OR isPublic)`) anywhere in its subtree — even if its home is Agency Documents. So a doc that is both agency-owned and public, filed inside an agency folder, stays reachable in the Public tab inside that _same_ folder (no duplicate folder is created; the one folder shows in both tabs). Ancestors are included for navigation.
- `parentId` — nesting. `sortOrder`/name ordering.

---

## 3. Automatic population (the one invariant)

**A source event only ever INSERTs a locker row.** It never updates or deletes one. Deleting a locker row never affects the source; editing/replacing/deleting a source never removes its locker rows (a replaced file stays as history). The **sole exception** is the Info Hub visibility toggle, which flips an existing row's `isPublic`/`isPrivate` (a tab move, never a document add/remove).

Idempotency: every derived row carries `(sourceType, sourceId)` with a partial unique index, so re-running a hook (retry, re-completion, backfill) is a no-op via `ON CONFLICT DO NOTHING`, and a row the brand deleted locally is never resurrected.

All hooks call `recordLockerFile` / `recordLockerFiles`.

| Source                          | Hook site                                                                                        | Destination                                                                                                                     | `sourceId`                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------- |
| **Chat attachment**             | `chat.send` (has `fileUrl`)                                                                      | brand↔agency thread → **Agency Documents** (all thread agencies, §5); brand-only thread → **Private**. No-brand threads skipped | `chat:<messageId>` (message id) |
| **Brand logo**                  | `brands.update` / `brands.updateLogo` (new url)                                                  | **Public Brand Assets**; keeps full logo history                                                                                | `<brandId>:<url>`               |
| **Deliverable**                 | `completeProject` (→ `completed`) + `addDeliverable` on an already-completed project             | **Agency Documents** (project agency); only `source:'agency'` deliverables                                                      | deliverable id                  |
| **Info Hub file answer**        | `spot.updateAnswers` (file-bearing question types)                                               | agency section → **Agency Documents** (+ **Public** when section public); brand-owned section → public/private by section state | `<componentId>:<qid>:<url>`     |
| **Proposal document**           | `proposals.addDocument`                                                                          | **Agency Documents** (proposal's agency)                                                                                        | proposal-doc id                 |
| **Brief document**              | `projects.addBriefDocument` (only `source:'brand'`)                                              | **Agency Documents** (project agency)                                                                                           | `<projectId>:<url>`             |
| **Questionnaire answer**        | `projects.submitBrief` (brand file answers)                                                      | **Agency Documents** (project agency)                                                                                           | `<projectId>:<qid>:<url>`       |
| **Signatures asset** (SIGKITT)  | `signatures.upload.file` — covers the Brands/Campaigns screens and the dashboard brand-kit slots | **Public Brand Assets**                                                                                                         | storage key                     |
| **Payments asset** (EziQuotes)  | `payments.accounts.recordAssetUpload` — the client's confirm after its signed-URL PUT            | **Public Brand Assets**; `assetType:'attachment'` → **Private**                                                                 | storage key                     |
| **Review page logo** (Verdiict) | `reviews.locations.update` (new `logoUrl`)                                                       | **Public Brand Assets**; keeps logo history                                                                                     | `<locationId>:<url>`            |
| **Support attachment**          | `support.create` / `support.reply` — every frontend's Support screen                             | **Private Documents**                                                                                                           | `<ticketId                      | commentId>:<url>` |

Satellite-app assets go through `recordBrandAsset` (modules/locker/record.ts), which fixes them as brand-owned (`agencyId` null) + `isPublic` — the same placement as the brand logo. Support attachments are `isPrivate` instead: they are usually screenshots of the user's own workspace, so they never become a public asset and are never attributed to an agency.

**Payments needs two calls, not one.** `getAssetUploadUrl` only mints a signed URL — the bytes go browser→storage and the server never sees the PUT succeed. Recording at mint time would leave locker tiles pointing at objects that were never written, so the client calls `recordAssetUpload` once its PUT resolves. Any future signed-URL upload path needs the same confirm step.

**Excluded on purpose:**

- Agency-workspace brief docs (`source:'agency'`), project revision attachments, `completeBrief` agency docs.
- **Personal profile photos** (`profile-hero`, dashboard + logo `Account`, contractor résumé/portfolio) — user-scoped, not brand documents. A brand's locker is not a staff directory.
- **Super-admin platform resources** — platform-wide, owned by no brand.
- **Signature builder images picked on the Home screen** and the `BrandTemplatesPanel` palette logo — these are read as `data:` URIs into localStorage and never reach storage, so there is no stored file to mirror. If that flow is ever changed to upload, route it through `signatures.upload.file` and it is covered for free.
- `POST /api/payments/assets/upload` (modules/payments/http.ts) — a dead route left from the Manus export; no client calls it, and it is brand-less so it could not attribute a file anyway. Delete it or give it a brandId before using it.

**Deliverable visibility gate:** deliverables reach the locker only at the `completed` state (the project screen shows them a step earlier, at `clientApproval`, but the locker waits for `completed`). Deliverables are **locked** once a project is `completed` — `updateDeliverable`/`removeDeliverable` reject (their files are already in the locker); new deliverables may still be added.

---

## 4. Provenance notes

Every record is stamped with a human-readable `note`, shown on hover (and as a caption in search results):

- Chat → `Sent by {name} in the group/staff/personal chat`
- Logo → `Uploaded as a brand logo`
- Deliverable → `Deliverable {n} from {service}` (+ `· cycle {m}` only for **recurring** services)
- Proposal / brief / questionnaire / Info Hub → their own phrasings
- Signatures → `Uploaded as an email-signature asset`
- Payments → `Uploaded as a proposal {light-background logo | favicon | hero image | …}`
- Verdiict → `Uploaded as the review page logo for {location}`
- Support → `Attached to support ticket #{n}`
- Manual upload → `Uploaded by the brand / agency / admin`

---

## 5. Many agencies per document

A file can belong to **multiple** agencies (`files.agencyIds`). This happens when a document is shared in a group (`all`) chat that includes several agencies — the file then shows in **each** of those agencies' documents, is searchable by **any** of their names, and is visible to **all** of them. Single-agency files have `agencyIds = [agencyId]`. `agencyId` is the primary (first), kept for display.

Queries match membership with `agencyId = X OR X = ANY(agencyIds)`.

---

## 6. Agency view & folder visibility

Server: `files.clientView` (Clients → brand → Files). Authorised by the agency `clients` permission + an active brand↔agency connection — it does **not** require brand-side `documents` access.

- Returns **public brand assets + the docs this agency owns**. "Public" = a brand-owned file (`agencyId IS NULL`) **or any `isPublic` file regardless of owning agency** (a public brand asset is visible to every connected agency). "Ours" = `agencyId = thisAgency` or `thisAgency ∈ agencyIds`. Never the brand's private docs, and never another agency's **non-public** docs. The owner badge reads "Your document" only when this agency actually owns it, else "Public".
- Renders with the **same** OS-style tile grid + breadcrumbs as the brand view — both screens use the shared `components/file-locker/locker-grid.tsx` (`<LockerGrid>`); the agency passes `readOnly` so all mutation affordances (create / rename / move / reorder / delete / drag-and-drop) are stripped. Folders open, files open in the viewer, nothing mutates.
- **Read-only**: agencies cannot create folders, upload here (they upload from the file section), move, reorder, or delete.
- **Folder visibility rule:** an agency sees a folder only if it (or a descendant) holds at least one file the agency may see — **that agency's own docs OR one of the brand's public assets**; ancestors are included so the folder is navigable. (The **brand** always sees all of its own folders regardless of contents.)

---

## 7. Brand-side capabilities

- **Folders:** create per tab (brand-only), navigate via breadcrumbs, recursive delete, move files between folders.
- **Drag & drop (OS-style):** drag a file onto a folder to move it in (`files.move`); drag a file onto another to reorder (`files.reorder`, persisted via `files.sortOrder`, optimistic); drag a file onto a breadcrumb to move it out/up.
- **Rename:** click a folder's name (not the tile — the tile opens it) to rename inline (`files.renameFolder`). Open any file in the viewer and click its name in the header to rename it (`files.rename`) — the viewer takes an optional `onRename` callback; omitting it (e.g. the read-only agency view) keeps the name static.
- **Copy to Public Brand Assets:** the globe icon on an Agency Documents file (shown only when it isn't already public) calls `files.copyToPublic`, which sets `isPublic`. The doc then also shows under Public Brand Assets — inside the same folder it already lives in (the folder surfaces there via the content-aware listing above). It stays one document with one folder; it is not duplicated.
- **Global search** above the tabs (`files.search`): spans **all** tabs/folders at once and matches **file name + project title + owning agency name**.
- **Agency names** are shown wherever a doc is agency-owned (filter chips + per-file caption with logo), resolved via `connections.brandAgencies`.
- **Agency filter chip** (Agency Documents tab): selecting an agency filters both files _and_ folders — `files.folders` takes an optional `agencyId` and, when set, returns only folders whose subtree contains one of that agency's files (plus ancestors). Empty/irrelevant folders disappear while the chip is on; clearing it (All) shows every folder again.
- **Refresh:** reusable `RefreshButton` (`components/ui/refresh-button.tsx`) in the header re-pulls everything (files, folders, search, agency names) with a spin animation.

---

## 8. Migrations & backfill

- `0016` — `files.is_public`, `source_type`, `source_id` + partial unique index.
- `0017` — `files.note`.
- `0018` — `folders.is_public`, `files.sort_order`.
- `0019` — `files.agency_ids`.

`files.source_type` is plain `text`, so a new source (like the four satellite ones above) needs **no migration** — just a `LockerSourceType` member and a hook.

**Satellite-app backfill — automatic, exactly ONCE per database.** The satellite hooks only fire for uploads made after they shipped, so existing signature logos, proposal assets, review logos and support attachments need one reconciling pass. That pass lives in `modules/locker/backfill.ts` (`backfillAppUploadLocker`) and is wired into initialization as `ensureAppUploadLockerRows` (`scripts/initialize-core.ts`), which runs after migrations on server start — no manual step on any environment.

It is **not** re-run on later boots. Every other step in `initialize-core.ts` is check-then-write against the rows it seeds; a backfill has no such row and would re-scan every source table on each restart. So it goes through `runOnce` (`modules/init/once.ts`), which claims its key in `init_task_runs` (migration `0080`) and skips forever after — later boots cost one indexed primary-key lookup. Going forward the hooks keep the locker current; this only closes the historical gap.

`runOnce` also handles the two edge cases: the claim is `INSERT … ON CONFLICT DO NOTHING` on the primary key, so simultaneous boots can't both run it, and a row left with `completedAt` NULL by a crashed run is reclaimed and retried on the next boot. It is an optimisation, not a substitute for idempotency — the guarded task must still be safe if it does run twice.

To run it on demand against an environment you aren't restarting (`--stage` / `--prod` honoured). Without `--force` it respects the marker and won't re-scan a database that's already done; `--force` clears the marker first — use it after adding a source, or bump `LOCKER_APP_UPLOAD_BACKFILL_KEY`:

```
cd servers/backend && bun run db:backfill-locker-app-uploads [--force]
```

Idempotent twice over: `files_source_uniq` blocks a repeat insert, **and** the pass skips any URL the brand already has a locker row for. That second guard is load-bearing, not belt-and-braces — the forward hooks key asset rows on the storage _key_ while the backfill only knows the _URL_, so without it every boot after a live upload would add a second tile for the same file. Insert-only like every other source: a row the brand deleted stays deleted.

If you add a source here, keep its scan cheap — this is on the boot path. Every table it reads is one row per brand or bounded by campaign/location count; the one unbounded table (`support_tickets` + comments) is filtered **in SQL** to rows that actually carry attachments.
