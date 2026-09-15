# Chat / Messaging

Chat is a multi-identity, multi-tenant conversation hub. A single user can hold
many roles across the platform — agency owner, agency staff, brand owner, brand
staff, contractor, super-admin — and chat *as* any of them. Conversations are
scoped to a chosen identity and (where relevant) a brand the identity is talking
*about*, grouped into category sections, and decorated with per-identity unread
badges, typing indicators, read receipts, attachments, project cards, system
notices, and a members directory.

## Source files

| Concern | File |
| --- | --- |
| Page shell, identity/brand selection, navigation, live thread-list refresh | `client/src/pages/chat.tsx` |
| Identity selector ("Chat as") | `client/src/pages/chat/identity-selector.tsx` |
| Brand selector ("Chat about") | `client/src/pages/chat/brand-selector.tsx` |
| Grouped thread list + search + brand dividers | `client/src/pages/chat/thread-list.tsx` |
| Message panel (stream, composer, typing, read receipts, attachments) | `client/src/pages/chat/message-panel.tsx` |
| Optimistic outgoing-message store | `client/src/pages/chat/pending-messages.ts` |
| Members dialog | `client/src/pages/chat/members-dialog.tsx` |
| Client visual/format helpers + shared types | `client/src/pages/chat/chat-types.ts` |
| Cross-app chat-launch context | `client/src/pages/chat/chat-nav-context.tsx` |
| Floating message panel + sidebar unread badge | `client/src/components/layout/floating-message-panel.tsx` |
| tRPC procedures | `server/src/routers/chat.ts` |
| Identity + brand resolution | `server/src/modules/chat/identity.ts` |
| Thread-type taxonomy, visibility, sections | `server/src/modules/chat/thread-types.ts` |
| Auto-thread creation / archival | `server/src/modules/chat/threads.ts` |
| Chat-launch navigation resolver | `server/src/modules/chat/navigation.ts` |
| Digest scheduling | `server/src/lib/notify.ts` |
| Tables, enums, RLS, realtime publication | `server/src/db/schema.ts`, `server/sql/rls.sql` |
| Email-channel opt-out | `client/src/pages/profile/email-preferences-card.tsx` |

## Identity model ("Chat as")

`chat.identities` (`server/src/routers/chat.ts:37`) returns every identity the
signed-in user may chat as, built by `listChatIdentities`
(`server/src/modules/chat/identity.ts:53`). A `ChatIdentityType` is one of
`agency | brand | contractor | platformAdmin | user`
(`identity.ts:20`). The list is assembled in this order:

1. **Owned agencies** — `agencies.ownerId === user.id`, role `owner`.
2. **Staff agencies** — active `staff` rows of type `agency` (deduped against owned).
3. **Owned brands** — `brands.ownerId === user.id`, role `owner`.
4. **Staff brands** — active `staff` rows of type `brand` (deduped against owned).
5. **Contractor** — present when the user has the `individualContractor` role or
   a `contractors` profile, *and* either has an active
   `agencyContractorConnections` row or a contractor profile.
6. **Platform admin** — super-admins (`users.isSuperAdmin`) only; entity id is the
   synthetic `'app'` (`PLATFORM_ENTITY_ID`, `identity.ts:44`).
7. **Personal `user`** — always present, last in the list.

Each identity carries `{ type, entityId, entityName, userUid, entityRole,
entityLogo, isOwner }`. The identity selector
(`client/src/pages/chat/identity-selector.tsx`) renders a grouped dropdown with
section headers `AGENCIES / BRANDS / CONTRACTORS / PLATFORM ADMIN / PERSONAL`
(`IDENTITY_GROUPS`, `chat-types.ts:58`), a colored avatar/icon per type
(`identityVisuals`, `chat-types.ts:27`), a subtitle (`identitySubtitle`,
`chat-types.ts:43`), and a per-identity unread pill capped at `10+`
(`unreadLabel`, `chat-types.ts:130`). A clear (`X`) button resets to the no-identity
state.

## Brand scope ("Chat about")

After choosing an identity, the user picks which brand the conversation is scoped
to. `chat.brandsForIdentity` (`server/src/routers/chat.ts:43`) →
`listChatBrands` (`identity.ts:181`) returns, per identity type:

