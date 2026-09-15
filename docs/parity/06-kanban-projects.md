# Projects: Kanban Pipeline, Project Detail & Contractor Workspace

Production-workflow surface for projects: a permission-gated Kanban board, a full project detail screen, the agency↔brand↔contractor approval flow, and the contractor's assigned-work workspace.

Primary code:
- Board + cards: `client/src/pages/projects-board.tsx`
- Project detail screen: `client/src/pages/projects/project-detail.tsx`
- Shared transition dialogs (brief, allocate, deliverables, approvals, completion): `client/src/pages/projects/workflow-transition-dialogs.tsx`
- Drop-action mapping: `client/src/pages/projects/transition-action.ts`
- Cycle price (single source of truth): `client/src/pages/projects/cycle-price.ts`
- Deliverables list (shared): `client/src/pages/projects/deliverables-panel.tsx`
- File annotation editor: `client/src/components/file-annotator/file-annotator.tsx`, `annotatable.ts`
- Contractor connections page: `client/src/pages/contractor.tsx`
- Contractor assigned-work workspace: `client/src/pages/contractor/projects.tsx`
- Server: `server/src/routers/projects.ts`, `server/src/routers/contractor.ts`, `server/src/routers/tasks.ts`
- Schema: `server/src/db/schema.ts` (`projects`, `projectDeliverables`, `projectRevisions`, `projectNotes`, `agencyContractorConnections`)

## Status pipeline

Projects move through a fixed ordered status enum (`STATUSES`, `projects.ts:42`):

`clientBrief → upcoming → brief → allocate → production → internalApproval → revision → clientApproval → completed`

The board renders one column per status (`STAGES`, `projects-board.tsx:30-40`), each carrying a Material status color used for the header dot, an 8%-alpha tinted column background, a 20%-alpha border, and the valid drop-target highlight (15% fill + solid 2px border). An invalid drop target while dragging shows a red (`244,67,54`) tint.

| Status | Column label | Color |
| --- | --- | --- |
| `clientBrief` | Client Brief | `#607D8B` |
| `upcoming` | Future Phases | `#607D8B` |
| `brief` | Brief | `#607D8B` |
| `allocate` | Allocate | `#FF9800` |
| `production` | Production | `#2196F3` |
| `internalApproval` | Internal Approval | `#9C27B0` |
| `revision` | Revision | `#FFC107` |
| `clientApproval` | Client Approval | `#009688` |
| `completed` | Completed | `#4CAF50` |

## Permission state machine

`getAllowedTransitions` (`projects.ts:113-212`) computes the viewer's allowed next statuses for a project, keyed on current status and the viewer's identity. It is evaluated server-side for every board card (batched via `buildBoardContextFactory`, `projects.ts:298-356`) and for the detail screen (`buildTransitionContext`, `projects.ts:225-289`); the result is returned to the client as `allowedTransitions` so the UI can gate drag/drop and choose the right dialog. The server re-validates on every `setStatus`/decision mutation, so the client gate is advisory only.

Identity dimensions:
- **Brand context** (no active agency): only the project's brand owner/staff/selected-brand user may act. They can move `clientBrief → brief|upcoming` and `clientApproval → completed|internalApproval|revision`.
- **Agency context**: the active agency must be the project's fulfilling agency (or super-admin).
  - **Agency owner / super-admin**: full per-stage transitions for every stage they own.
  - **Staff / designees**: gated per capability — `canAddBrief` (owner, `briefingDesigneeId`, or `addBrief` permission), `canAllocate` (owner, `allocationDesigneeId`, or `allocatePeople`), `canApproveDeliverable` (owner, `approvalDesigneeId`, or `approveDeliverable`).
  - **Assigned person** (`isAssignedPerson`): the staff member or contractor assigned to the project may push `production → internalApproval` and `revision → internalApproval|production`.
- A card is draggable on the board only when the viewer has at least one allowed transition (`projects-board.tsx:459`); brand users on a card they cannot move see it static.

Helper functions: `canAddBrief` / `canAllocate` / `canApproveDeliverable` / `isAssignedPerson` / `canClientApprove` (`projects.ts:73-97`).

