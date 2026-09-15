# Tasks

The Tasks surface is the platform's action-item inbox and lightweight team task board. It combines:

- **System tasks** — action items the platform generates automatically as side-effects of domain events (a staff invite, a proposal sent, a project entering client approval, a connection request, etc.). Acting on a system task performs the underlying domain action (accept the invite, verify the agency, make a component public…).
- **Manual tasks** — free-text to-dos a user creates for themselves or assigns to a teammate.

Both kinds flow through a four-column board (Inbox, To Do, Completed, Archived), with drag-and-drop reordering, cross-column moves, reassignment, attachments, per-task team visibility, and email notification.

## Key files

| Concern | Path |
| --- | --- |
| Router (procedures + system-task generation) | `server/src/routers/tasks.ts` |
| Schema (`tasks` table, `task_type`/`task_category` enums) | `server/src/db/schema.ts:216`, `:230`, `:1274` |
| Realtime ping helper | `server/src/lib/realtime.ts` (`pingTasksChanged`) |
| Email enqueue | `server/src/lib/notify.ts` (`enqueueEmail`); template `task-assigned` handled in `server/src/jobs/worker.ts` |
| Page shell (layout, viewed-tracking) | `client/src/pages/tasks.tsx` |
| Personal pane | `client/src/pages/tasks/my-section.tsx` |
| Team pane | `client/src/pages/tasks/team-section.tsx` |
| Task tile | `client/src/pages/tasks/task-tile.tsx` |
| Detail dialog | `client/src/pages/tasks/task-detail-dialog.tsx` |
| Drop list | `client/src/pages/tasks/task-drop-list.tsx` |
| New-task field | `client/src/pages/tasks/new-task-field.tsx` |
| Shared helpers (labels, summaries, optimistic cache) | `client/src/pages/tasks/task-utils.ts` |

## Data model