- **platformAdmin / user** → a single synthetic platform "brand" (`id: 'app'`,
  name = tenant business name), `locked: true`.
- **brand** → just that brand, `locked: true`.
- **agency** → all brands connected to the agency (`brandAgencyConnections`),
  `locked: false`.
- **contractor** → brands derived from the contractor's
  `agencyContractorPersonal` threads, `locked: false`.

The client auto-selects the first brand when the list changes, honoring any
pending cross-identity navigation target (`chat.tsx:124-136`). The brand selector
(`brand-selector.tsx`) is disabled and shows a lock icon for brand /
platformAdmin / user identities, and surfaces a contextual empty message (`No
connected brands` / `No brand threads found` / `Brand not found`) when the list
is empty.

## Thread-type taxonomy

There are 11 thread types (`thread_type` pg enum, `schema.ts:201`; mirrored in
`thread-types.ts:7` and `chat-types.ts:66`):

| Type | Shape | Meaning |
| --- | --- | --- |
| `all` | group | Brand↔agency connection group (everyone on both sides) |
| `you` | self | The user's private self-thread |
| `brandAgencyStaff` | 1:1 | An agency member ↔ a brand member on a connection |
| `agencyStaff` | 1:1 | Two members inside one agency |
| `brandStaff` | 1:1 | Two members inside one brand |
| `brandAgencyPersonal` | 1:1 | Personal brand↔agency thread |
| `agencyPersonal` | 1:1 | Personal agency-internal thread |
| `brandPersonal` | 1:1 | Personal brand-internal thread |
| `agencyContractorPersonal` | 1:1 | Agency owner ↔ contractor |
| `platformAdmin` | 1:1 | User ↔ platform support (super-admin) |
| `interAgency` | group | Two agencies collaborating on the same brand |

Each identity sees only the types relevant to it. `visibleThreadTypesForIdentity`
(`thread-types.ts:82`) returns:

- **user / platformAdmin** → `you`, `platformAdmin` (`userIdentityThreads`).
- **contractor** → `agencyContractorPersonal` (`contractorIdentityThreads`).
- **brand** → `all`, `brandAgencyStaff`, `brandStaff`, `brandAgencyPersonal`,
  `brandPersonal` (`brandIdentityThreads`).
- **agency** → `all`, `brandAgencyStaff`, `agencyStaff`, `brandAgencyPersonal`,
  `agencyPersonal`, `agencyContractorPersonal`, `interAgency`
  (`agencyIdentityThreads`).

## Thread list, grouping, and naming

`chat.threads` (`server/src/routers/chat.ts:56`) lists the current user's
threads (joined through `chat_thread_members`, excluding archived memberships,
newest-first by `lastMessageAt`). It applies type-driven visibility for the
active identity, an optional `brandId` filter, and — for agency identities — an
additional filter to threads whose `agencyIds` include the active agency
(`chat.ts:96`). When no identity is selected the query is called with
`unreadOnly: true` (`chat.tsx:146`) to power the cross-identity overview.

Each returned thread is decorated server-side with:

- **`displayName`** via `inferThreadName` (`chat.ts:464`): `all` → stored name;
  `you` → "You"; `platformAdmin` → "Platform Admin"; 1:1 personal/staff types →
  the *other* participant's name; staff group fallbacks otherwise.
- **`logoUrl`** via `inferThreadLogo` (`chat.ts:504`): brand logo for
  `all`/`brandAgencyStaff`, other agency's logo for `interAgency`, other user's
  avatar for personal types, `null` for `platformAdmin` (the client substitutes
  the app favicon).
- **`section`** via `sectionForThread` (`thread-types.ts:120`), the category the
  thread groups under (differs by identity — see below).
- **`groupLabel`** via `inferThreadGroupLabel` (`chat.ts:490`): the brand name for
  brand-scoped threads, `'Platform'` for `you`/`platformAdmin`, else `'Other'` —
  used for the "ABOUT {BRAND}" dividers in the overview.

### Grouped view (identity selected)

The thread list (`thread-list.tsx`) renders category sections in fixed
`THREAD_SECTION_ORDER` (`thread-types.ts:110`): `BRAND THREADS / AGENCY THREADS /
STAFF THREADS / CONTRACTOR THREADS / PLATFORM ADMIN / OTHER THREADS / THREADS`.
The bucket a thread lands in depends on the active identity (`sectionForThread`):