## Drop-action resolution

`resolveDropAction(from, to, { workspace, isInternal })` (`transition-action.ts:64-73`) maps a permitted drop to the dialog/action it opens. Direct (dialog-less) transitions: `startRevision` (`revision → production`), `moveToClientBrief` (`upcoming → clientBrief`), `forceStartUpcoming` (`upcoming → brief`), and an agency advancing `completeClientBrief`. Everything else opens the shared `WorkflowTransitionHost`. The same resolution drives both the board's `onDragEnd` (`projects-board.tsx:256-286`) and the detail screen's workflow buttons (`project-detail.tsx:552-567`) so a button does exactly what dragging the card to that column does.

Completion is never a direct write — it always opens a deliverable-review dialog first. The completion branch (`resolveDropAction`): a brand or an internal project completes directly (`directComplete`); an agency completing an external project requests the brand confirm by email (`markComplete`).

## Transition side effects

`setStatus` (`projects.ts:719-778`) and the dedicated decision mutations run the workflow engine, not a bare status write:

- **`internalApproval → revision` (reject)** — `rejectToRevision` (`projects.ts:1894-1919`): inserts an agency-source `projectRevisions` row, increments `revisionCount`, stores `revisionNote` / `revisionComments` / `revisionAttachmentUrls`, sets status `revision`.
- **`internalApproval → clientApproval` (approve)** — stamps `approvedBy`/`approvedAt`, advances. Also exposed as `internalApprovalDecision` (`projects.ts:1136-1152`).
- **`clientApproval → internalApproval|revision` (client reject)** — `clientReject` (`projects.ts:1922-1947`): inserts a brand-source revision, increments `clientRevisionCount`, returns the project to internal approval.
- **`→ completed`** — `completeProject` (`projects.ts:1973-2021`): auto-approves all outstanding deliverables and moves them to the agency partition; for recurring services clears the production assignee and schedules the next cycle (`onRecurringProjectCompleted`); copies approved file deliverables into the brand document locker (`copyDeliverablesToLocker`); records `approvalMethod`/`approvedAt` for manual completions.
- **`clientBrief → brief|upcoming`** — landing status is decided by the phase start time, not the dropped column (`briefLandingStatus`, `projects.ts:105-110`): a `delayed-start` project whose `nextCycleAt` is still in the future parks in `upcoming` (re-arming the activation job via `scheduleProjectCycle`); otherwise it advances to `brief`.
- **`brief → allocate`** — `completeBrief` (`projects.ts:854-864`): stores brief documents + context, advances. Requires `canAddBrief`.
- **`allocate → production`** — `allocate` (`projects.ts:939-1008`): validates the contractor↔agency `active` connection (`assertContractorConnected`), enforces the contractor budget ceiling, sets assignee/type/budget/duration, links brand↔agency (`connectBrandToAgency`), books the contractor payout + invoice and deducts the fee from the agency owner's payout (`applyContractorFee`). Internal projects with a contractor budget stay in `allocate` until paid; the Stripe webhook then advances them (`advanceInternalProjectToProduction`).
- **Mark complete (agency, external)** — `markProjectComplete` (`projects.ts:1191-1213`): stamps a one-click confirmation token (10-day expiry), moves the project into `clientApproval`, and emails the brand owner. The brand's link completes it via `finalizeCompletion` (`projects.ts:1602-1616`).

All status changes fire `notifyProjectStatus` (`projects.ts:1627-1652`) to generate workflow tasks/emails (best-effort).

## Board

`ProjectsBoardPage` (`projects-board.tsx`) renders the pipeline for the active agency or brand. Cards are clickable (open `/project/:id`) and draggable when permitted. Features:

