# Kanban Project Permissions

Source-of-truth for **who can move a project between Kanban columns**, the staff
permissions that gate each move, and the implicit access rules. This describes the
*resultant* model — read it before changing project workflow authorization.

## The four agency Project-Management permissions

Shown in the staff **Edit / Invite permissions** dialog under a **Project Management**
group (agency org type only). Defined server-side in `server/src/routers/staff.ts`
(`PERMISSIONS`) and labelled in `client/src/pages/agency/constants.ts`.

| Permission key       | UI label            | What it lets the staff member do                                   |
| -------------------- | ------------------- | ------------------------------------------------------------------ |
| `agencyProjects`     | **View Projects**   | See the projects tab / Kanban board (read access).                 |
| `addBrief`           | **Briefing**        | `clientBrief → brief`, `upcoming → brief`, `brief → allocate`.     |
| `allocatePeople`     | **Manage Allocations** | `allocate → production`, `production → internalApproval`.       |
| `approveDeliverable` | **Approval Manager**   | `internalApproval → clientApproval`, `internalApproval → revision`, and `clientApproval → completed`. |

There is **no separate "client approval" permission** — completing from client
approval is folded into **Approval Manager** (`approveDeliverable`).

The dialog also renders an **All** chip in the group: selecting it enables all four
keys at once (View Projects + the three workflow perms); clearing it disables all
four. The chip shows as selected exactly when all four are individually selected —
they go hand in hand.

## Who can perform a transition

For each move, the actor must be **one of**:

1. The **owning agency's owner** (or super-admin) — can always do every transition.
2. **Agency staff** with the gating permission for that move (table above), acting in
   the owning agency.
3. A **role designee** for that stage, set in **Roles & Commissions → Role designees**
   (`agencies.briefingDesigneeId` / `allocationDesigneeId` / `approvalDesigneeId`).
   A designee gets the corresponding capability without the permission being ticked.
4. For `clientBrief → brief` (and `clientBrief → upcoming`) only: the **brand** (brand
   owner or brand staff of the project's brand) can also do it.
5. The **assigned person** (the allocated contractor/staff) can submit their work:
   `production → internalApproval` and, in revision, `revision → internalApproval` /
   `revision → production`.

The permission helpers live in `server/src/routers/projects.ts`:
`canAddBrief`, `canAllocate`, `canApproveDeliverable` each return true for the agency
owner, the matching designee, or a staff member holding the permission.
`getAllowedTransitions` is the single state-machine consulted by both the board query
(`board`) and the `setStatus` mutation; the per-stage mutations
(`completeBrief`/`addBriefDocument`, `allocate`, `internalApprovalDecision`,
`clientApprovalDecision`) re-check the same helpers.

## Owning agency vs sales agency

A project can be visible to **two** agencies: the **owning agency** (the one
fulfilling the service the project came from) and a **sales agency** that merely
referred/sells it. **Only the owning agency can move the project.**

Enforced in `getAllowedTransitions`: if the viewer's active agency is not the
project's `agencyId` it returns `[]`, and `buildTransitionContext` loads the actor's
`staff` row from the project's owning agency — so a permission held in the *sales*
agency never grants transition rights over the project. A person needs the permission
on their staff record **in the owning agency specifically**.

## Implicit "View Projects" access

`agencyProjects` (View Projects) does **not** need to be ticked separately for people
who already do project work. `expandAgencyPermissions` (`server/src/trpc/permissions.ts`)
adds `agencyProjects` to the effective permission set when the staff member either:

- holds any workflow permission (`addBrief` / `allocatePeople` / `approveDeliverable`), or
- is a briefing / allocation / approval **role designee** of the agency.

This expansion is applied in two places so view access is consistent:

- `assertAgencyAccess(..., 'agencyProjects')` — the server route guard for all
  projects endpoints.
- `auth.me` — so the client computes the **Projects** nav item from the expanded set
  (`client/src/components/layout/nav-items.ts`).

## Transition dialogs

Moving a card opens the same confirmation dialog regardless of whether the actor is an
owner or a permitted staff member. Dialog selection is driven purely by the
`from → to` status pair in `client/src/pages/projects/transition-action.ts` and
rendered by `WorkflowTransitionHost` in `workflow-transition-dialogs.tsx` — there is no
role-specific dialog branching.

## Submitting the brief: `brief` vs `upcoming` (future phase) landing

`clientBrief → brief` and `clientBrief → upcoming` are **the same action**
(`completeClientBrief`). Which column is dropped on is irrelevant — the landing
status is decided entirely by the **phase start time** (`briefLandingStatus`), not
the drop target. Both entry points share that helper:

- the **brand** completing the questionnaire → `submitBrief` mutation;
- the **agency** advancing the stage (the brand form would 403 for agency users)
  → `setStatus` mutation, which computes the landing instead of writing the
  requested column.

The rule:

- **Lands on `upcoming` (future phase)** if the project is a delayed phase
  (`delayed-start` tag) whose phase start (`projects.nextCycleAt`, set from the
  proposal phase `startDelayDays` at fulfillment) is **still in the future**.
- **Lands on `brief`** if the start time has already passed, or the project is not
  a delayed phase.

When it parks in `upcoming`, `submitBrief` (re)arms the exact-time activation job
(`scheduleProjectCycle`) — needed because a project that started in `clientBrief`
was not scheduled at creation (fulfillment only schedules rows that start
`upcoming`). The job fires at the phase start and runs `runProjectCycle →
resetRecurringProject`, moving the project to `brief`. This is the **only**
automatic way out of `upcoming`.

From `upcoming` (once it has landed there) the project can **always** be moved to
`brief` manually by the agency owner or a **Briefing** holder/designee
(`upcoming → brief`, the `forceStartUpcoming` action) — and back to `clientBrief`.
The flow:

```
clientBrief ──submitBrief──► [ start time in future? ] ─yes─► upcoming ──(job at start / Briefing force)──► brief
                                        └─no──────────────────────────────────────────────────────────────► brief
```

Source: `server/src/routers/projects.ts` (`submitBrief`),
`server/src/modules/projects/recurring-schedule.ts` (`scheduleProjectCycle` /
`runProjectCycle`), `server/src/modules/projects/fulfillment-core.ts`
(`resolveInitialStatus`, `delayed-start` tag, `nextCycleAt`).

## Status flow (reference)

```
clientBrief ──► brief ──► allocate ──► production ──► internalApproval ──► clientApproval ──► completed
     │            ▲                         ▲                │  │                  │
     └► upcoming ─┘                         └── revision ◄───┘  └► clientApproval  └► (back to) internalApproval / revision
```

Statuses: `clientBrief, upcoming, brief, allocate, production, internalApproval,
revision, clientApproval, completed` (`server/src/db/schema.ts`).

## Notes / legacy

- The DB enum (`staff_permission`) still contains the older granular keys
  `moveToInternalApproval` and `fromClientApprovalToCompleted`. These are **no longer
  exposed or checked** — their behavior was folded into `allocatePeople` and
  `approveDeliverable` respectively. They are left in the enum for backward
  compatibility; no migration is required.
- Brand-side staff have only a plain **Projects** (`brandProjects`) view permission;
  brands have no workflow transition permissions (their only move is the
  `clientBrief`/`clientApproval` decisions described above).
