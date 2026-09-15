import { z } from 'zod';
import { and, eq, count, asc, desc, inArray, sql, or } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc/trpc.js';
import {
  tasks,
  users,
  staff,
  agencies,
  brands,
  agencyContractorConnections,
  brandAgencyConnectionRequests,
  contractors,
  spotComponents,
  resources,
  disciplineRequests,
  globalSettings,
  emailUnsubscribes,
} from '../db/schema.js';
import { enqueueEmail } from '../lib/notify.js';
import { pingTasksChanged } from '../lib/realtime.js';
import { createContractorThread, handleStaffPermissionGranted } from '../modules/chat/threads.js';
import { connectBrandToAgency } from '../modules/connections/connect.js';
import { db as defaultDb } from '../db/index.js';
import { TRPCError } from '@trpc/server';
import { generateKeyBetween } from 'fractional-indexing';

// ============================================================================
// Types
// ============================================================================

type Db = typeof defaultDb;
type TaskRow = typeof tasks.$inferSelect;
type TaskType = TaskRow['type'];
type TaskCategory = TaskRow['category'];

const categoryEnum = z.enum(['inbox', 'todo', 'completed', 'archived']);

// ============================================================================
// SYSTEM-TASK AUTO-GENERATION (reusable server functions)
//
// Mirrors functions/src/modules/tasks/task_utils.ts (upsertTask /
// completeTask / completeTasksByEntity) + the 9 on_*_written triggers.
// Other feature routers call these helpers as side-effects of domain events.
//
// Dedup model: Flutter uses a deterministic doc id `${entityId}_${assigneeId}`.
// Postgres `tasks.id` is a random uuid, so dedup is done on the tuple
// (type, relatedEntityId, assigneeId) instead. `upsertSystemTask` re-opens a
// completed/archived task when the cycle restarts, matching upsertTask().
// ============================================================================

export interface UpsertSystemTaskParams {
  type: Exclude<TaskType, 'manual'>;
  title: string;
  assigneeId: string;
  relatedEntityId: string;
  category?: TaskCategory;
  assignedBy?: string;
  organizationId?: string | null;
  organizationName?: string | null;
  agencyName?: string | null;
  brandName?: string | null;
  projectId?: string | null;
  proposalId?: string | null;
  visibleTo?: string[] | null;
  disableMailing?: boolean;
  metadata?: Record<string, unknown> | null;
}

/**
 * Create or re-open a system task for (type, relatedEntityId, assigneeId).
 * - If a matching task exists and was completed/archived, it is moved back to
 *   `inbox` (cycle restarted) and metadata refreshed.
 * - If it exists and is still inbox/todo, title/metadata are refreshed in place.
 * - Otherwise a new inbox task is created.
 * Returns the resulting task row (or null when assignee resolution fails).
 */
export async function upsertSystemTask(params: UpsertSystemTaskParams, db: Db = defaultDb): Promise<TaskRow | null> {
  if (!params.assigneeId) return null;

  const existing = (
    await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.type, params.type),
          eq(tasks.relatedEntityId, params.relatedEntityId),
          eq(tasks.assigneeId, params.assigneeId),
        ),
      )
      .limit(1)
  )[0];

  if (existing) {
    const reopen = existing.category === 'completed' || existing.category === 'archived';
    const [updated] = await db
      .update(tasks)
      .set({
        title: params.title,
        category: reopen ? (params.category ?? 'inbox') : existing.category,
        ...(params.organizationName ? { organizationName: params.organizationName } : {}),
        ...(params.agencyName ? { agencyName: params.agencyName } : {}),
        ...(params.brandName ? { brandName: params.brandName } : {}),
        ...(params.metadata ? { metadata: params.metadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, existing.id))
      .returning();
    await pingTasksChanged(params.assigneeId);
    return updated;
  }

  const [created] = await db
    .insert(tasks)
    .values({
      type: params.type,
      category: params.category ?? 'inbox',
      title: params.title,
      assigneeId: params.assigneeId,
      assignedBy: params.assignedBy ?? 'system',
      relatedEntityId: params.relatedEntityId,
      organizationId: params.organizationId ?? null,
      organizationName: params.organizationName ?? null,
      agencyName: params.agencyName ?? null,
      brandName: params.brandName ?? null,
      projectId: params.projectId ?? null,
      proposalId: params.proposalId ?? null,
      visibleTo: params.visibleTo ?? null,
      disableMailing: params.disableMailing ?? false,
      metadata: params.metadata ?? {},
    })
    .returning();

  // If a task was created, calculate and update its sortOrder to be at the top
  if (created) {
    const neighbors = await db
      .select({ id: tasks.id, sortOrder: tasks.sortOrder })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, created.assigneeId!), eq(tasks.category, created.category)))
      .orderBy(asc(tasks.sortOrder))
      .limit(1);
    
    const edgeOrder = neighbors[0]?.sortOrder ?? 'a0';
    const targetOrder = generateKeyBetween(null, edgeOrder);
    await db.update(tasks).set({ sortOrder: targetOrder }).where(eq(tasks.id, created.id));
  }

  // P1-6: email the assignee on a new system task (unless disabled/unsubscribed).
  if (created && !created.disableMailing) {
    await maybeSendTaskEmail(created, db);
  }
  await pingTasksChanged(params.assigneeId);
  return created ?? null;
}

/** Move the first matching open system task to completed (no re-open). */
export async function completeSystemTask(
  type: Exclude<TaskType, 'manual'>,
  relatedEntityId: string,
  assigneeId: string,
  db: Db = defaultDb,
): Promise<void> {
  await db
    .update(tasks)
    .set({ category: 'completed', updatedAt: new Date() })
    .where(
      and(
        eq(tasks.type, type),
        eq(tasks.relatedEntityId, relatedEntityId),
        eq(tasks.assigneeId, assigneeId),
        inArray(tasks.category, ['inbox', 'todo']),
      ),
    );
  await pingTasksChanged(assigneeId);
}

/** Complete every open task tied to an entity (mirrors completeTasksByEntity). */
export async function completeTasksByEntity(relatedEntityId: string, db: Db = defaultDb): Promise<void> {
  const affected = await db
    .update(tasks)
    .set({ category: 'completed', updatedAt: new Date() })
    .where(and(eq(tasks.relatedEntityId, relatedEntityId), inArray(tasks.category, ['inbox', 'todo'])))
    .returning({ assigneeId: tasks.assigneeId });
  await pingTasksChanged(...affected.map((t) => t.assigneeId));
}