- **Server-side search** (`board.search`, `projects.ts:416-426`): debounced 300ms, case-insensitive ILIKE across title, task title, service name, package name, and description.
- **Filters**: agency view filters by brand / service name / service type; brand view filters by fulfilling agency / service type. Option lists come from `boardFacets` (`projects.ts:496-538`), derived from the unfiltered scope so dropdowns stay stable as the board narrows. On mobile, filters + column picker collapse into a single Filters sheet.
- **Column visibility**: per-user hidden columns persist to `users.uiPreferences.hiddenKanbanColumns` via `users.updateUiPreference`; the `ColumnsButton` picker (`projects-board.tsx:536`) toggles them.
- **Per-column total**: agency view shows the summed `cyclePrice` of the column as a green chip in the header alongside the count badge.
- **Drag UX** (`@dnd-kit` PointerSensor, 5px activation): a rotated (~2.86°), 90%-opacity drag overlay (334px); the source card fades to 50%; valid/invalid drop highlight only while a card hovers; grab-anywhere horizontal panning (`useDragScroll`). Optimistic move with snapshot rollback on error.
- **Loading**: 4 skeleton columns. **Empty**: "No projects yet" (or "No matching projects" when filters are active).

### Card content

`CardView` (`projects-board.tsx:476-533`) mirrors the canonical project card:
- Counter-party prefix: agency view shows the client brand name, brand view shows the fulfilling agency name (resolved server-side, `partyNameFor`, `projects.ts:474-477`).
- Assignee avatar (agency view), deadline (calendar icon, red when overdue and not completed), overdue red border.
- Revision badges: `CR{n}` (client revisions, red) and `R{n}` (internal revisions, amber).
- Package-name pill; cycle price (green, agency view) via `projectPriceSummary`.
- Density variant for the agency view (tighter padding, smaller title).

## Project detail screen

`ProjectDetailPage` (`project-detail.tsx`, route `/project/:id`) is the full workspace, backed by `projects.byId` (`projects.ts:569-687`). It enforces per-side visibility server-side and the client renders accordingly:

- **Header**: title, package · service subtitle, service-type badge, status badge, canonical cycle price, next-cycle info line for recurring projects, and an `inferAction` danger control (Delete / Cancel Subscription, or a "Refund Requested" / "Cancelled on …" / "Cancellation requested" status label). Completed non-subscription projects are terminal (no delete).
- **Chat chips** (`ChatChips`): launch the brand thread, agency thread (or inter-agency thread), or the assignee's personal thread. A contractor sees the brand name as context but the chip is inert (they communicate through the agency).
- **Project selections**: the brand-selected variant + add-ons, shown to everyone so the production side knows the scope.
- **Client-brief form**: when status is `clientBrief` and the viewer is the brand, renders the custom-field questionnaire (`ClientBriefForm`) using the Info Hub field renderers (selects, dates, file/audio/image uploads, colour palettes, addresses, with validation). Submitting (`submitBrief`, `projects.ts:803-851`) advances the project and copies answer files into the brand document locker.
- **Brand Workspace** (brand + agency, hidden from contractors): the brand's answered brief questions, shared documents (either side may upload), and a shared text thread (`addBrandWorkspaceNote`, `projects.ts:908-931`, recording the author).
- **Agency workspace** (agency + assigned contractor, never the brand): description, agency-side brief documents, and inline-editable brief context / contractor budget / budget note / estimated duration (`updateDetails`, `projects.ts:781-800`).
- **Workflow actions**: stage-appropriate buttons that route through `resolveDropAction` into the shared dialog host, including "Pay & start" for unpaid internal projects and "Complete on client's behalf" (manual completion, detail-only).
- **Deliverables**: hidden from the brand until `clientApproval`/`completed`; editable by agency members and the assigned contractor.
- **Revisions**: internal review history, never shown to the brand; each entry shows source (Client/Internal), author, date, body, and attachment links.
- **Notes**: brand notes visible to brands, agency notes visible to contractors (`addNote`, `projects.ts:1217-1232`).

### Per-side visibility (server-enforced)

`projects.byId` strips fields by viewer type before sending them (`projects.ts:639-686`):
- **Brand**: only brand-source materials, plus agency-source deliverables once the work reaches `clientApproval`/`completed`. No description, internal context, contractor budget/duration, assignee identity, or agency-source notes/revisions/docs.
- **Contractor** (assigned individual, neither agency member nor brand user): the agency-side workspace (description, agency brief docs, context/budget/duration) but no brand-private pricing (`amount` nulled), no brand-answered questions, no brand↔agency thread. Selected variant/options/add-ons stay (work scope).