- **Agency identity** — `groupAsInterBrandAgencyThread` → BRAND THREADS;
  `groupAsPrivateOrgThread` → STAFF THREADS; contractor threads → CONTRACTOR
  THREADS; `platformAdmin`/`you` → PLATFORM ADMIN; else OTHER THREADS.
- **Brand identity** — private-org threads → STAFF THREADS; inter-brand-agency
  threads → AGENCY THREADS; `platformAdmin`/`you` → PLATFORM ADMIN; else OTHER.

The grouping flags `groupAsInterBrandAgencyThread`, `groupAsPrivateOrgThread`,
and `groupAsContractorThread` are defined in `thread-types.ts:66-76`.

### Cross-identity unread overview (no identity selected)

With no identity chosen, the list shows only unread threads across all
identities, grouped by brand under "ABOUT {BRAND}" dividers (brands sorted A→Z,
threads within each newest-first; `thread-list.tsx:118-130`). Tapping a thread
resolves which identity owns it via `resolveIdentity` (`chat.tsx:37`) using the
same visibility predicates as the server, then selects that identity + brand and
queues the target thread to open (`onSelectThread`, `chat.tsx:176`).

### Thread item

Each row (`thread-list.tsx:46`) shows a type-based icon + accent
(`threadVisuals`, `chat-types.ts:80`) or the resolved counterparty logo (app
favicon for `platformAdmin`), the display name (bold when unread), a short
relative timestamp (`timeAgoShort`, `chat-types.ts:111`), the last-message
preview, and an unread badge capped at `10+`.

### Search

The thread sidebar has a search input (`thread-list.tsx:134-138`) that filters by
display name, case-insensitively, across both grouped and overview modes.

## Messages

`chat.messages` (`server/src/routers/chat.ts:170`) returns keyset-paginated
history, newest-first, walking backwards via an opaque `(timestamp, id)` cursor on
the `chat_messages_thread_idx` index — O(page) regardless of thread depth, with no
`count()` scan. The compound key disambiguates messages sharing a millisecond.
Messages carrying a `projectId` are hydrated with a lightweight project card
`{ id, title, status }`.

The message panel (`message-panel.tsx`) renders the stream with `react-virtuoso`
so the DOM stays bounded at any depth. On (re)open it collapses the cache to the
newest page and refetches it; older pages load on scroll-to-top, with Virtuoso's
virtual base index shifted so the viewport never jumps (`message-panel.tsx:558-598`).
Outgoing sends and incoming realtime rows are spliced into the cache (deduped by
id) rather than triggering a refetch (`appendMessage`, `message-panel.tsx:429`).

### Message types and attachments

`chat.send` (`server/src/routers/chat.ts:267`) accepts a type of `text | image |
video | document`; the `message_type` enum (`schema.ts:214`) additionally carries
`system`. The composer has an attach button (`Paperclip`) that opens a file
picker; the file kind is inferred from its extension (`fileTypeFromName`,
`message-panel.tsx:111`), uploaded to the chat storage bucket with a progress bar,
then sent as a file message. Bubbles render:

- **image** → inline thumbnail, opens in the file viewer on click;
- **video** → inline `<video controls>`;
- **document** → a file card with name + formatted size, opens in the file viewer;
- **system** → a centered grey notice (`message-panel.tsx:212`).

A chat attachment sent in a brand thread is mirrored into the brand's Document
Locker (`recordLockerFile`, `chat.ts:333-363`): brand↔agency threads → that
agency's documents (all involved agencies for an `all` group thread); brand-only
threads → private documents.

### Composer