/** Delete every open task tied to an entity (used when the cycle is abandoned). */
export async function clearTasksByEntity(relatedEntityId: string, db: Db = defaultDb): Promise<void> {
  const affected = await db
    .delete(tasks)
    .where(and(eq(tasks.relatedEntityId, relatedEntityId), inArray(tasks.category, ['inbox', 'todo'])))
    .returning({ assigneeId: tasks.assigneeId });
  await pingTasksChanged(...affected.map((t) => t.assigneeId));
}

/** All super-admin user ids (getSuperAdminIds). */
export async function getSuperAdminIds(db: Db = defaultDb): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isSuperAdmin, true));
  return rows.map((r) => r.id);
}

async function maybeSendTaskEmail(task: TaskRow, db: Db): Promise<void> {
  if (!task.assigneeId) return;
  const assignee = (await db.select({ email: users.email }).from(users).where(eq(users.id, task.assigneeId)).limit(1))[0];
  if (!assignee?.email) return;
  const unsub = (await db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.email, assignee.email)).limit(1))[0];
  if (unsub?.channels?.includes('task')) return;
  await enqueueEmail('task-assigned', { taskId: task.id, email: assignee.email });
}

// ----------------------------------------------------------------------------
// Trigger entry points — call these from other feature routers on domain events.
// Each is the new-stack equivalent of one functions/src/modules/tasks/on_*.ts.
// ----------------------------------------------------------------------------

/** on_staff_invitation_written: staffInvitation task → the invitee. */
export async function onStaffInvited(
  args: { staffId: string; assigneeId: string; orgName?: string | null; orgId?: string | null; orgType?: 'agency' | 'brand' | null; invitedBy?: string },
  db: Db = defaultDb,
): Promise<void> {
  // Name the role so the invitee can tell agency-staff from brand-staff invites.
  const role = args.orgType === 'agency' ? 'agency staff' : args.orgType === 'brand' ? 'brand staff' : 'staff';
  await upsertSystemTask(
    {
      type: 'staffInvitation',
      title: `You've been invited to join ${args.orgName ?? 'an organization'} as ${role}`,
      assigneeId: args.assigneeId,
      relatedEntityId: args.staffId,
      assignedBy: args.invitedBy ?? 'system',
      organizationId: args.orgId ?? null,
      organizationName: args.orgName ?? null,
    },
    db,
  );
}

/** Staff invite accepted → complete the invitation task. */
export async function onStaffInvitationAccepted(staffId: string, assigneeId: string, db: Db = defaultDb): Promise<void> {
  await completeSystemTask('staffInvitation', staffId, assigneeId, db);
}

/** on_agency_written: agencyApproval task → all super admins (pending verify). */
export async function onAgencyPendingApproval(
  args: { agencyId: string; agencyName: string },
  db: Db = defaultDb,
): Promise<void> {
  const adminIds = await getSuperAdminIds(db);
  for (const adminId of adminIds) {
    await upsertSystemTask(
      {
        type: 'agencyApproval',
        title: `Review agency: ${args.agencyName}`,
        assigneeId: adminId,
        relatedEntityId: args.agencyId,
        organizationId: args.agencyId,
        organizationName: args.agencyName,
        agencyName: args.agencyName,
      },
      db,
    );
  }
}

/** Agency verified → complete all approval tasks for it. */
export async function onAgencyVerified(agencyId: string, db: Db = defaultDb): Promise<void> {
  await completeTasksByEntity(agencyId, db);
}

/** on_proposal_written: route review/accept/change tasks per proposal status. */
export async function onProposalStatusChanged(
  args: {
    proposalId: string;
    status: string;
    brandOwnerId?: string | null;
    agencySenderId?: string | null;
    brandName?: string | null;
    agencyName?: string | null;
    organizationId?: string | null; // brand id (for navigate-to-proposal role switch)
  },
  db: Db = defaultDb,
): Promise<void> {
  switch (args.status) {
    case 'sent':
    case 'viewed':
      // proposalPending → brand owner reviews
      if (args.brandOwnerId) {
        await upsertSystemTask(
          {
            type: 'proposalPending',
            title: `Review ${args.agencyName ? `${args.agencyName}'s` : 'a'} proposal${args.brandName ? ` for ${args.brandName}` : ''}`,
            assigneeId: args.brandOwnerId,
            relatedEntityId: args.proposalId,
            proposalId: args.proposalId,
            organizationId: args.organizationId ?? null,
            brandName: args.brandName ?? null,
            agencyName: args.agencyName ?? null,
          },
          db,
        );
      }
      break;
    case 'accepted':
      // proposalAccepted → agency sender; clear the brand-side pending task.
      await completeTasksByEntity(args.proposalId, db);
      if (args.agencySenderId) {
        await upsertSystemTask(
          {
            type: 'proposalAccepted',
            title: `${args.brandName ?? 'A brand'} accepted ${args.agencyName ? `${args.agencyName}'s` : 'your'} proposal`,
            assigneeId: args.agencySenderId,
            relatedEntityId: args.proposalId,
            proposalId: args.proposalId,
            organizationId: args.organizationId ?? null,
            brandName: args.brandName ?? null,
            agencyName: args.agencyName ?? null,
          },
          db,
        );
      }
      break;
    case 'changeRequested':
      // proposalChangeRequested → agency sender revises; clear brand pending.
      await completeTasksByEntity(args.proposalId, db);
      if (args.agencySenderId) {
        await upsertSystemTask(
          {
            type: 'proposalChangeRequested',
            title: `${args.brandName ?? 'A brand'} requested changes to ${args.agencyName ? `${args.agencyName}'s` : 'your'} proposal`,
            assigneeId: args.agencySenderId,
            relatedEntityId: args.proposalId,
            proposalId: args.proposalId,
            organizationId: args.organizationId ?? null,
            brandName: args.brandName ?? null,
            agencyName: args.agencyName ?? null,
          },
          db,
        );
      }
      break;
    case 'rejected':
    case 'expired':
      await clearTasksByEntity(args.proposalId, db);
      break;
    default:
      break;
  }
}