`tasks` (`schema.ts:1274`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | random |
| `type` | `task_type` enum | one of the 11 system types + `manual` (`schema.ts:216`) |
| `category` | `task_category` enum | `inbox` \| `todo` \| `completed` \| `archived` (default `inbox`) |
| `title` | text | system tasks carry a full sentence; manual titles capped at 50 chars |
| `description` | text | optional |
| `assigneeId` | uuid → `users.id` | the board owner; `onDelete: cascade` |
| `assignedBy` | text | a user uuid, or the literal `'system'` for auto-generated tasks |
| `sortOrder` | double precision | board ordering within a column; defaults to `-Date.now()` (newest on top) |
| `relatedEntityId` | uuid | the domain row a system task tracks (invite/proposal/project/connection/etc.) |
| `organizationId` / `organizationName` / `agencyName` / `brandName` | uuid / text | display + navigation context |
| `projectId` | uuid → `projects.id` | set for project/workflow tasks |
| `proposalId` | uuid → `proposals.id` | set for proposal tasks |
| `visibleTo` | uuid[] | team-visibility filter; `null`/empty = visible to the whole team, otherwise private to the listed users |
| `disableMailing` | boolean | suppresses the assignment email when true |
| `attachments` | text[] | uploaded file URLs |
| `metadata` | jsonb | type-specific routing (e.g. connection-request subtype: `invitation` / `application` / `brandAgency`) |
| `createdAt` / `updatedAt` | timestamptz | |

Indexes: `tasks_assignee_category_idx` on `(assigneeId, category)`; GIN `tasks_visible_to_idx` on `visibleTo`.

`users.lastTasksViewedAt` (`schema.ts:292`) records when the user last opened the Tasks screen, driving the unviewed-task indicator.

The 11 system task types are: `staffInvitation`, `agencyApproval`, `proposalPending`, `proposalAccepted`, `proposalChangeRequested`, `clientApprovalRequest`, `agencyWorkflowAction`, `connectionRequest`, `componentApproval`, `disciplineRequest`, `resourceApproval`.

## System-task generation

`server/src/routers/tasks.ts` exports reusable functions that other feature routers call as side-effects of domain events. Tasks are deduplicated on the tuple `(type, relatedEntityId, assigneeId)`.

Core primitives:

- `upsertSystemTask(params, db)` (`tasks.ts:77`) — creates a task, or re-opens a matching one that was completed/archived (moving it back to `inbox` and refreshing its metadata). New tasks land at the top (`sortOrder = -Date.now()`) and trigger an assignment email unless `disableMailing` is set.
- `completeSystemTask(type, relatedEntityId, assigneeId, db)` (`tasks.ts:145`) — moves one matching open task to `completed`.
- `completeTasksByEntity(relatedEntityId, db)` (`tasks.ts:166`) — completes every open task tied to an entity (used when a domain status moves on).
- `clearTasksByEntity(relatedEntityId, db)` (`tasks.ts:176`) — deletes open tasks for an entity (used when a cycle is abandoned, e.g. a rejected/expired proposal).
- `getSuperAdminIds(db)` (`tasks.ts:185`) — fan-out target for platform-wide review tasks.

Each domain event has a named entry point. The callers are wired across the server (`proposals.ts`, `projects.ts`, `agencies.ts`, `connections.ts`, `contractor.ts`, `spot.ts`, `staff.ts`, `resources.ts`, `billing/fulfillment.ts`, `projects/recurring-schedule.ts`):

| Event | Function (`tasks.ts`) | Task type → assignee | Completion |
| --- | --- | --- | --- |
| Staff invited | `onStaffInvited` (`:205`) | `staffInvitation` → invitee | `onStaffInvitationAccepted` (`:226`) |
| Agency pending verify | `onAgencyPendingApproval` (`:231`) | `agencyApproval` → all super admins | `onAgencyVerified` (`:253`) |
| Proposal status change | `onProposalStatusChanged` (`:258`) | `proposalPending` → brand owner; `proposalAccepted` / `proposalChangeRequested` → agency sender | completes prior task per transition; `rejected`/`expired` clear all |
| Project status change | `onProjectStatusChanged` (`:342`) | `clientApprovalRequest` → brand owner (clientApproval); `agencyWorkflowAction` → production assignee (production/revision) or approval designee (internalApproval) | prior status's tasks completed on every transition |
| Contractor connection | `onContractorConnectionRequest` (`:411`) | `connectionRequest` → contractor (invite) or agency owner (application) | active/rejected/revoked → `completeTasksByEntity` |
| Brand↔agency connection | `onBrandAgencyConnectionRequest` (`:451`) | `connectionRequest` → brand owner | `onBrandAgencyConnectionAccepted` (`:471`) |
| Info Hub section added | `onComponentPendingApproval` (`:481`) | `componentApproval` → brand owner | `onComponentApproved` (`:502`) |
| Discipline requested | `onDisciplineRequested` (`:507`) | `disciplineRequest` → all super admins | `onDisciplineResolved` (`:525`) |
| Resource submitted | `onResourcePendingApproval` (`:530`) | `resourceApproval` → all super admins | `onResourceApproved` (`:550`) |

Task titles are written to be unambiguous when a user has several brands/agencies — they name the relevant brand and the counterparty agency (see the title strings in each entry point).

## Router procedures

All procedures are `protectedProcedure` on `tasksRouter` (`tasks.ts:783`).

| Procedure | Purpose |
| --- | --- |
| `list` (`:785`) | A board column's tasks, sorted. Inputs: `category`, `sortMode`, optional `memberId` (manager view of a teammate), `assignedByMe`, `limit`/`offset`. Personal view returns the caller's own tasks only; the team view (`memberId`) returns that member's tasks minus any private to other users. Each row is enriched with the assigner's name + avatar. Returns `{ items, total, hasMore }`. |
| `connectionDetail` (`:832`) | For a `connectionRequest` task, the full counterparty entity (contractor profile for an application; agency for an invite or brand→agency request) so the detail dialog can render it. |
| `counts` (`:877`) | The caller's per-category totals `{ inbox, todo, completed, archived }`. |
| `unviewedCount` (`:891`) | Number of inbox tasks created/updated after `lastTasksViewedAt`. |
| `teamMembers` (`:902`) | Org members (owners → staff → contractors) the caller can manage, each with inbox/todo counts. |
| `create` (`:922`) | Create a manual task for self or a teammate (`assigneeId`). Emails the assignee unless self-assigned or `disableMailing`. |
| `update` (`:960`) | Edit a manual task's title/description (assignee or assigner). |
| `setCategory` (`:975`) | Move a task between columns, optionally pinning `sortOrder`. |
| `setSortOrder` (`:990`) | Set a single task's `sortOrder` (move-to-top / move-to-end). |
| `move` (`:1018`) | Drag-drop relocation. Reassigns category + assignee and slots the task between its drop neighbors by fractional insertion (reads the two neighbors' `sortOrder`, picks a value strictly between). Falls back to a full-column renormalization with even spacing when the float gap is exhausted (`renormalizeColumn`, `:751`). Pagination-safe — it never rewrites the whole list to small indices. |
| `reassign` (`:1083`) | Reassign a task to another user and reset it to `inbox`. Emails the new assignee unless `disableMailing`. |
| `delete` (`:1099`) | Permanently delete a task (assignee or assigner). |
| `setAttachments` (`:1108`) | Replace the attachment URL list (assignee or assigner). |
| `setVisibility` (`:1127`) | Toggle team visibility: `null`/empty = team-visible, a uuid list = private to those users. |
| `markTasksViewed` (`:1142`) | Stamp `lastTasksViewedAt`, clearing the "new" indicator. |
| `performAction` (`:1154`) | Execute the domain side-effect for a system task. See below. |

### Authorization

- `assertCanManage` (`:626`) — assignee or assigner may edit/delete/attach/set-visibility.
- `assertCanOrganize` (`:731`) — for move/reorder/recategorize/reassign, additionally allows a manager to organize a teammate's board (the teammate must resolve through `resolveTeamMembers`).
- `performAction` requires the caller to be the task's assignee.

### `performAction` behavior (`:1154`)

| Task type | Action | Result |
| --- | --- | --- |
| `staffInvitation` | Activate the staff row, set the user's role + selected org, fan out chat threads for granted permissions, complete the task | `navigate` → `/` (staff workspace) |
| `connectionRequest` (`brandAgency`) | `connectBrandToAgency` (creates connection + chat threads + default Info Hub sections), delete the request | `done` |
| `connectionRequest` (`invitation`/`application`) | Activate the contractor connection + create the contractor chat thread. An invited user without a contractor profile is routed to create one first (connection finalized later by `contractor.create`) | `done`, or `navigate` → `/create-contractor?agencyId=…` |
| `agencyApproval` | Verify the agency, complete every admin's approval task | `done` |
| `componentApproval` | Make the SPOT component public, complete | `done` |
| `resourceApproval` | Stamp `acceptedAt`, complete | `done` |
| `disciplineRequest` | Add the discipline to `globalSettings.disciplines`, delete the request, complete | `done` |
| `clientApprovalRequest` | — | `navigate` → `/dashboard` |
| `proposalPending`/`Accepted`/`ChangeRequested` | — | `navigateProposal` with `proposalId`, `brandId`, `isBrandView`; client switches into brand context for brand-side reviews then opens the proposal |
| `agencyWorkflowAction` | — | `navigateProject` with `projectId`, `agencyId`; client switches into the agency context then opens the board |

Navigation + role/context switching is performed client-side from the returned payload (`task-detail-dialog.tsx:98`).

## Realtime

Every task write calls `pingTasksChanged(...userIds)` (`server/src/lib/realtime.ts`), broadcasting a `changed` event on each affected user's `tasks:<userId>` channel. The team pane subscribes to every visible member's channel and refetches their board/counts on a ping (`team-section.tsx:51`), because RLS scopes task rows to assignee/`visibleTo` and table-level realtime alone would not reach a manager. The personal pane reconciles via `onSettled` invalidation after its own mutations, layered over optimistic cache updates.

## Email

A new system task, a manual task assigned to someone else, and a reassignment each enqueue a `task-assigned` email to the assignee via `enqueueEmail` (`maybeSendTaskEmail`, `tasks.ts:190`), unless the task has `disableMailing` set or the recipient has unsubscribed from the `task` channel (`emailUnsubscribes`). The team pane exposes a global toggle for the user's own `task` mailing channel (`team-section.tsx:69`).

## UI

### Page shell (`tasks.tsx`)

`PageHeader` ("Tasks — Your action items across the platform.") over a layout that adapts by role and viewport:

- **Desktop, non-contractor** — a two-pane split: personal pane `flex-[2]`, a hairline divider, team pane `flex-1`.
- **Desktop, contractor** — personal pane only, full width (contractors have no team pane).
- **Mobile, non-contractor** — a tabbed single-column layout ("My Tasks" / "Team"), each pane full width.

On landing, the page snapshots `me.lastTasksViewedAt` into a ref (so unviewed dots persist for the session), then calls `markTasksViewed` once to reset the baseline for the next visit.

### Personal pane (`my-section.tsx`)

- **Sort header** — a sort-mode cycle button (Manual order → Oldest first → Newest first, mapping to `default` / `createdAtAsc` / `createdAtDesc`) and an "Add" button that reveals an inline new-task field.
- **Four collapsible category sections** — Inbox and To Do expanded by default; Completed and Archived collapsed and lazily queried on expand (and dimmed: 70% / 50% opacity). Each shows its count, its tasks (paged 15 at a time with a "Load More" button), and a drop zone. Hovering a collapsed header while dragging auto-expands it.

### Team pane (`team-section.tsx`)

- Header with a task-mailing toggle and an "Assigned by me" filter checkbox.
- Members grouped into OWNERS / STAFF / CONTRACTORS sections (in that priority order), resolved by `resolveTeamMembers` (`tasks.ts:637`) across every agency/brand the user owns or actively staffs.
- Each member row shows avatar, name, a combined inbox+todo badge, and a "+" to add a task for that member. Expanding a member reveals their four category subsections. Dropping a task onto a member header reassigns it to that member (into inbox).

### Task tile (`task-tile.tsx`)

A draggable bordered row: an optional unviewed dot (with bold title and tinted background when unviewed), the display title, a relative timestamp (`timeAgo`), a team-visibility toggle (group ↔ private, shown to assignee/assigner only), an assigned-by avatar (a robot glyph for `system`, otherwise the assigner's avatar with a tooltip), a kebab context menu, and — on To Do tiles only — a complete checkbox. Inbox tiles intentionally have no checkbox.

Display title: system tasks render a concise, role-aware one-liner via `shortSummary` (`task-utils.ts:22`, e.g. "Proposal for Acme from Studio X"); manual tasks render their raw title.

The context menu (right-click or kebab) offers category-appropriate moves (Move to To-do / Completed / Archived, depending on the current column; archived tiles get none), Open details, Move to top, Move to end, and — on personal tiles — Delete (with a confirm dialog). Team-pane tiles get the reduced set (open / move-to-top / move-to-end).

### Detail dialog (`task-detail-dialog.tsx`)

A 520px modal:

- **Header** — display title; an edit pencil for manual tasks (assigner only).
- **Category badge row** — four clickable badges (colored dot per category) that move the task between columns immediately, with optimistic local state.
- **Title** — editable in edit mode (capped at `TASK_TITLE_MAX` = 50).
- **Metadata** — Type, Assigned by (System / You / a name), Organization, Agency, Brand (when present), Created.
- **Description** — editable in edit mode.
- **Connection profile** — for `connectionRequest` tasks, the full contractor or agency profile from `connectionDetail`.
- **Attachments** — upload (to `tasks/<id>` in the Uploads bucket) and remove; persisted immediately via `setAttachments`. The upload control shows to the assigner; existing attachments show to everyone.
- **Associations** — for the assignee of a system task, navigable chips to the linked Proposal / Project / Info Hub / Disciplines / Agencies / Resources surface (`associationsFor`, `task-utils.ts:292`).
- **Footer** — Delete (assignee or assigner); in edit mode, Cancel/Save; otherwise, for the assignee of an actionable system task, the type-specific action button (plus a secondary "View Agency" / "Review" button where applicable) that calls `performAction` and then navigates/switches context per the result.