A multi-line auto-sizing `<textarea>` (`message-panel.tsx:878`): Enter sends,
Shift+Enter inserts a newline; the desktop placeholder shows the shortcut. Sends
are optimistic — an outgoing bubble (sharing the message's pre-generated uuid)
appears immediately with a spinner, persisted per-thread in the pending store
(`pending-messages.ts`). On success the confirmed row replaces it; on failure the
bubble turns into a red card with inline Retry / Delete actions
(`PendingBubble`, `message-panel.tsx:259`). Own sends always scroll to the bottom;
incoming messages only auto-scroll when the viewport is already near the bottom.

### Message grouping, dividers, sender headers, avatars

Consecutive messages from the same sender are grouped: the timestamp + read tick
collapse onto the newest bubble of a run (`showMeta`, `message-panel.tsx:759`),
and a sender header (name • role at entity, with role coloring via
`roleColorClass`, `chat-types.ts:175`) appears above the first bubble of a run
(`SenderHeader`, `message-panel.tsx:150`). Time dividers separate runs on the
first message, a ≥2-minute gap, or a new calendar day (`shouldShowTimeDivider`,
`chat-types.ts:141`); the label is a time / "Yesterday" / weekday / dd/MM/yyyy
(`timeDividerLabel`, `chat-types.ts:153`). Incoming bubbles show the sender's
avatar.

### Read receipts

`chat.markRead` (`server/src/routers/chat.ts:373`) zeroes the user's
`unreadCount` and advances their `lastReadMessageId` / `lastReadAt` on their
`chat_thread_members` row, fired whenever the panel opens or the newest message
changes. `chat.readState` (`chat.ts:393`) returns every *other* member's
last-read pointer. A sent message shows a single tick until **every** other
member's last-read time has reached it (the minimum across members), then a
double tick (`allOthersLastReadAt`, `message-panel.tsx:417`). When a peer marks
the thread read, a `read` broadcast on the per-thread channel prompts an
immediate re-fetch of the read state so the tick flips live
(`message-panel.tsx:499`, `:526`).

### Typing indicators

Typing is ephemeral, carried over a Supabase Realtime `broadcast` on the
per-thread channel (no DB write). Local typing is throttled to one ping per
1.5s (`TYPING_THROTTLE_MS`); a peer is shown as typing for ~4s after their last
ping (`TYPING_EXPIRY_MS`, `message-panel.tsx:106-109`). The footer renders
animated dots and "{name} is typing" / "N people are typing"
(`TypingIndicator`, `message-panel.tsx:316`).

### Project attachments

A message can carry a `projectId`. The panel shows an attached-project chip above
the composer (`message-panel.tsx:855`) and renders a tappable project card under
the bubble (`ProjectCard`, `message-panel.tsx:173`) with a status dot
(`projectStatusColor`, `chat-types.ts:191`). Tapping routes to the correct
projects board by role then pushes the project detail (`openProject`,
`chat.tsx:191`).

## Members dialog

The panel header shows the member count; tapping it opens the members dialog
(`members-dialog.tsx`). `chat.members` (`server/src/routers/chat.ts:222`)
resolves each member's role (Owner / Staff / Contractor / Member) and entity
(brand or agency business name) by cross-referencing the thread's brand/agency
ownership and staff rows, and returns the membership-side `role` (brand / agency
/ contractor / user / admin) used for role coloring.

## Auto-thread creation and lifecycle

Threads are created automatically on relationship events
(`server/src/modules/chat/threads.ts`):

| Trigger | Function | Wired at | Result |
| --- | --- | --- | --- |
| Brand↔agency connect | `ensureChatConnection` → `createConnectionThreads` | `connections/connect.ts:37` | One `all` group thread + per-member `brandAgencyStaff` 1:1s + a system notice |
| Contractor joins agency | `createContractorThread` | `connections.ts:233,268`, `contractor/connect.ts:47`, `tasks.ts:1233` | One `agencyContractorPersonal` thread + system notice |
| Contractor removed | `handleContractorRemovedFromAgency` | `connections.ts:300`, `contractor.ts:203` | Archives the contractor threads + system notice |
| Staff chat permission granted | `handleStaffPermissionGranted` | `auth.ts:585`, `staff.ts:128,156`, `tasks.ts:1184` | Opens brand-side and/or internal-staff 1:1 threads |
| Staff chat permission revoked | `handleStaffPermissionRevoked` | `staff.ts:157,172` | Archives the staff member's memberships of the revoked types |
| Signup / open chat | `ensurePlatformAdminThread` | `auth.ts:378,872`, `chat.ts:419` (`ensureSupportThreads`) | Idempotently ensures the user's `you` self-thread + `platformAdmin` support thread (with the super-admin) + welcome system message |

Permission-gated visibility is real: `handleStaffPermissionGranted`
(`threads.ts:256`) keys off the `chatWithBrands` / `chatWithStaffs` permissions to
decide which threads to open, and `handleStaffPermissionRevoked` (`threads.ts:332`)
archives the corresponding memberships when those permissions are lost.

System messages are posted via `postSystemMessage` (`threads.ts:23`), which
inserts a `type='system'` message (sender name "System") and bumps the thread
preview.

## Unread counts and badges

Unread is a per-membership integer (`chat_thread_members.unreadCount`), bumped on
every send for all recipients (`chat.ts:316`) and zeroed on `markRead`.

- **`chat.totalUnread`** (`chat.ts:405`) sums unread across the user's threads —
  drives the sidebar / floating-panel badge (`floating-message-panel.tsx:26`) and
  the header badge (`chat.tsx:250`).
- **`chat.unreadByIdentity`** (`chat.ts:124`) buckets unread by identity key
  (`{type}_{entityId}`, e.g. `agency_<id>`, `user_<uid>`, `platformAdmin_app`),
  resolving the bucket from the membership `role` and the thread's brand/agency.
  Drives the per-identity pills on the "Chat as" selector.

## Chat-launch navigation

External entry points (project chips, client/agency "Chat" buttons) route through
the shared chat-nav context (`chat-nav-context.tsx`) and
`chat.resolveNavigation` (`server/src/routers/chat.ts:429`) →
`resolveChatNavigation` (`server/src/modules/chat/navigation.ts:70`). Given an
intent (`allThread | brandThread | agencyThread | interAgencyThread |
personalThread`) plus a brand and optional agency/target-user, it picks the best
identity (`pickIdentity`, prefers the agency identity for the project's agency,
then brand, then contractor) and resolves the target thread (`findGroupThread` /
`findPersonalThread`), returning `{ identityType, entityId, brandId, threadId }`
for the client to open. A null `threadId` still opens the panel to the resolved
identity. The brand/agency "group" intents resolve to the connection's `all`
thread; inter-agency resolves to the `interAgency` thread linking the two
agencies on that brand.

## Live delivery

Realtime is delivered via Supabase. `chat_threads`, `chat_thread_members`, and
`chat_messages` are in the `supabase_realtime` publication and protected by RLS
that scopes delivery to the user's own threads (`server/sql/rls.sql:11-37,277`);
`chat_thread_members` uses `replica identity full` so unread-count updates carry
their full row.

- **Thread list** — a `chat:thread-list` channel subscribes to `chat_threads`
  INSERT/UPDATE and the user's own `chat_thread_members` changes; a send bumps
  `last_message(_at)` and `unread_count`, which is the broadcast signal that a
  conversation changed. Refreshes are debounced 250ms (`chat.tsx:212-229`).
- **Open thread** — a per-thread `thread:{id}` channel subscribes to
  `chat_messages` INSERT (new rows appended O(1) to the cache), plus `read` and
  `typing` broadcasts (`message-panel.tsx:509-556`).

## Digest emails

On send, a debounced chat-digest email is scheduled for each recipient via
`scheduleChatDigests` (`server/src/lib/notify.ts:81`); the worker checks email
unsubscribes and whether the thread is still unread at fire time, and a presence
heartbeat suppresses digests for active users. Users opt out of the `chat` email
channel from the email-preferences card
(`client/src/pages/profile/email-preferences-card.tsx`), backed by the
`emailUnsubscribes` table.

## Data model

`chat_threads` (`schema.ts:1203`) — `id, connectionId, name, type, agencyIds[],
brandId, participantAId, participantBId, contractorId, createdBy, lastMessage,
lastMessageAt, isArchived`.

`chat_thread_members` (`schema.ts:1228`) — composite PK `(threadId, userId)`,
plus `role, unreadCount, lastReadMessageId, lastReadAt, isArchived, joinedAt`.
Per-member unread and last-read state is normalized here.

`chat_messages` (`schema.ts:1247`) — `id, threadId, senderId, senderName,
senderAvatar, senderRole, senderBusinessName, content, type, fileUrl, fileName,
thumbnailUrl, fileSize, replyToId, projectId, timestamp`, indexed on
`(threadId, timestamp)` for keyset pagination.

Typing state and the per-identity unread index are not persisted tables: typing
is ephemeral Realtime broadcast, and per-identity unread is aggregated on demand
from `chat_thread_members` in `chat.unreadByIdentity`. Thread-type and
message-type enum values are stored camelCase, matching the wire types.