/**
 * on_project_status_change: clientApprovalRequest (brand owner) or
 * agencyWorkflowAction (staff / contractor / approval designee) per status.
 * The previous status's task is cleared first.
 */
export async function onProjectStatusChanged(
  args: {
    projectId: string;
    status: string;
    assigneeType?: string | null;
    productionAssigneeId?: string | null;
    agencyId?: string | null;
    agencyName?: string | null;
    brandOwnerId?: string | null;
    brandName?: string | null;
    projectName?: string | null;
    approvalDesigneeId?: string | null;
    organizationName?: string | null;
  },
  db: Db = defaultDb,
): Promise<void> {
  // Leaving a status clears its outstanding workflow tasks for the project.
  await completeTasksByEntity(args.projectId, db);
  const projectLabel = args.projectName ? `"${args.projectName}"` : 'a project';

  if (args.status === 'clientApproval') {
    if (args.brandOwnerId) {
      await upsertSystemTask(
        {
          type: 'clientApprovalRequest',
          // Name the brand (the owner may have several) + which agency sent it.
          title: `${args.brandName ? `${args.brandName}: ` : ''}${projectLabel} ${args.agencyName ? `from ${args.agencyName} ` : ''}is ready for your approval`,
          assigneeId: args.brandOwnerId,
          relatedEntityId: args.projectId,
          projectId: args.projectId,
          organizationId: args.agencyId ?? null,
          organizationName: args.organizationName ?? args.agencyName ?? null,
          agencyName: args.agencyName ?? null,
          brandName: args.brandName ?? null,
        },
        db,
      );
    }
    return;
  }

  // production / revision → the assignee (staff or contractor) acts;
  // internalApproval → the agency approval designee acts.
  let target: string | null = null;
  if (args.status === 'production' || args.status === 'revision') {
    target = args.productionAssigneeId ?? null;
  } else if (args.status === 'internalApproval') {
    target = args.approvalDesigneeId ?? null;
  }
  if (!target) return;

  await upsertSystemTask(
    {
      type: 'agencyWorkflowAction',
      // Name the agency (a contractor/staffer may work for several) + the project.
      title: `${args.agencyName ? `${args.agencyName}: ` : ''}action needed on ${projectLabel}`,
      assigneeId: target,
      relatedEntityId: args.projectId,
      projectId: args.projectId,
      organizationId: args.agencyId ?? null,
      organizationName: args.organizationName ?? args.agencyName ?? null,
      agencyName: args.agencyName ?? null,
      brandName: args.brandName ?? null,
    },
    db,
  );
}

/** on_contractor_connection_written: connectionRequest both directions. */
export async function onContractorConnectionRequest(
  args: { connectionId: string; status: string; agencyId: string; contractorId: string; agencyOwnerId?: string | null; agencyName?: string | null },
  db: Db = defaultDb,
): Promise<void> {
  if (args.status === 'pendingInvite') {
    // Agency invited the contractor → task to contractor.
    await upsertSystemTask(
      {
        type: 'connectionRequest',
        title: `${args.agencyName ?? 'An agency'} invited you to join as a contractor`,
        assigneeId: args.contractorId,
        relatedEntityId: args.connectionId,
        organizationId: args.agencyId,
        organizationName: args.agencyName ?? null,
        agencyName: args.agencyName ?? null,
        metadata: { type: 'invitation' },
      },
      db,
    );
  } else if (args.status === 'pendingApplication' && args.agencyOwnerId) {
    // Contractor applied → task to agency owner.
    await upsertSystemTask(
      {
        type: 'connectionRequest',
        title: `A contractor applied to join ${args.agencyName ?? 'your agency'}`,
        assigneeId: args.agencyOwnerId,
        relatedEntityId: args.connectionId,
        organizationId: args.agencyId,
        organizationName: args.agencyName ?? null,
        agencyName: args.agencyName ?? null,
        metadata: { type: 'application' },
      },
      db,
    );
  } else if (args.status === 'active' || args.status === 'rejected' || args.status === 'revoked') {
    await completeTasksByEntity(args.connectionId, db);
  }
}

/** on_brand_agency_connection_request_written: connectionRequest → brand owner. */
export async function onBrandAgencyConnectionRequest(
  args: { requestId: string; brandOwnerId: string; brandName?: string | null; agencyId?: string | null; agencyName?: string | null },
  db: Db = defaultDb,
): Promise<void> {
  await upsertSystemTask(
    {
      type: 'connectionRequest',
      title: `${args.agencyName ?? 'An agency'} wants to connect with ${args.brandName ?? 'your brand'}`,
      assigneeId: args.brandOwnerId,
      relatedEntityId: args.requestId,
      organizationId: args.agencyId ?? null,
      organizationName: args.agencyName ?? null,
      agencyName: args.agencyName ?? null,
      brandName: args.brandName ?? null,
      metadata: { type: 'brandAgency' },
    },
    db,
  );
}

export async function onBrandAgencyConnectionAccepted(requestId: string, db: Db = defaultDb): Promise<void> {
  await completeTasksByEntity(requestId, db);
}

/**
 * on_component_written: when a SPOT section is added to a brand's info hub (and
 * isn't yet public), notify the BRAND OWNER to review it. Ports the Flutter
 * trigger (assignee = brand owner, not super-admins). Completed once the section
 * is made public (onComponentApproved).
 */
export async function onComponentPendingApproval(
  args: { componentId: string; brandOwnerId: string; brandId?: string | null; brandName?: string | null; templateName?: string | null; agencyName?: string | null },
  db: Db = defaultDb,
): Promise<void> {
  if (!args.brandOwnerId) return;
  const brandPart = args.brandName ? `${args.brandName}'s` : 'your';
  await upsertSystemTask(
    {
      type: 'componentApproval',
      title: `${args.agencyName ?? 'Your agency'} added a ${args.templateName ? `${args.templateName} ` : ''}section to ${brandPart} Info Hub — check it out`,
      assigneeId: args.brandOwnerId,
      relatedEntityId: args.componentId,
      organizationId: args.brandId ?? null,
      organizationName: args.brandName ?? null,
      brandName: args.brandName ?? null,
      metadata: { componentId: args.componentId },
    },
    db,
  );
}