The `viewer` object also returns `isAgencyOwner` / `isAgencyMember` / `isBrandUser` / `isContractor` and the capability booleans for client gating.

## Transition dialogs

`WorkflowTransitionHost` (`workflow-transition-dialogs.tsx:73-321`) is one self-contained host shared by the board and detail screen. It owns its mutations and renders the right dialog per action:

- **Submit brief** (`completeClientBrief`): the brand fills the custom-field brief.
- **Complete brief** (`completeBrief`): agency uploads brief documents + context; requires at least one document or notes before completing.
- **Allocate** (`allocateProject`): `AllocateForm` with Contractor/Staff tabs, assignee select, contractor budget (capped at `maxContractorBudget` from `contractorBudgetCeiling`, `projects.ts:1807-1812`, with an over-budget warning), estimated hours, and a budget note. Internal + contractor + budget orchestrates Stripe checkout in a reserved tab; the webhook advances to production.
- **Manage deliverables** (`uploadDeliverable`): `DeliverablesPanel` plus "Submit & complete → Internal approval".
- **Internal / client approval** (`internalApprove` / `internalReject` / `clientReject` / `directComplete` / `markComplete`): `ApprovalDialog` shows the deliverable list for review, an Approve / Request-revision flow with a required rejection reason, attachment upload, and a **PDF/image annotation editor** (`FileAnnotator`, lazy-loaded pdfjs + pdf-lib) — reviewers mark up a deliverable or attachment and attach the markup as revision feedback. `markComplete` shows the "brand confirms by email" notice banner.
- **Manual completion** (`manualClientApprove`): agency completes an external project on the client's behalf, recording the confirmation method and a back-dated approval time (cannot be reverted).

## Deliverables