export async function onComponentApproved(componentId: string, db: Db = defaultDb): Promise<void> {
  await completeTasksByEntity(componentId, db);
}

/** on_discipline_request_written: disciplineRequest → super admins. */
export async function onDisciplineRequested(
  args: { requestId: string; discipline: string },
  db: Db = defaultDb,
): Promise<void> {
  const adminIds = await getSuperAdminIds(db);
  for (const adminId of adminIds) {
    await upsertSystemTask(
      {
        type: 'disciplineRequest',
        title: `New discipline requested: ${args.discipline}`,
        assigneeId: adminId,
        relatedEntityId: args.requestId,
      },
      db,
    );
  }
}

export async function onDisciplineResolved(requestId: string, db: Db = defaultDb): Promise<void> {
  await completeTasksByEntity(requestId, db);
}

/** on_resource_written: resourceApproval → super admins (new agency resource). */
export async function onResourcePendingApproval(
  args: { resourceId: string; title: string; agencyName?: string | null },
  db: Db = defaultDb,
): Promise<void> {
  const adminIds = await getSuperAdminIds(db);
  for (const adminId of adminIds) {
    await upsertSystemTask(
      {
        type: 'resourceApproval',
        title: `Review resource: ${args.title}`,
        assigneeId: adminId,
        relatedEntityId: args.resourceId,
        organizationName: args.agencyName ?? null,
        agencyName: args.agencyName ?? null,
      },
      db,
    );
  }
}

export async function onResourceApproved(resourceId: string, db: Db = defaultDb): Promise<void> {
  await completeTasksByEntity(resourceId, db);
}

// ============================================================================
// Helpers shared by procedures
// ============================================================================

/** A task is visible to the user if they are the assignee or in visibleTo. */
function visibleToUser(userId: string) {
  return or(
    eq(tasks.assigneeId, userId),
    sql`${tasks.visibleTo} @> ARRAY[${userId}]::uuid[]`,
  )!;
}

/**
 * Team-pane privacy filter (mirrors the Flutter team queries): when viewing a
 * teammate's board, `userId` may see a task only if it's public (visibleTo
 * null/empty), it's shared with them, or it's their own. Without this a private
 * task leaks to every manager, not just its participants.
 */
function teamVisibleToUser(userId: string) {
  return or(
    sql`${tasks.visibleTo} is null`,
    sql`cardinality(${tasks.visibleTo}) = 0`,
    sql`${tasks.visibleTo} @> ARRAY[${userId}]::uuid[]`,
    eq(tasks.assigneeId, userId),
  )!;
}

const sortModeEnum = z.enum(['default', 'createdAtAsc', 'createdAtDesc']);
function orderForMode(mode: z.infer<typeof sortModeEnum>) {
  switch (mode) {
    case 'createdAtAsc':
      return asc(tasks.createdAt);
    case 'createdAtDesc':
      return desc(tasks.createdAt);
    default:
      return asc(tasks.sortOrder);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attach the assigner's display name + avatar to each task row so the tile can
 * render the assigned-by avatar (mirrors Flutter's userProvider(assignedBy)).
 * `assignedBy` is either the literal 'system' or a user uuid.
 */
async function enrichAssigners(db: Db, rows: TaskRow[]) {
  const ids = [...new Set(rows.map((r) => r.assignedBy).filter((v): v is string => !!v && UUID_RE.test(v)))];
  const map = new Map<string, { name: string | null; profileUrl: string | null }>();
  if (ids.length) {
    const us = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileUrl: users.profileUrl })
      .from(users)
      .where(inArray(users.id, ids));
    for (const u of us) {
      const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
      map.set(u.id, { name: name || null, profileUrl: u.profileUrl ?? null });
    }
  }
  return rows.map((r) => {
    const u = r.assignedBy && UUID_RE.test(r.assignedBy) ? map.get(r.assignedBy) : undefined;
    return { ...r, assignedByName: u?.name ?? null, assignedByProfileUrl: u?.profileUrl ?? null };
  });
}

async function loadTaskOr404(db: Db, id: string): Promise<TaskRow> {
  const task = (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

/** Assignee or assigner may mutate/delete a task. */
function assertCanManage(task: TaskRow, userId: string) {
  if (task.assigneeId !== userId && task.assignedBy !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to modify this task' });
  }
}

/**
 * Resolve the user's team members (org owners → active staff → active
 * contractors) for every agency/brand they own or staff. Mirrors
 * TeamOrganizationTeam member assembly + priority ordering.
 */
async function resolveTeamMembers(db: Db, user: typeof users.$inferSelect) {
  // Orgs the user owns or is active staff of.
  const [ownedAgencies, ownedBrands, staffOf] = await Promise.all([
    db.select({ id: agencies.id }).from(agencies).where(eq(agencies.ownerId, user.id)),
    db.select({ id: brands.id }).from(brands).where(eq(brands.ownerId, user.id)),
    db.select({ agencyId: staff.agencyId, brandId: staff.brandId }).from(staff).where(and(eq(staff.userId, user.id), eq(staff.status, 'active'))),
  ]);

  const agencyIds = new Set<string>(ownedAgencies.map((a) => a.id));
  const brandIds = new Set<string>(ownedBrands.map((b) => b.id));
  if (user.selectedAgencyId) agencyIds.add(user.selectedAgencyId);
  if (user.selectedBrandId) brandIds.add(user.selectedBrandId);
  for (const s of staffOf) {
    if (s.agencyId) agencyIds.add(s.agencyId);
    if (s.brandId) brandIds.add(s.brandId);
  }

  const agencyIdList = [...agencyIds];
  const brandIdList = [...brandIds];

  type Member = { id: string; name: string; email: string; profileUrl: string | null; role: 'owner' | 'staff' | 'contractor' };
  const byId = new Map<string, Member>();
  const claimed = new Set<string>([user.id]); // exclude self

  // 1) owners (highest priority)
  const ownerRows = [
    ...(agencyIdList.length ? await db.select({ ownerId: agencies.ownerId }).from(agencies).where(inArray(agencies.id, agencyIdList)) : []),
    ...(brandIdList.length ? await db.select({ ownerId: brands.ownerId }).from(brands).where(inArray(brands.id, brandIdList)) : []),
  ];
  const ownerIds = [...new Set(ownerRows.map((r) => r.ownerId).filter((id) => !claimed.has(id)))];
  for (const id of ownerIds) claimed.add(id);

  // 2) active staff
  const staffWhere = [eq(staff.status, 'active')];
  const orgFilter = or(
    agencyIdList.length ? inArray(staff.agencyId, agencyIdList) : undefined,
    brandIdList.length ? inArray(staff.brandId, brandIdList) : undefined,
  );
  const staffRows = orgFilter
    ? await db.select().from(staff).where(and(...staffWhere, orgFilter))
    : [];
  const staffUserIds: string[] = [];
  for (const s of staffRows) {
    if (s.userId && !claimed.has(s.userId)) {
      claimed.add(s.userId);
      staffUserIds.push(s.userId);
    }
  }

  // 3) active contractors connected to the agencies
  const contractorRows = agencyIdList.length
    ? await db
        .select({ contractorId: agencyContractorConnections.contractorId })
        .from(agencyContractorConnections)
        .where(and(inArray(agencyContractorConnections.agencyId, agencyIdList), eq(agencyContractorConnections.status, 'active')))
    : [];
  const contractorIds: string[] = [];
  for (const c of contractorRows) {
    if (c.contractorId && !claimed.has(c.contractorId)) {
      claimed.add(c.contractorId);
      contractorIds.push(c.contractorId);
    }
  }

  const allIds = [...ownerIds, ...staffUserIds, ...contractorIds];
  if (!allIds.length) return [] as Member[];

  const userRows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl })
    .from(users)
    .where(inArray(users.id, allIds));
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const make = (id: string, role: Member['role']): Member | null => {
    const u = userMap.get(id);
    if (!u) return null;
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return { id, name: name || u.email, email: u.email, profileUrl: u.profileUrl, role };
  };

  for (const id of ownerIds) { const m = make(id, 'owner'); if (m) byId.set(id, m); }
  for (const id of staffUserIds) { const m = make(id, 'staff'); if (m) byId.set(id, m); }
  for (const id of contractorIds) { const m = make(id, 'contractor'); if (m) byId.set(id, m); }

  // Preserve owners → staff → contractors ordering.
  return allIds.map((id) => byId.get(id)).filter((m): m is Member => !!m);
}

/**
 * Board-organization auth (move / reorder / recategorize / reassign): the
 * assignee and assigner always qualify; additionally a manager may organize a
 * teammate's board (the Flutter team pane lets owners/staff manage their team's
 * tasks). Falls back to a membership check only when the cheap checks miss.
 */
async function assertCanOrganize(db: Db, task: TaskRow, user: typeof users.$inferSelect): Promise<void> {
  if (task.assigneeId === user.id || task.assignedBy === user.id) return;
  if (task.assigneeId) {
    const members = await resolveTeamMembers(db, user);
    if (members.some((m) => m.id === task.assigneeId)) return;
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to modify this task' });
}

// ============================================================================
// Router
// ============================================================================

export const tasksRouter = router({
  /** The user's tasks for a board category (assignee OR visibleTo), sorted. */
  list: protectedProcedure
    .input(
      z.object({
        category: categoryEnum.default('inbox'),
        sortMode: sortModeEnum.default('default'),
        // Manager view: a teammate's tasks (inbox+todo), instead of the caller's.
        memberId: z.string().uuid().optional(),
        assignedByMe: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const targetId = input.memberId ?? ctx.user.id;
      const conds = [eq(tasks.category, input.category)];
      if (input.memberId) {
        // Manager view of a teammate's board — their tasks, minus any private to
        // others (visibleTo is a privacy filter, not a sharing-in mechanism).
        conds.push(eq(tasks.assigneeId, targetId));
        conds.push(teamVisibleToUser(ctx.user.id));
      } else {
        // My board is strictly my own tasks. `visibleTo` must NOT widen it: a task
        // I assigned to someone else lists me in visibleTo (so I keep seeing it in
        // the team pane), which previously leaked it into my personal inbox.
        conds.push(eq(tasks.assigneeId, ctx.user.id));
      }
      if (input.assignedByMe) conds.push(eq(tasks.assignedBy, ctx.user.id));
      const where = and(...conds);

      const rows = await ctx.db
        .select()
        .from(tasks)
        .where(where)
        .orderBy(orderForMode(input.sortMode))
        .limit(input.limit)
        .offset(input.offset);
      const [{ value: total }] = await ctx.db.select({ value: count() }).from(tasks).where(where);
      const items = await enrichAssigners(ctx.db, rows);
      return { items, total, hasMore: input.offset + rows.length < total };
    }),

  /**
   * The full entity behind a `connectionRequest` task, so the task detail dialog
   * can render the contractor's profile (an application) or the agency's info (an
   * agency→brand request / a contractor invite). Returns null for other task
   * types. Visibility: the task must be the caller's (assignee or shared).
   */
  connectionDetail: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const task = (await ctx.db.select().from(tasks).where(and(eq(tasks.id, input.taskId), visibleToUser(ctx.user.id))).limit(1))[0];
      if (!task || task.type !== 'connectionRequest' || !task.relatedEntityId) return null;
      const kind = (task.metadata as { type?: string } | null)?.type;

      // Contractor applied → show the contractor's profile.
      if (kind === 'application') {
        const row = (await ctx.db
          // Profile picture comes from the linked `users` row (contractors.id == users.id).
          .select({ contractor: contractors, profileUrl: users.profileUrl })
          .from(agencyContractorConnections)
          .innerJoin(contractors, eq(contractors.id, agencyContractorConnections.contractorId))
          .leftJoin(users, eq(users.id, contractors.id))
          .where(eq(agencyContractorConnections.id, task.relatedEntityId))
          .limit(1))[0];
        return row ? { kind: 'contractor' as const, contractor: { ...row.contractor, profileUrl: row.profileUrl } } : null;
      }

      // Agency invited this contractor → show the inviting agency.
      if (kind === 'invitation') {
        const row = (await ctx.db
          .select({ agency: agencies })
          .from(agencyContractorConnections)
          .innerJoin(agencies, eq(agencies.id, agencyContractorConnections.agencyId))
          .where(eq(agencyContractorConnections.id, task.relatedEntityId))
          .limit(1))[0];
        return row ? { kind: 'agency' as const, agency: row.agency } : null;
      }

      // Agency wants to connect to this brand → show the requesting agency.
      if (kind === 'brandAgency') {
        const row = (await ctx.db
          .select({ agency: agencies })
          .from(brandAgencyConnectionRequests)
          .innerJoin(agencies, eq(agencies.id, brandAgencyConnectionRequests.agencyId))
          .where(eq(brandAgencyConnectionRequests.id, task.relatedEntityId))
          .limit(1))[0];
        return row ? { kind: 'agency' as const, agency: row.agency } : null;
      }
      return null;
    }),

  /** Per-category counts for the current user (inbox/todo/completed/archived). */
  counts: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ category: tasks.category, value: count() })
      .from(tasks)
      // Assignee-only, matching the personal board (see `list`). Counting
      // visibleTo here would over-count tasks I merely assigned to others.
      .where(eq(tasks.assigneeId, ctx.user.id))
      .groupBy(tasks.category);
    const result: Record<string, number> = { inbox: 0, todo: 0, completed: 0, archived: 0 };
    for (const r of rows) result[r.category] = r.value;
    return result;
  }),

  /** Number of unviewed inbox tasks (created/updated after lastTasksViewedAt). */
  unviewedCount: protectedProcedure.query(async ({ ctx }) => {
    const since = ctx.user.lastTasksViewedAt;
    const base = and(eq(tasks.assigneeId, ctx.user.id), eq(tasks.category, 'inbox'));
    const where = since
      ? and(base, sql`coalesce(${tasks.updatedAt}, ${tasks.createdAt}) > ${since}`)
      : base;
    const [{ value }] = await ctx.db.select({ value: count() }).from(tasks).where(where);
    return value;
  }),

  /** Team pane: org members (owners → staff → contractors) with inbox/todo counts. */
  teamMembers: protectedProcedure.query(async ({ ctx }) => {
    const members = await resolveTeamMembers(ctx.db, ctx.user);
    if (!members.length) return [];
    const ids = members.map((m) => m.id);
    const countRows = await ctx.db
      .select({ assigneeId: tasks.assigneeId, category: tasks.category, value: count() })
      .from(tasks)
      .where(and(inArray(tasks.assigneeId, ids), inArray(tasks.category, ['inbox', 'todo'])))
      .groupBy(tasks.assigneeId, tasks.category);
    const counts = new Map<string, { inbox: number; todo: number }>();
    for (const m of members) counts.set(m.id, { inbox: 0, todo: 0 });
    for (const r of countRows) {
      if (!r.assigneeId) continue;
      const c = counts.get(r.assigneeId);
      if (c && (r.category === 'inbox' || r.category === 'todo')) c[r.category] = r.value;
    }
    return members.map((m) => ({ ...m, ...counts.get(m.id)! }));
  }),

  /** Create a manual task (self via personal +, or a teammate via team pane). */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, 'Title is required').max(50, 'Title must be 50 characters or fewer'),
        description: z.string().optional(),
        assigneeId: z.string().uuid().optional(),
        organizationId: z.string().uuid().optional(),
        organizationName: z.string().optional(),
        disableMailing: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assigneeId = input.assigneeId ?? ctx.user.id;
      const [task] = await ctx.db
        .insert(tasks)
        .values({
          type: 'manual',
          category: 'inbox',
          title: input.title,
          description: input.description,
          assigneeId,
          assignedBy: ctx.user.id,
          organizationId: input.organizationId,
          organizationName: input.organizationName,
          disableMailing: input.disableMailing,
        })
        .returning();

      if (task) {
        const neighbors = await ctx.db
          .select({ id: tasks.id, sortOrder: tasks.sortOrder })
          .from(tasks)
          .where(and(eq(tasks.assigneeId, assigneeId), eq(tasks.category, 'inbox')))
          .orderBy(asc(tasks.sortOrder))
          .limit(1);
        const edgeOrder = neighbors[0]?.sortOrder ?? 'a0';
        const targetOrder = generateKeyBetween(null, edgeOrder);
        await ctx.db.update(tasks).set({ sortOrder: targetOrder }).where(eq(tasks.id, task.id));
      }
      // Notify the assignee (skip self-assigned to avoid emailing yourself).
      if (task && assigneeId !== ctx.user.id && !input.disableMailing) {
        await maybeSendTaskEmail(task, ctx.db);
      }
      await pingTasksChanged(assigneeId);
      return task;
    }),

  /** Edit a manual task's title/description (assigner or assignee). */
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), title: z.string().min(1, 'Title is required').max(50, 'Title must be 50 characters or fewer').optional(), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      assertCanManage(task, ctx.user.id);
      const [updated] = await ctx.db
        .update(tasks)
        .set({ title: input.title ?? task.title, description: input.description ?? task.description, updatedAt: new Date() })
        .where(eq(tasks.id, input.id))
        .returning();
      await pingTasksChanged(task.assigneeId);
      return updated;
    }),

  /** Move a task between board columns (optionally pin to top/bottom). */
  setCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid(), category: categoryEnum, position: z.enum(['top', 'bottom']).optional() }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      await assertCanOrganize(ctx.db, task, ctx.user);

      let targetOrder: string | undefined;
      if (input.position) {
        const neighbors = await ctx.db
          .select({ id: tasks.id, sortOrder: tasks.sortOrder })
          .from(tasks)
          .where(and(eq(tasks.assigneeId, task.assigneeId!), eq(tasks.category, input.category)))
          .orderBy(input.position === 'top' ? asc(tasks.sortOrder) : desc(tasks.sortOrder))
          .limit(1);
        const edgeOrder = neighbors[0]?.sortOrder ?? 'a0';
        targetOrder = input.position === 'top' ? generateKeyBetween(null, edgeOrder) : generateKeyBetween(edgeOrder, null);
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({ category: input.category, ...(targetOrder !== undefined ? { sortOrder: targetOrder } : {}), updatedAt: new Date() })
        .where(eq(tasks.id, input.id))
        .returning();
      await pingTasksChanged(task.assigneeId);
      return updated;
    }),

  /** Set a single task's sortOrder (move-to-top / move-to-end). */
  setSortOrder: protectedProcedure
    .input(z.object({ id: z.string().uuid(), position: z.enum(['top', 'bottom']) }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      await assertCanOrganize(ctx.db, task, ctx.user);

      const neighbors = await ctx.db
        .select({ id: tasks.id, sortOrder: tasks.sortOrder })
        .from(tasks)
        .where(and(eq(tasks.assigneeId, task.assigneeId!), eq(tasks.category, task.category)))
        .orderBy(input.position === 'top' ? asc(tasks.sortOrder) : desc(tasks.sortOrder))
        .limit(1);
      const edgeOrder = neighbors[0]?.sortOrder ?? 'a0';
      const targetOrder = input.position === 'top' ? generateKeyBetween(null, edgeOrder) : generateKeyBetween(edgeOrder, null);

      const [updated] = await ctx.db
        .update(tasks)
        .set({ sortOrder: targetOrder, updatedAt: new Date() })
        .where(eq(tasks.id, input.id))
        .returning();
      await pingTasksChanged(task.assigneeId);
      return updated;
    }),


  /**
   * Drag-drop move: relocates a task to a category/assignee and slots it into the
   * destination list by FRACTIONAL INSERTION between its drop neighbors.
   *
   * Why not rewrite the whole list to 0..N-1 (the old Flutter approach)? The
   * client only sends the loaded page in `orderedIds`. Assigning small indices to
   * a partial window collides catastrophically with the negative-epoch sortOrder
   * every other task carries (~-1.7e12), so the reordered page sinks below all
   * unloaded rows. Instead we read the two neighbors' sortOrder and give the
   * dragged task a value strictly between them — touching one row, pagination-safe.
   *
   * `orderedIds` is the destination window with the dragged id already inserted at
   * its target slot; the neighbors are simply its adjacent entries.
   */
  move: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        newCategory: categoryEnum,
        newAssigneeId: z.string().uuid(),
        // The destination window's id order, with the dragged id at its new slot.
        orderedIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      await assertCanOrganize(ctx.db, task, ctx.user);

      await ctx.db.transaction(async (tx) => {
        // Relocate the dragged task to its new column/assignee first so it lives in
        // the destination column (a renormalize, if needed, then sees it there).
        await tx
          .update(tasks)
          .set({ category: input.newCategory, assigneeId: input.newAssigneeId, updatedAt: new Date() })
          .where(eq(tasks.id, input.id));

        // Drop neighbors = the entries flanking the dragged id in the window.
        const idx = input.orderedIds.indexOf(input.id);
        const prevId = idx > 0 ? input.orderedIds[idx - 1] : null;
        const nextId = idx >= 0 && idx < input.orderedIds.length - 1 ? input.orderedIds[idx + 1] : null;

        const neighborIds = [prevId, nextId].filter((v): v is string => !!v);
        const neighbors = neighborIds.length
          ? await tx.select({ id: tasks.id, sortOrder: tasks.sortOrder }).from(tasks).where(inArray(tasks.id, neighborIds))
          : [];
        const sortOf = new Map(neighbors.map((r) => [r.id, r.sortOrder ?? 'a0']));
        const prev = prevId && sortOf.has(prevId) ? sortOf.get(prevId)! : null;
        const next = nextId && sortOf.has(nextId) ? sortOf.get(nextId)! : null;

        // Pick a sortOrder strictly between the neighbors.
        const target = generateKeyBetween(prev, next);
        await tx.update(tasks).set({ sortOrder: target }).where(eq(tasks.id, input.id));
      });

      // Reassignment moves the card off the old board and onto the new one.
      await pingTasksChanged(task.assigneeId, input.newAssigneeId);
      return { ok: true };
    }),

  /** Reassign a task to another user and reset it to inbox (reassignTask). */
  reassign: protectedProcedure
    .input(z.object({ id: z.string().uuid(), newAssigneeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      await assertCanOrganize(ctx.db, task, ctx.user);
      const [updated] = await ctx.db
        .update(tasks)
        .set({ assigneeId: input.newAssigneeId, category: 'inbox', updatedAt: new Date() })
        .where(eq(tasks.id, input.id))
        .returning();
      if (updated && !updated.disableMailing) await maybeSendTaskEmail(updated, ctx.db);
      await pingTasksChanged(task.assigneeId, input.newAssigneeId);
      return updated;
    }),

  /** Permanently delete a task (assignee or assigner). */
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const task = await loadTaskOr404(ctx.db, input.id);
    assertCanManage(task, ctx.user.id);
    await ctx.db.delete(tasks).where(eq(tasks.id, input.id));
    await pingTasksChanged(task.assigneeId);
    return { id: input.id };
  }),

  /** Attachments: persisted immediately (assignee or assigner). */
  setAttachments: protectedProcedure
    .input(z.object({ id: z.string().uuid(), attachments: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      assertCanManage(task, ctx.user.id);
      const [updated] = await ctx.db
        .update(tasks)
        .set({ attachments: input.attachments, updatedAt: new Date() })
        .where(eq(tasks.id, input.id))
        .returning();
      await pingTasksChanged(task.assigneeId);
      return updated;
    }),

  /**
   * Toggle a task's team visibility (mirrors TaskTileVisibilityIcon):
   * - visibleTo = null/[]  → visible to the whole team (default)
   * - visibleTo = [ids]    → private to those users (assignee + assigner)
   */
  setVisibility: protectedProcedure
    .input(z.object({ id: z.string().uuid(), visibleTo: z.array(z.string().uuid()).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      assertCanManage(task, ctx.user.id);
      const [updated] = await ctx.db
        .update(tasks)
        .set({ visibleTo: input.visibleTo && input.visibleTo.length ? input.visibleTo : null, updatedAt: new Date() })
        .where(eq(tasks.id, input.id))
        .returning();
      await pingTasksChanged(task.assigneeId);
      return updated;
    }),

  /** Stamp lastTasksViewedAt — clears the "new" badge. */
  markTasksViewed: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.update(users).set({ lastTasksViewedAt: new Date() }).where(eq(users.id, ctx.user.id));
    return { ok: true };
  }),

  /**
   * Perform the domain side-effect for a system task (accept invite, accept
   * connection, verify agency, make component public, accept discipline,
   * approve resource). Mirrors task_detail_action_handlers.dart. Navigation
   * targets for proposal/project tasks are returned to the client which then
   * routes + switches role/context (handled client-side, like the Flutter app).
   */
  performAction: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await loadTaskOr404(ctx.db, input.id);
      if (task.assigneeId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your task' });
      }
      const entityId = task.relatedEntityId;

      switch (task.type) {
        case 'staffInvitation': {
          if (!entityId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' });
          const [member] = await ctx.db
            .update(staff)
            .set({ userId: ctx.user.id, email: ctx.user.email, status: 'active', acceptedAt: new Date() })
            .where(eq(staff.id, entityId))
            .returning();
          await completeSystemTask('staffInvitation', entityId, ctx.user.id, ctx.db);
          if (member) {
            // Switch the user into the accepted staff context: active role + selected
            // org, so the staff workspace is live immediately after accepting.
            await ctx.db
              .update(users)
              .set({
                role: member.agencyId ? 'agencyStaff' : 'brandStaff',
                selectedAgencyId: member.agencyId ?? null,
                selectedBrandId: member.brandId ?? null,
              })
              .where(eq(users.id, ctx.user.id));
            // Fan out the chat threads for any granted chat permissions (parity with staff.accept).
            await handleStaffPermissionGranted(
              ctx.user.id,
              { agencyId: member.agencyId, brandId: member.brandId },
              member.permissions,
              ctx.db,
            );
          }
          // Land on the staff workspace — App resolves it from the refreshed role.
          return { kind: 'navigate' as const, to: '/' };
        }
        case 'connectionRequest': {
          if (!entityId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
          const subtype = (task.metadata as { type?: string } | null)?.type;
          if (subtype === 'brandAgency') {
            // Brand owner accepts an agency's brand-connection request.
            const req = (await ctx.db.select().from(brandAgencyConnectionRequests).where(eq(brandAgencyConnectionRequests.id, entityId)).limit(1))[0];
            if (req) {
              // Creates the connection row + brand↔agency chat threads + provisions
              // the agency's default Info Hub sections (idempotent), via the shared chokepoint.
              await connectBrandToAgency(req.brandId, req.agencyId, ctx.db);
              await ctx.db.delete(brandAgencyConnectionRequests).where(eq(brandAgencyConnectionRequests.id, entityId));
            }
          } else {
            // invitation / application → contractor connection becomes active.
            // An invited user who hasn't built a contractor profile yet can't be a
            // contractor — send them to create one first. The connection + task are
            // left OPEN here and finalized by contractor.create (connectAgencyId),
            // which re-activates this same row and completes the task.
            if (subtype === 'invitation') {
              const isContractor = !!(
                await ctx.db.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, ctx.user.id)).limit(1)
              )[0];
              if (!isContractor) {
                const conn = (
                  await ctx.db
                    .select({ agencyId: agencyContractorConnections.agencyId })
                    .from(agencyContractorConnections)
                    .where(eq(agencyContractorConnections.id, entityId))
                    .limit(1)
                )[0];
                if (!conn) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
                return { kind: 'navigate' as const, to: `/create-contractor?agencyId=${conn.agencyId}` };
              }
            }
            const [conn] = await ctx.db
              .update(agencyContractorConnections)
              .set({ status: 'active', respondedAt: new Date() })
              .where(eq(agencyContractorConnections.id, entityId))
              .returning();
            if (conn?.contractorId) await createContractorThread(conn.agencyId, conn.contractorId, ctx.db);
          }
          await completeTasksByEntity(entityId, ctx.db);
          return { kind: 'done' as const, message: 'Connection accepted' };
        }
        case 'agencyApproval': {
          if (!entityId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agency not found' });
          // "Accept Agency": verify the agency directly (mirrors acceptAgency()).
          // The detail dialog also offers a "View Agency" button that navigates
          // to /super-admin/agencies client-side without calling this.
          await ctx.db
            .update(agencies)
            .set({ emailVerified: true, rejectionReason: null, updatedAt: new Date() })
            .where(eq(agencies.id, entityId));
          await onAgencyVerified(entityId, ctx.db); // completes every admin's approval task
          return { kind: 'done' as const, message: 'Agency verified' };
        }
        case 'componentApproval': {
          if (!entityId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
          await ctx.db.update(spotComponents).set({ isPublic: true, updatedAt: new Date() }).where(eq(spotComponents.id, entityId));
          await completeTasksByEntity(entityId, ctx.db);
          return { kind: 'done' as const, message: 'Component is now public' };
        }
        case 'resourceApproval': {
          if (!entityId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
          await ctx.db.update(resources).set({ acceptedAt: new Date() }).where(eq(resources.id, entityId));
          await completeSystemTask('resourceApproval', entityId, ctx.user.id, ctx.db);
          return { kind: 'done' as const, message: 'Resource approved' };
        }
        case 'disciplineRequest': {
          if (!entityId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
          const req = (await ctx.db.select().from(disciplineRequests).where(eq(disciplineRequests.id, entityId)).limit(1))[0];
          if (req) {
            const settings = (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
            const list = new Set<string>(settings?.disciplines ?? []);
            if (!list.has(req.discipline)) {
              list.add(req.discipline);
              await ctx.db
                .insert(globalSettings)
                .values({ id: 1, disciplines: [...list], updatedBy: ctx.user.id })
                .onConflictDoUpdate({ target: globalSettings.id, set: { disciplines: [...list], updatedBy: ctx.user.id, updatedAt: new Date() } });
            }
            await ctx.db.delete(disciplineRequests).where(eq(disciplineRequests.id, entityId));
          }
          await completeTasksByEntity(entityId, ctx.db);
          return { kind: 'done' as const, message: 'Discipline accepted' };
        }
        case 'clientApprovalRequest': {
          return { kind: 'navigate' as const, to: '/dashboard' };
        }
        case 'proposalPending':
        case 'proposalAccepted':
        case 'proposalChangeRequested': {
          // Client navigates to the proposal detail, switching role/context.
          return {
            kind: 'navigateProposal' as const,
            proposalId: task.proposalId ?? entityId ?? '',
            brandId: task.organizationId ?? null,
            isBrandView: task.type === 'proposalPending',
          };
        }
        case 'agencyWorkflowAction': {
          // Client switches agency context + role then opens the project board.
          return {
            kind: 'navigateProject' as const,
            projectId: task.projectId ?? entityId ?? null,
            agencyId: task.organizationId ?? null,
          };
        }
        default:
          return { kind: 'none' as const };
      }
    }),
});