`DeliverablesPanel` (`deliverables-panel.tsx`) is shared across the agency detail screen, the transition dialogs, and the contractor workspace. Capabilities:
- Upload image/document (multi-file, with compression progress and faded "Uploading…"/"Saving…" optimistic rows).
- Add a **headline** (`# `-prefixed text deliverable, rendered as a bold section header) or a **note** (plain text).
- Inline rename/edit, remove (with confirm), and drag-to-reorder (`@dnd-kit` sortable, persisted via `reorderDeliverables` setting each row's `sortOrder`).
- Per-deliverable status badge (approved/rejected/pending) and an annotate (highlighter) action on annotatable files.
- Deliverables are locked once the project is `completed` (their files are already in the locker); new deliverables may still be added.

Server: `addDeliverable` / `updateDeliverable` / `removeDeliverable` / `reorderDeliverables` / `reviewDeliverable` (`projects.ts:1029-1130`), authorized to the assigned contractor, agency members, or brand members.

## Recurring / cyclic projects

Recurring services (`hasDeliverableCycle`) carry `nextCycleAt`, `cycleCount`, `deliverableFrequency`, `repeatsEvery`, and a cycle price. The detail header shows "Next Cycle: … (after N weeks)". On completion, `onRecurringProjectCompleted` re-cycles via the exact-time schedule engine (re-opens now if due, or arms a job at `nextCycleAt`, anchored to the previous boundary with no drift), clears the production assignee, and bumps `cycleCount` on reset. `cyclePrice` (`cycle-price.ts`) is the single source of truth shared by the card, detail header, and dialog headers.

## Delete / cancel / refund

`project-detail.tsx`'s `inferAction` exposes the right danger control by project type:
- **`softDelete`** (`projects.ts:1236-1260`): voids the not-yet-paid contractor payout and re-credits the agency owner (`reverseContractorFee`), issues a Stripe refund of `proposedRefundAmount`, sets `deletedAt`. Completed projects cannot be deleted.
- **`cancelSubscription`** (`projects.ts:1262-1300`): only recurring service / recurring product (Ships) subscriptions are cancellable; stops this project's recurring billing (cancels the whole Stripe subscription only if it was the last recurring project) and notifies brand + agency. Either the fulfilling agency or the owning brand may cancel.
- **`requestSoftDeleteConfirmation`** (`projects.ts:1326-1340`): stamps a token + proposed refund and emails the brand owner; the project is deleted only when the brand confirms via `finalizeSoftDelete` (`projects.ts:1575-1593`).
- **`removeRecurringItem`** (`projects.ts:1309-1318`): removes one recurring project from a multi-project subscription.

## Internal (agency-paid) projects

`createInternalProject` (`projects.ts:1357-1517`) creates work an agency runs itself and pays a contractor for. It resolves the service (existing `serviceId` or a `customService` payload), prices purely from contractor budgets, writes an internal purchase marked PAID immediately (payment deferred to allocate → production), and seeds the project at `brief`. The agency completes the brief, allocates + budgets a contractor, then pays (`payInternalProject`, `projects.ts:1524-1556`) — the agency bears the Stripe surcharge (grossed up so the contractor nets the full budget); the webhook advances allocate → production and books the payout. In dev (no Stripe) it advances directly.

## Contractor workspaces

Two distinct contractor surfaces:

### Connections (`contractor.tsx`)
- **My Agencies** (`ContractorContractsPage`): the contractor's agency relationships from `contractor.myConnections`, with accept/decline of invites (`connections.respondToContractorInvite`) and "Leave agency" (`contractor.leaveAgency`).
- **Find agencies** (`ContractorAgenciesPage`): browse platform-default verified agencies (`contractor.browseAgencies`, gated to `emailVerified && platformVerified`) and apply with a note (`contractor.applyToAgency`). Cards reflect Already Hired / Applied / Invited state.
- Profile create/edit: `contractor.create` (`contractor.ts:27-116`) — first creation promotes the user to `individualContractor`; supports email-invite and in-app-invite connection finalization.

### Assigned work (`contractor/projects.tsx`)
`ContractorProjectsPage` is the assigned-project workspace, backed by `contractor.myProjects` (`contractor.ts:214-239`), which returns every non-deleted project assigned to the contractor (excluding unpaid internal projects still in `allocate`) with deliverables + revision feedback.

- Projects grouped by status in a fixed order (`production, revision, brief, allocate, internalApproval, clientApproval, upcoming, completed`), each group collapsible (completed collapsed by default).
- Four sort modes: nearest/furthest due date, newest/oldest. The working deadline is computed from `updatedAt` + estimated hours over business days (`contractorDeadline`).
- **Contract card** (`ContractCard`): package pill, title, status badge, working deadline (red + "Overdue" when past), estimated hours, contractor budget. A revision callout (`RevisionCallout`) surfaces the latest rejection comments + annotated-document link when in `revision`. "Add deliverables" / "View deliverables" opens the manage dialog; "Complete" submits for approval (`contractor.submitForApproval`, `contractor.ts:351-382`, production/revision → internalApproval, warns when zero deliverables).
- **Manage Deliverables dialog**: backed by `contractor.projectById` (`contractor.ts:247-265`), shows brand/agency chips, budget + budget note, working deadline, brief context, the brand selections, the revision callout, and the shared `DeliverablesPanel` (add/rename/remove/reorder, editable only in production/revision). Deep-linkable via `?openProject=`.
- Contractor deliverable mutations enforce ownership via `productionAssigneeId` and reject access while a project is still `allocate` (unpaid internal).

## Data model

`projects`, `projectDeliverables`, `projectRevisions`, `projectNotes`, and `agencyContractorConnections` (`server/src/db/schema.ts`) carry the full domain: commissions, payment plans, custom-field responses, recurring fields (`nextCycleAt`, `cycleCount`, `deliverableFrequency`, `repeatsEvery`), soft-delete + cancellation tokens (`deletedAt`, `cancelledAt`, `softDeleteToken`/`softDeleteExpiry`, `completionToken`/`completionExpiry`, `proposedRefundAmount`), revision counters (`revisionCount`, `clientRevisionCount`) and revision detail (`revisionNote`, `revisionComments`, `revisionAttachmentUrl(s)`). Revision history is normalized into the `projectRevisions` table; deliverable provenance (`source`: brand/agency) drives per-side visibility.
