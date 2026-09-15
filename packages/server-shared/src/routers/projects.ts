import { z } from 'zod';
import { pingProjectsChanged } from '../lib/realtime.js';
import { and, eq, isNull, isNotNull, inArray, count, desc, asc, or, ilike, exists, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { TRPCError } from '@trpc/server';
import { omitActionTokens } from '../lib/redact.js';
import { router, protectedProcedure } from '../trpc/trpc.js';
import {
  projects,
  projectCycles,
  projectDeliverables,
  projectRevisions,
  projectNotes,
  projectTags,
  projectsToTags,
  agencies,
  brands,
  staff,
  users,
  payouts,
  payoutBreakdowns,
  invoices,
  invoiceItems,
  purchases,
  purchaseItems,
  agencyContractorConnections,
  services,
} from '../db/schema.js';
import { assertAgencyAccess, assertBrandAccess, hasPermission } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import { formatPrice, chargeCents, payoutCents, roundChargeUp, roundPayoutDown } from '../lib/num.js';
import { enqueueEmail } from '../lib/notify.js';
import { env, isDev } from '../lib/env.js';
import { payoutFriday, insertPayout } from '../modules/billing/fulfillment.js';
import { partyColumns } from '../modules/billing/invoice-parties.js';
import { stripe } from '../modules/stripe/client.js';
import { withEnvTag } from '../modules/stripe/env-tag.js';
import { db as defaultDb } from '../db/index.js';
import { generateKeyBetween } from 'fractional-indexing';

import { connectBrandToAgency } from '../modules/connections/connect.js';
import { recordLockerFile, recordLockerFiles, answerUrls } from '../modules/locker/record.js';
import type { Context } from '../trpc/context.js';
import { onProjectStatusChanged } from './tasks.js';
import { hasDeliverableCycle, isBillingCycleWeekly, SERVICE_TYPES, type ServiceType } from '../lib/service-type.js';
import { projectNextCycleAt } from '../modules/projects/fulfillment-core.js';
import { onRecurringProjectCompleted, scheduleProjectCycle, scheduleProjectCancellation, unscheduleProjectCancellation } from '../modules/projects/recurring-schedule.js';
import { cancelProjectSubscription } from '../modules/billing/subscription.js';
import { dispatchProjectPayoutsNow } from '../modules/billing/dispatch.js';
import { scheduledCancellationDate, refundableCyclePoolCount, cycleStart, weeklyPaymentsBefore, currentCycleNumber } from '../modules/projects/cycle-math.js';
import { IS_RECURRING_PROJECTS_REFUNDABLE } from '../lib/feature-flags.js';
import type { DeliverableFrequency } from '../lib/deliverable-frequency.js';

/**
 * Billing anchor for cancellation maths (spec §3.3): the purchase `createdAt`, or
 * the phase start (`createdAt + startDelayDays`) for a delayed phase — its upfront
 * is taken at checkout but recurring billing begins when the phase activates.
 */
function cancellationAnchor(createdAt: Date | null, startDelayDays: number): Date {
  const created = createdAt ?? new Date();
  return startDelayDays > 0 ? new Date(created.getTime() + startDelayDays * 86_400_000) : created;
}

const STATUSES =['clientBrief', 'upcoming', 'brief', 'allocate', 'production', 'internalApproval', 'revision', 'clientApproval', 'completed'] as const;
type Status = (typeof STATUSES)[number];
const statusEnum = z.enum(STATUSES);

type ProjectRow = typeof projects.$inferSelect;
type AgencyRow = typeof agencies.$inferSelect;
type StaffRow = typeof staff.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * Permission state-machine (mirror of lib/.../kanban_permission_service.dart)
 * ────────────────────────────────────────────────────────────────────────── */

interface TransitionContext {
  project: ProjectRow;
  userId: string;
  isSuperAdmin: boolean;
  /** Agency owner / staff acting in the project's fulfilling agency. */
  isAgencyOwner: boolean;
  agencyStaff: StaffRow | null;
  agency: AgencyRow | null;
  /** Brand-side identity. */
  isBrandOwner: boolean;
  userBrandId: string | null;
  /** The agency the user is currently acting as (null => acting as a brand). */
  activeAgencyId: string | null;
}

function staffHas(s: StaffRow | null, perm: string): boolean {
  return !!s && hasPermission(s.permissions, perm);
}

function canAddBrief(c: TransitionContext): boolean {
  if (c.isAgencyOwner) return true;
  if (c.agency && c.agency.briefingDesigneeId === c.userId) return true;
  return staffHas(c.agencyStaff, 'addBrief');
}
function canAllocate(c: TransitionContext): boolean {
  if (c.isAgencyOwner) return true;
  if (c.agency && c.agency.allocationDesigneeId === c.userId) return true;
  return staffHas(c.agencyStaff, 'allocatePeople');
}
function canApproveDeliverable(c: TransitionContext): boolean {
  if (c.isAgencyOwner) return true;
  if (c.agency && c.agency.approvalDesigneeId === c.userId) return true;
  return staffHas(c.agencyStaff, 'approveDeliverable');
}
function isAssignedPerson(c: TransitionContext): boolean {
  const p = c.project;
  if (!p.productionAssigneeId) return false;
  // production_assignee_id is always a user id — the staff member's user (or the
  // agency owner's, who is allocatable without a staff row) for staff, and the
  // contractor's user for contractor. So the assignee is whoever's user id matches.
  return c.userId === p.productionAssigneeId;
}
function canClientApprove(c: TransitionContext): boolean {
  return !!c.userBrandId && c.userBrandId === c.project.brandId;
}

/**
 * Where a clientBrief project lands once its brief is completed — decided by the
 * phase START TIME, never by the column the user dropped on. A delayed-phase
 * project (`delayed-start` tag) whose phase start (`nextCycleAt`) is still in the
 * future parks in `upcoming`; in every other case it advances straight to `brief`.
 */
function briefLandingStatus(project: ProjectRow, now: Date): Status {
  const isDelayedStart = (project.tags ?? []).includes('delayed-start');
  const notYetDue =
    isDelayedStart && !!project.nextCycleAt && project.nextCycleAt.getTime() > now.getTime();
  return notYetDue ? 'upcoming' : 'brief';
}

/** Allowed next statuses for a project, mirroring getAllowedTransitions. */
function getAllowedTransitions(c: TransitionContext): Status[] {
  const allowed: Status[] = [];
  const cur = c.project.status as Status;

  // CASE 1: Brand context (no active agency).
  if (c.activeAgencyId == null) {
    const isBrandUser = c.isBrandOwner || (!!c.userBrandId && c.userBrandId === c.project.brandId);
    if (!isBrandUser) return [];
    switch (cur) {
      case 'clientBrief':
        allowed.push('brief', 'upcoming');
        break;
      case 'clientApproval':
        allowed.push('completed', 'internalApproval', 'revision');
        break;
    }
    return allowed;
  }

  // CASE 2: Agency context — active agency must be the fulfilling agency.
  if (c.project.agencyId !== c.activeAgencyId && !c.isSuperAdmin) return [];

  if (c.isAgencyOwner) {
    switch (cur) {
      case 'upcoming':
        allowed.push('brief');
        break;
      case 'clientBrief':
        allowed.push('upcoming', 'brief');
        break;
      case 'brief':
        allowed.push('allocate');
        break;
      case 'allocate':
        allowed.push('production');
        break;
      case 'production':
        allowed.push('internalApproval');
        break;
      case 'internalApproval':
        allowed.push('clientApproval', 'revision', 'completed');
        break;
      case 'revision':
        allowed.push('internalApproval', 'production', 'clientApproval', 'completed');
        break;
      case 'clientApproval':
        allowed.push('completed', 'internalApproval', 'revision');
        break;
    }
    return allowed;
  }

  switch (cur) {
    case 'upcoming':
      if (canAddBrief(c)) allowed.push('clientBrief', 'brief');
      break;
    case 'clientBrief':
      if (canAddBrief(c)) allowed.push('brief', 'upcoming');
      break;
    case 'brief':
      if (canAddBrief(c)) allowed.push('allocate');
      break;
    case 'allocate':
      if (canAllocate(c)) allowed.push('production');
      break;
    case 'production': {
      // The assigned person submits their work; "Manage Allocations" (allocatePeople /
      // allocation designee) can also push it into internal approval.
      if (isAssignedPerson(c) || canAllocate(c)) allowed.push('internalApproval');
      break;
    }
    case 'internalApproval': {
      // "Approval Manager" (approveDeliverable / approval designee) reviews deliverables:
      // send to client approval, or bounce back to revision.
      if (canApproveDeliverable(c)) allowed.push('clientApproval', 'revision');
      break;
    }
    case 'revision': {
      const canMove = canAllocate(c);
      const canApprove = canApproveDeliverable(c);
      if (isAssignedPerson(c) || canMove) allowed.push('internalApproval');
      if (isAssignedPerson(c)) allowed.push('production');
      if (canMove && canApprove) allowed.push('clientApproval');
      if (canApprove) allowed.push('completed');
      break;
    }
    case 'clientApproval': {
      // "Approval Manager" can complete on the client's behalf (no separate
      // client-approval permission — folded into approveDeliverable).
      const complete = canApproveDeliverable(c);
      if (canClientApprove(c) || c.isBrandOwner || complete) {
        allowed.push('completed');
        if (complete) allowed.push('internalApproval');
      }
      if (canClientApprove(c) || c.isBrandOwner) allowed.push('internalApproval', 'revision');
      break;
    }
  }
  return allowed;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */

async function loadProject(ctx: Context, id: string): Promise<ProjectRow> {
  const project = (await ctx.db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
  if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
  return project;
}

/** Build the transition context: who is this user relative to this project? */
async function buildTransitionContext(ctx: Context, project: ProjectRow): Promise<TransitionContext> {
  const user = ctx.user!;
  const userId = user.id;
  const isSuperAdmin = user.isSuperAdmin;

  let isAgencyOwner = false;
  let agency: AgencyRow | null = null;
  let agencyStaff: StaffRow | null = null;
  if (project.agencyId) {
    agency = (await ctx.db.select().from(agencies).where(eq(agencies.id, project.agencyId)).limit(1))[0] ?? null;
    if (agency && (agency.ownerId === userId || isSuperAdmin)) isAgencyOwner = true;
    agencyStaff = (
      await ctx.db
        .select()
        .from(staff)
        .where(and(eq(staff.agencyId, project.agencyId), eq(staff.userId, userId), eq(staff.status, 'active')))
        .limit(1)
    )[0] ?? null;
  }

  // Brand identity: owner of the project's brand, or active brand staff.
  let isBrandOwner = false;
  let userBrandId: string | null = null;
  if (project.brandId) {
    // Brand ownership, mirroring the agency-owner check above (brands.ownerId).
    // Owners typically have no `staff` row, so without this a brand owner is
    // misclassified as a contractor viewer and shown the agency-side workspace.
    const brand = (await ctx.db.select({ ownerId: brands.ownerId }).from(brands).where(eq(brands.id, project.brandId)).limit(1))[0] ?? null;
    if (brand && brand.ownerId === userId) {
      isBrandOwner = true;
      userBrandId = project.brandId;
    }
    const brandStaff = (
      await ctx.db
        .select()
        .from(staff)
        .where(and(eq(staff.brandId, project.brandId), eq(staff.userId, userId), eq(staff.status, 'active')))
        .limit(1)
    )[0] ?? null;
    if (brandStaff) userBrandId = project.brandId;
    if (user.selectedBrandId === project.brandId) userBrandId = project.brandId;
  }

  // The viewer's active identity comes from the context selector. When they have
  // explicitly selected this project's brand, treat them as a brand viewer even
  // if they also belong to the fulfilling agency (e.g. an agency owner who also
  // owns/staffs the brand, or a super-admin) — otherwise raw agency membership
  // shadows the brand context and leaks the agency-side workspace, deliverables,
  // and revisions onto the brand view. Mirrors buildBoardContextFactory, which
  // resolves identity from the active workspace rather than membership.
  const actingAsBrand = !!project.brandId && user.selectedBrandId === project.brandId;
  const activeAgencyId = !actingAsBrand && (isAgencyOwner || agencyStaff) ? project.agencyId : null;

  return {
    project,
    userId,
    isSuperAdmin,
    isAgencyOwner,
    agencyStaff,
    agency,
    isBrandOwner,
    userBrandId,
    activeAgencyId,
  };
}

/**
 * Board-scoped transition-context factory. A board is filtered to a single
 * agencyId OR brandId, so the agency / staff / brand-identity lookups are
 * identical for every project — we run them once here and return a cheap
 * per-project context builder, avoiding an N-query loop over the board rows.
 * Mirrors the field computation in buildTransitionContext.
 */
async function buildBoardContextFactory(
  ctx: Context,
  input: { agencyId?: string; brandId?: string },
): Promise<(project: ProjectRow) => TransitionContext> {
  const user = ctx.user!;
  const userId = user.id;
  const isSuperAdmin = user.isSuperAdmin;

  // Agency-side identity (only when viewing an agency board).
  let agency: AgencyRow | null = null;
  let agencyStaff: StaffRow | null = null;
  let isAgencyOwner = false;
  if (input.agencyId) {
    agency = (await ctx.db.select().from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0] ?? null;
    if (agency && (agency.ownerId === userId || isSuperAdmin)) isAgencyOwner = true;
    agencyStaff = (
      await ctx.db
        .select()
        .from(staff)
        .where(and(eq(staff.agencyId, input.agencyId), eq(staff.userId, userId), eq(staff.status, 'active')))
        .limit(1)
    )[0] ?? null;
  }

  // Brand-side identity (only when viewing a brand board).
  let isBrandOwner = false;
  let userBrandId: string | null = null;
  if (input.brandId) {
    const brand = (await ctx.db.select({ ownerId: brands.ownerId }).from(brands).where(eq(brands.id, input.brandId)).limit(1))[0] ?? null;
    if (brand && brand.ownerId === userId) {
      isBrandOwner = true;
      userBrandId = input.brandId;
    }
    const brandStaff = (
      await ctx.db
        .select()
        .from(staff)
        .where(and(eq(staff.brandId, input.brandId), eq(staff.userId, userId), eq(staff.status, 'active')))
        .limit(1)
    )[0] ?? null;
    if (brandStaff) userBrandId = input.brandId;
    if (user.selectedBrandId === input.brandId) userBrandId = input.brandId;
  }

  // Acting-as-agency only when the viewer is owner/active-staff of the board's agency.
  const activeAgencyId = input.agencyId && (isAgencyOwner || agencyStaff) ? input.agencyId : null;

  return (project: ProjectRow): TransitionContext => ({
    project,
    userId,
    isSuperAdmin,
    isAgencyOwner,
    agencyStaff,
    agency,
    isBrandOwner,
    userBrandId,
    activeAgencyId,
  });
}

function authorName(user: NonNullable<Context['user']>): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

/** Validate that a contractor is actively connected to the agency. Throws otherwise. */
async function assertContractorConnected(ctx: Context, agencyId: string, contractorId: string) {
  const conn = (
    await ctx.db
      .select()
      .from(agencyContractorConnections)
      .where(
        and(
          eq(agencyContractorConnections.agencyId, agencyId),
          eq(agencyContractorConnections.contractorId, contractorId),
          eq(agencyContractorConnections.status, 'active'),
        ),
      )
      .limit(1)
  )[0];
  if (!conn) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot assign project: Contractor is not connected to this agency.' });
  }
}

/** True if `userId` is the agency's owner or one of its active staff members. */
async function isAgencyMemberUser(ctx: Context, agencyId: string, userId: string): Promise<boolean> {
  const owner = (await ctx.db.select({ ownerId: agencies.ownerId }).from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0];
  if (owner?.ownerId === userId) return true;
  const member = (
    await ctx.db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.agencyId, agencyId), eq(staff.userId, userId), eq(staff.status, 'active')))
      .limit(1)
  )[0];
  return !!member;
}

function getProjectCyclePrice(project: {
  isInternal: boolean | null;
  contractorBudget: string | null;
  amount: unknown;
  cycleCount: number | null;
}): number {
  if (project.isInternal && project.contractorBudget != null) {
    return Number(project.contractorBudget) || 0;
  }
  const a = (project.amount ?? {}) as any;
  const recurring = a.recurring ?? {};
  const oneOff = a.oneOff ?? {};
  const cycleCount = project.cycleCount ?? 0;
  if (cycleCount <= 1) {
    return Number(a.oneOffTotal ?? 0) + Number(recurring.upfront ?? 0);
  }
  if (cycleCount <= Number(oneOff.numberOfWeeks ?? 0)) {
    return Number(oneOff.weeklyAfter ?? 0) + Number(recurring.weeklyAfter ?? 0);
  }
  return Number(recurring.weeklyAfter ?? 0);
}

export const projectsRouter = router({
  /** Kanban board: projects for an agency (or brand) grouped by status. */
  board: protectedProcedure
    .input(z.object({
      agencyId: z.string().uuid().optional(),
      brandId: z.string().uuid().optional(),
      search: z.string().trim().optional(),
      // Server-side filters (mirror the Flutter board's filter bar). Option lists
      // come from the `boardFacets` query; the selected value is applied here.
      filterBrandId: z.string().uuid().optional(),   // agency view: a specific client brand
      filterAgencyId: z.string().uuid().optional(),  // brand view: a specific fulfilling agency
      serviceName: z.union([z.string(), z.array(z.string())]).optional(),
      serviceType: z.union([z.enum(SERVICE_TYPES), z.array(z.enum(SERVICE_TYPES))]).optional(),
      dateFilter: z.object({
        operator: z.enum(['inLast', 'equals', 'between', 'greaterThan', 'lessThan']),
        value: z.unknown(),
        unit: z.enum(['days', 'hours', 'weeks', 'months']).optional(),
      }).optional(),
      filterTags: z.array(z.string().uuid()).optional(),
      amountFilter: z.object({
        operator: z.enum(['equals', 'between', 'greaterThan', 'lessThan']),
        value: z.unknown(),
      }).optional(),
      // When true, also include projects where this agency is the sales agency
      // (proposalSentByAgencyId) but another agency fulfills (agencyId ≠ input).
      // Mirrors the Flutter `salesAgencyProjectsProvider` + toggle chips.
      includeSalesAgency: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [isNull(projects.deletedAt)];
      if (input.agencyId) {
        await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
        // Include projects the agency owns OR projects it sold (sales agency).
        // Sales-agency projects have allowedTransitions = [] (read-only) because
        // the viewer's staff row is in the sales agency, not the fulfilling one.
        if (input.includeSalesAgency) {
          filters.push(or(
            eq(projects.agencyId, input.agencyId),
            eq(projects.proposalSentByAgencyId, input.agencyId),
          )!);
        } else {
          filters.push(eq(projects.agencyId, input.agencyId));
        }
      } else if (input.brandId) {
        await assertBrandAccess(ctx, input.brandId, 'brandProjects');
        filters.push(eq(projects.brandId, input.brandId));
        filters.push(eq(projects.viewableToBrand, true));
      } else throw new TRPCError({ code: 'BAD_REQUEST' });

      // Server-side fuzzy search across every text field a user can read off a
      // card. Always case-insensitive: ILIKE handles substring / partial matches,
      // and pg_trgm's word-similarity operator (`<%`, backed by the *_trgm_idx GIN
      // indexes) layers on typo tolerance. The term is split into whitespace tokens
      // and EVERY token must match SOME field (AND across tokens, OR across fields),
      // so "acme logo" finds a "Logo Design" card for brand "Acme" irrespective of
      // word order. This can only broaden matches versus a single ILIKE, never drop
      // a result the old exact search would have found.
      const search = input.search?.trim();
      if (search) {
        // A field matches a token if it contains it (case-insensitive substring)
        // OR a word in it is trigram-similar to the token (fuzzy / typo tolerant).
        const matches = (col: AnyPgColumn, token: string) =>
          or(ilike(col, `%${token}%`), sql`${token}::text <% ${col}`)!;
        // Cap the token count so a pathological query can't fan out unbounded ORs.
        const tokens = search.split(/\s+/).filter(Boolean).slice(0, 6);
        for (const token of tokens) {
          filters.push(or(
            matches(projects.title, token),
            matches(projects.taskTitle, token),
            matches(projects.serviceName, token),
            matches(projects.packageName, token),
            // Free-text brand name — carried on internal/complimentary projects
            // that have no linked brand row (was previously not searched at all).
            matches(projects.brandName, token),
            matches(projects.description, token),
            // Assignee type label ('staff' / 'contractor') — substring only.
            // assignee_type is a Postgres enum, so it must be cast to text before
            // ILIKE (Postgres has no `enum ILIKE text` operator).
            sql`${projects.assigneeType}::text ilike ${`%${token}%`}`,
            // Linked brand's registered business name.
            exists(ctx.db.select().from(brands).where(and(eq(brands.id, projects.brandId), matches(brands.businessName, token)))),
            // Fulfilling agency's business name.
            exists(ctx.db.select().from(agencies).where(and(eq(agencies.id, projects.agencyId), matches(agencies.businessName, token)))),
            // Assigned tags.
            exists(
              ctx.db.select().from(projectsToTags)
                .innerJoin(projectTags, eq(projectTags.id, projectsToTags.tagId))
                .where(and(eq(projectsToTags.projectId, projects.id), matches(projectTags.name, token)))
            ),
            // Assignee (staff or contractor) first / last name.
            exists(
              ctx.db.select().from(users).where(and(eq(users.id, projects.productionAssigneeId), or(matches(users.firstName, token), matches(users.lastName, token))))
            ),
          )!);
        }
      }

      // Discrete filters. Each is independent; the client only sends the ones that
      // apply to its view (brand filter for agencies, agency filter for brands).
      if (input.filterBrandId) filters.push(eq(projects.brandId, input.filterBrandId));
      if (input.filterAgencyId) filters.push(eq(projects.agencyId, input.filterAgencyId));
      if (input.filterTags && input.filterTags.length > 0) {
        filters.push(
          exists(
            ctx.db.select().from(projectsToTags)
              .where(and(eq(projectsToTags.projectId, projects.id), inArray(projectsToTags.tagId, input.filterTags)))
          )
        );
      }
      if (input.serviceName) {
        if (Array.isArray(input.serviceName)) {
          if (input.serviceName.length > 0) {
            filters.push(inArray(projects.serviceName, input.serviceName));
          }
        } else {
          filters.push(eq(projects.serviceName, input.serviceName));
        }
      }
      if (input.serviceType) {
        if (Array.isArray(input.serviceType)) {
          if (input.serviceType.length > 0) {
            filters.push(inArray(projects.serviceType, input.serviceType));
          }
        } else {
          filters.push(eq(projects.serviceType, input.serviceType));
        }
      }

      let rows = await ctx.db.select().from(projects).where(and(...filters)).orderBy(desc(projects.updatedAt));

      if (input.amountFilter) {
        const { operator, value } = input.amountFilter;
        rows = rows.filter((p) => {
          const price = getProjectCyclePrice(p);
          if (operator === 'equals') {
            return price === Number(value);
          }
          if (operator === 'greaterThan') {
            return price > Number(value);
          }
          if (operator === 'lessThan') {
            return price < Number(value);
          }
          if (operator === 'between' && Array.isArray(value) && value.length === 2) {
            const min = Number(value[0]);
            const max = Number(value[1]);
            return price >= min && price <= max;
          }
          return true;
        });
      }

      if (input.dateFilter) {
        const { operator, value, unit } = input.dateFilter;
        rows = rows.filter((p) => {
          if (!p.createdAt) return false;
          const createdTime = new Date(p.createdAt).getTime();
          if (operator === 'inLast') {
            const num = Number(value);
            if (isNaN(num)) return true;
            let ms = num * 24 * 60 * 60 * 1000;
            if (unit === 'hours') ms = num * 60 * 60 * 1000;
            else if (unit === 'weeks') ms = num * 7 * 24 * 60 * 60 * 1000;
            else if (unit === 'months') ms = num * 30 * 24 * 60 * 60 * 1000;
            return createdTime >= Date.now() - ms;
          }
          if (operator === 'equals') {
            const start = new Date(String(value));
            if (isNaN(start.getTime())) return true;
            const createdDateStr = new Date(p.createdAt).toISOString().split('T')[0];
            const targetDateStr = start.toISOString().split('T')[0];
            return createdDateStr === targetDateStr;
          }
          if (operator === 'between' && Array.isArray(value) && value.length === 2) {
            const start = new Date(value[0]);
            const end = new Date(value[1]);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
            const endTime = end.getTime() + (24 * 60 * 60 * 1000 - 1);
            return createdTime >= start.getTime() && createdTime <= endTime;
          }
          if (operator === 'greaterThan') {
            const target = new Date(String(value));
            if (isNaN(target.getTime())) return true;
            return createdTime > target.getTime();
          }
          if (operator === 'lessThan') {
            const target = new Date(String(value));
            if (isNaN(target.getTime())) return true;
            return createdTime < target.getTime();
          }
          return true;
        });
      }

      // Assignee display info for the card avatar (name + profile picture), batched
      // to avoid an N-query loop. production_assignee_id is always a user id, so the
      // base identity comes from `users`; for staff we overlay the staff displayName
      // when one exists (owners are allocatable without a staff row → user name).
      const assigneeUserIds = [...new Set(rows.filter((p) => p.productionAssigneeId).map((p) => p.productionAssigneeId!))];
      const staffUserIds = [...new Set(rows.filter((p) => p.assigneeType === 'staff' && p.productionAssigneeId).map((p) => p.productionAssigneeId!))];
      const [userRows, staffNameRows] = await Promise.all([
        assigneeUserIds.length
          ? ctx.db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl }).from(users).where(inArray(users.id, assigneeUserIds))
          : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null; email: string | null; profileUrl: string | null }[]),
        staffUserIds.length
          ? ctx.db.select({ userId: staff.userId, displayName: staff.displayName }).from(staff).where(inArray(staff.userId, staffUserIds))
          : Promise.resolve([] as { userId: string | null; displayName: string | null }[]),
      ]);
      const userById = new Map(userRows.map((u) => [u.id, { name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Assignee', avatar: u.profileUrl ?? null }]));
      const staffNameByUserId = new Map(staffNameRows.filter((s) => s.userId && s.displayName).map((s) => [s.userId!, s.displayName!]));
      const assigneeFor = (p: ProjectRow) => {
        if (!p.productionAssigneeId) return null;
        const u = userById.get(p.productionAssigneeId);
        if (!u) return null;
        const name = (p.assigneeType === 'staff' && staffNameByUserId.get(p.productionAssigneeId)) || u.name;
        return { name, avatar: u.avatar };
      };

      // Resolve the counter-party name shown as the card's title prefix (mirrors
      // KanbanProjectCard): an agency-side viewer sees the client brand, a
      // brand-side viewer sees the fulfilling agency. Batched to avoid N queries.
      // The brand name falls back to the project's stored free-text `brandName`
      // when no registered brand is linked (internal/complimentary projects).
      const brandIds = [...new Set(rows.filter((p) => p.brandId).map((p) => p.brandId!))];
      const agencyIds = [...new Set(rows.filter((p) => p.agencyId).map((p) => p.agencyId!))];
      const [brandNameRows, agencyNameRows] = await Promise.all([
        brandIds.length
          ? ctx.db.select({ id: brands.id, name: brands.businessName }).from(brands).where(inArray(brands.id, brandIds))
          : Promise.resolve([] as { id: string; name: string }[]),
        agencyIds.length
          ? ctx.db.select({ id: agencies.id, name: agencies.businessName }).from(agencies).where(inArray(agencies.id, agencyIds))
          : Promise.resolve([] as { id: string; name: string }[]),
      ]);
      const brandNameById = new Map(brandNameRows.map((b) => [b.id, b.name]));
      const agencyNameById = new Map(agencyNameRows.map((a) => [a.id, a.name]));
      const partyNameFor = (p: ProjectRow) => ({
        brandName: (p.brandId ? brandNameById.get(p.brandId) : null) ?? p.brandName ?? null,
        agencyName: (p.agencyId ? agencyNameById.get(p.agencyId) : null) ?? null,
      });

      const projectIds = rows.map((p) => p.id);
      const allTags = projectIds.length > 0 ? await ctx.db
        .select({
          projectId: projectsToTags.projectId,
          id: projectTags.id,
          name: projectTags.name,
          color: projectTags.color,
        })
        .from(projectsToTags)
        .innerJoin(projectTags, eq(projectTags.id, projectsToTags.tagId))
        .where(inArray(projectsToTags.projectId, projectIds)) : [];
      
      const tagsByProjectId = new Map<string, { id: string, name: string, color: string }[]>();
      for (const t of allTags) {
        if (!tagsByProjectId.has(t.projectId)) tagsByProjectId.set(t.projectId, []);
        tagsByProjectId.get(t.projectId)!.push({ id: t.id, name: t.name, color: t.color });
      }

      // Enrich each project with the viewer's allowed next statuses so the client
      // can gate drag/drop and pick the right confirmation dialog (mirrors the
      // Flutter board, which computes getAllowedTransitions per card locally).
      const buildCtx = await buildBoardContextFactory(ctx, input);
      const enriched = rows.map((p) => ({ ...omitActionTokens(p), allowedTransitions: getAllowedTransitions(buildCtx(p)), assignee: assigneeFor(p), tags: tagsByProjectId.get(p.id) ?? [], ...partyNameFor(p) }));
      const columns = Object.fromEntries(STATUSES.map((s) => [s, [] as typeof enriched])) as Record<Status, typeof enriched>;
      for (const p of enriched) columns[p.status as Status].push(p);
      return { columns, total: rows.length };
    }),

  /**
   * Filter-bar option lists for the Kanban board, derived from the full
   * (unfiltered) project set in scope so the dropdowns stay stable as the user
   * narrows the board. Agencies get a brand + service + service-type list;
   * brands get a fulfilling-agency + service-type list. Mirrors the way the
   * Flutter board hydrates its filter dropdowns from the loaded projects.
   */
  boardFacets: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid().optional(), brandId: z.string().uuid().optional(), includeSalesAgency: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const scopeFilters = [isNull(projects.deletedAt)];
      let mode: 'agency' | 'brand';
      if (input.agencyId) {
        await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
        if (input.includeSalesAgency) {
          scopeFilters.push(or(
            eq(projects.agencyId, input.agencyId),
            eq(projects.proposalSentByAgencyId, input.agencyId),
          )!);
        } else {
          scopeFilters.push(eq(projects.agencyId, input.agencyId));
        }
        mode = 'agency';
      } else if (input.brandId) {
        await assertBrandAccess(ctx, input.brandId, 'brandProjects');
        scopeFilters.push(eq(projects.brandId, input.brandId), eq(projects.viewableToBrand, true));
        mode = 'brand';
      } else throw new TRPCError({ code: 'BAD_REQUEST' });
      const scope = and(...scopeFilters);

      // Service name + type facets are shared by both views.
      const [serviceRows, typeRows] = await Promise.all([
        ctx.db.selectDistinct({ name: projects.serviceName }).from(projects).where(and(scope, isNotNull(projects.serviceName))).orderBy(projects.serviceName),
        ctx.db.selectDistinct({ type: projects.serviceType }).from(projects).where(and(scope, isNotNull(projects.serviceType))),
      ]);
      const services = serviceRows.map((r) => r.name!).filter(Boolean);
      // Present service types in the canonical Flutter enum order.
      const presentTypes = new Set(typeRows.map((r) => r.type));
      const serviceTypes = SERVICE_TYPES.filter((t) => presentTypes.has(t));

      let tags: { id: string; name: string; color: string }[] = [];
      if (mode === 'agency' && input.agencyId) {
        tags = await ctx.db
          .select({ id: projectTags.id, name: projectTags.name, color: projectTags.color })
          .from(projectTags)
          .where(eq(projectTags.agencyId, input.agencyId));
      }

      if (mode === 'agency') {
        const brands_ = await ctx.db
          .selectDistinct({ id: brands.id, name: brands.businessName, logoUrl: brands.logoUrl })
          .from(projects)
          .innerJoin(brands, eq(projects.brandId, brands.id))
          .where(scope)
          .orderBy(brands.businessName);
        return { brands: brands_, agencies: [] as { id: string; name: string; logoUrl: string | null }[], services, serviceTypes, tags };
      }
      const agencies_ = await ctx.db
        .selectDistinct({ id: agencies.id, name: agencies.businessName, logoUrl: agencies.logoUrl })
        .from(projects)
        .innerJoin(agencies, eq(projects.agencyId, agencies.id))
        .where(scope)
        .orderBy(agencies.businessName);
      return { brands: [] as { id: string; name: string; logoUrl: string | null }[], agencies: agencies_, services, serviceTypes, tags };
    }),

  /** Paginated flat list (table view). */
  list: protectedProcedure
    .input(paginationInput.extend({ agencyId: z.string().uuid().optional(), brandId: z.string().uuid().optional(), status: statusEnum.optional() }))
    .query(async ({ ctx, input }) => {
      const filters = [isNull(projects.deletedAt)];
      if (input.agencyId) {
        await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
        filters.push(eq(projects.agencyId, input.agencyId));
      } else if (input.brandId) {
        await assertBrandAccess(ctx, input.brandId, 'brandProjects');
        filters.push(eq(projects.brandId, input.brandId), eq(projects.viewableToBrand, true));
      } else throw new TRPCError({ code: 'BAD_REQUEST' });
      if (input.status) filters.push(eq(projects.status, input.status));
      const where = and(...filters);

      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(projects).where(where).orderBy(desc(projects.updatedAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(projects).where(where),
      ]);
      // Only Recurring Service / Recurring Product (Ships) subscriptions are
      // cancellable (see cancelSubscription); flag each row so the UI hides the
      // cancel control on everything else.
      return page(
        rows.map((r) => ({ ...omitActionTokens(r), cancellable: hasDeliverableCycle(r.serviceType as ServiceType | null) })),
        total,
        input,
      );
    }),

  byId: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await loadProject(ctx, input.id);
    // Access check: agency member or brand member.
    if (project.agencyId) {
      try {
        await assertAgencyAccess(ctx, project.agencyId);
      } catch {
        if (project.brandId) await assertBrandAccess(ctx, project.brandId);
        // Contractor access is by assignment — but an unpaid internal project sits
        // in `allocate` (the Stripe webhook flips it to production once paid), and
        // must stay invisible to the assigned contractor until then.
        else if (project.productionAssigneeId !== ctx.user.id || project.status === 'allocate') throw new TRPCError({ code: 'FORBIDDEN' });
      }
    } else if (project.brandId) {
      await assertBrandAccess(ctx, project.brandId);
    }
    const [deliverables, revisions, notes, cycles, projectTagsList] = await Promise.all([
      ctx.db.select().from(projectDeliverables).where(eq(projectDeliverables.projectId, input.id)).orderBy(asc(projectDeliverables.sortOrder), projectDeliverables.uploadedAt),
      ctx.db.select().from(projectRevisions).where(eq(projectRevisions.projectId, input.id)).orderBy(projectRevisions.createdAt),
      ctx.db.select().from(projectNotes).where(eq(projectNotes.projectId, input.id)).orderBy(projectNotes.createdAt),
      // Per-cycle history (completed-cycle brief snapshots + future pre-briefs).
      ctx.db.select().from(projectCycles).where(eq(projectCycles.projectId, input.id)).orderBy(asc(projectCycles.cycleNumber)),
      ctx.db
        .select({ id: projectTags.id, name: projectTags.name, color: projectTags.color })
        .from(projectsToTags)
        .innerJoin(projectTags, eq(projectTags.id, projectsToTags.tagId))
        .where(eq(projectsToTags.projectId, input.id)),
    ]);

    // Surface the viewer's allowed transitions so the client can gate UI affordances.
    const tctx = await buildTransitionContext(ctx, project);
    const allowedTransitions = getAllowedTransitions(tctx);
    // Ceiling for the allocate dialog's contractor-budget field.
    const maxContractorBudget = await contractorBudgetCeiling(ctx, project);

    // Lightweight display info for the brand/agency/assignee chat chips
    // (brand_agency_chips.dart + project_assignee_chip.dart). `assignee.userId`
    // is the chat-target user (resolved through the staff row for staff assignees).
    const [brand, agency] = await Promise.all([
      project.brandId ? ctx.db.select({ id: brands.id, name: brands.businessName, logoUrl: brands.logoUrl }).from(brands).where(eq(brands.id, project.brandId)).limit(1) : Promise.resolve([]),
      project.agencyId ? ctx.db.select({ id: agencies.id, name: agencies.businessName, logoUrl: agencies.logoUrl }).from(agencies).where(eq(agencies.id, project.agencyId)).limit(1) : Promise.resolve([]),
    ]);
    let assignee: { userId: string; name: string; avatar: string | null } | null = null;
    if (project.productionAssigneeId) {
      // production_assignee_id is always a user id (staff member's user, the agency
      // owner, or the contractor). Resolve identity from `users`; for staff overlay
      // the per-agency staff displayName when present.
      const u = (await ctx.db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl }).from(users).where(eq(users.id, project.productionAssigneeId)).limit(1))[0];
      if (u) {
        let name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Assignee';
        if (project.assigneeType === 'staff' && project.agencyId) {
          const s = (await ctx.db.select({ displayName: staff.displayName }).from(staff).where(and(eq(staff.userId, project.productionAssigneeId), eq(staff.agencyId, project.agencyId))).limit(1))[0];
          if (s?.displayName) name = s.displayName;
        }
        assignee = { userId: u.id, name, avatar: u.profileUrl };
      }
    }

    // Per-side visibility, mirroring project_brand_partition.dart +
    // project_agency_partition.dart and stripping the hidden fields server-side so
    // they never reach the client.
    //  • Brand: only brand-source materials, plus agency-source *deliverables* once
    //    the work reaches them (client-approval/completed). No internal agency
    //    context, contractor budget/duration, assignee identity, or agency-source
    //    notes/revisions/docs. Gated on isBrandUser (context selector on a brand).
    //  • Contractor (the assigned individual — neither an agency member nor a brand
    //    user): the inverse — they get the agency-side workspace but nothing
    //    brand-related except the brand's name. The brand brief, requirements,
    //    pricing, and brand-source materials are stripped (Flutter never builds the
    //    brand partition for a contractor).
    const isAgencyMember = !!tctx.agencyStaff || tctx.isAgencyOwner;
    const isBrandViewer = tctx.activeAgencyId == null && (tctx.isBrandOwner || !!tctx.userBrandId);
    const isContractorViewer = !isAgencyMember && !isBrandViewer && !tctx.isSuperAdmin;
    const agencyDeliverablesVisible = project.status === 'clientApproval' || project.status === 'completed';
    const base = omitActionTokens(project);
    const bySource = <T extends { source: string | null }>(rows: T[], side: 'brand' | 'agency') => rows.filter((r) => r.source === side);
    const docsBySource = (side: 'brand' | 'agency') =>
      ((base.briefDocuments as { source?: string }[] | null) ?? []).filter((d) => d?.source === side);

    return {
      ...base,
      ...(isBrandViewer && {
        // The description + agency-source brief docs now live in the Agency
        // workspace (agency/contractor only), so they're stripped for the brand.
        // The brand keeps the shared Brand Workspace: brand-source docs, the
        // shared text posts, and their own answered brief questions.
        description: null,
        briefContext: null,
        contractorBudget: null,
        contractorBudgetNote: null,
        estimatedContractorDurationInHours: null,
        briefDocuments: docsBySource('brand'),
      }),
      ...(isContractorViewer && {
        // The contractor gets the agency-side workspace (description + agency
        // brief docs + context/budget/duration) but nothing in the shared
        // Brand Workspace: the brand's answered questions and the brand↔agency
        // text posts are stripped. Selected variant/options + add-ons stay —
        // they're work scope, not brand-private pricing.
        amount: null,
        customFieldResponses: [],
        brandWorkspaceNotes: [],
        briefDocuments: docsBySource('agency'),
      }),
      deliverables: isBrandViewer
        ? deliverables.filter((d) => d.source === 'brand' || (d.source === 'agency' && agencyDeliverablesVisible))
        : isContractorViewer
          ? bySource(deliverables, 'agency')
          : deliverables,
      revisions: isBrandViewer ? bySource(revisions, 'brand') : isContractorViewer ? bySource(revisions, 'agency') : revisions,
      notes: isBrandViewer ? bySource(notes, 'brand') : isContractorViewer ? bySource(notes, 'agency') : notes,
      // Cycle history carries agency-workspace briefs — stripped for brand viewers.
      cycles: isBrandViewer ? [] : cycles,
      allowedTransitions,
      maxContractorBudget: isBrandViewer ? null : maxContractorBudget,
      brand: brand[0] ?? null,
      agency: agency[0] ?? null,
      assignee: isBrandViewer ? null : assignee,
      tags: projectTagsList,
      viewer: {
        isAgencyOwner: tctx.isAgencyOwner,
        isAgencyMember,
        isBrandUser: isBrandViewer,
        isContractor: isContractorViewer,
        canAddBrief: canAddBrief(tctx),
        canAllocate: canAllocate(tctx),
        canApproveDeliverable: canApproveDeliverable(tctx),
        isAssignedPerson: isAssignedPerson(tctx),
      },
    };
  }),

  setProjectTags: protectedProcedure
    .input(z.object({ id: z.string().uuid(), tagIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.db.select().from(projects).where(eq(projects.id, input.id)).limit(1).then((r) => r[0]);
      if (!p) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!p.agencyId) throw new TRPCError({ code: 'BAD_REQUEST' });
      await assertAgencyAccess(ctx, p.agencyId, 'agencyProjects');

      await ctx.db.delete(projectsToTags).where(eq(projectsToTags.projectId, input.id));
      if (input.tagIds.length > 0) {
        await ctx.db.insert(projectsToTags).values(
          input.tagIds.map((tagId) => ({ projectId: input.id, tagId }))
        );
      }
      return { success: true };
    }),


  /**
   * Assignable people for the allocate flow: the agency owner + active agency staff
   * + actively-connected contractors. Every `id` here is a USER id — that's what
   * gets written to production_assignee_id (a users FK), and what task/payout
   * routing keys off. The owner has no staff row, so they're added explicitly.
   */
  assigneeOptions: protectedProcedure.input(z.object({ agencyId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
    const agency = (await ctx.db.select({ ownerId: agencies.ownerId }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
    const staffRows = await ctx.db
      .select({ userId: staff.userId, displayName: staff.displayName, email: staff.email, profileUrl: users.profileUrl })
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .where(and(eq(staff.agencyId, input.agencyId), eq(staff.status, 'active')));
    const owner = agency?.ownerId
      ? (await ctx.db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl }).from(users).where(eq(users.id, agency.ownerId)).limit(1))[0]
      : undefined;

    const conns = await ctx.db
      .select({ contractorId: agencyContractorConnections.contractorId, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl })
      .from(agencyContractorConnections)
      .innerJoin(users, eq(agencyContractorConnections.contractorId, users.id))
      .where(and(eq(agencyContractorConnections.agencyId, input.agencyId), eq(agencyContractorConnections.status, 'active')));

    // Owner first, then active staff with a linked user account (pending invites
    // have no userId yet → not allocatable). Dedupe the owner out of the staff list.
    const staffOptions = [
      ...(owner ? [{ id: owner.id, name: [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email, email: owner.email, profileUrl: owner.profileUrl, isOwner: true }] : []),
      ...staffRows
        .filter((s) => s.userId && s.userId !== agency?.ownerId)
        .map((s) => ({ id: s.userId!, name: s.displayName ?? s.email, email: s.email, profileUrl: s.profileUrl, isOwner: false })),
    ];
    return {
      staff: staffOptions,
      contractors: conns.map((c) => ({
        id: c.contractorId,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
        email: c.email,
        profileUrl: c.profileUrl,
      })),
    };
  }),

  /**
   * Reorder a project within a kanban column using fractional indexing.
   * `orderedIds` is the destination window's id order, with the dragged id
   * inserted at its new slot.
   */
  moveProject: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusEnum,
        orderedIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      const allowed = getAllowedTransitions(tctx);
      if (!allowed.includes(input.status) && project.status !== input.status) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to move project to this status.' });
      }

      await ctx.db.transaction(async (tx) => {
        // Relocate the dragged project to its new column (status)
        await tx
          .update(projects)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(projects.id, input.id));

        // Drop neighbors = the entries flanking the dragged id in the window.
        const idx = input.orderedIds.indexOf(input.id);
        const prevId = idx > 0 ? input.orderedIds[idx - 1] : null;
        const nextId = idx >= 0 && idx < input.orderedIds.length - 1 ? input.orderedIds[idx + 1] : null;

        const neighborIds = [prevId, nextId].filter((v): v is string => !!v);
        const neighbors = neighborIds.length
          ? await tx.select({ id: projects.id, sortOrder: projects.sortOrder }).from(projects).where(inArray(projects.id, neighborIds))
          : [];
        const sortOf = new Map(neighbors.map((r) => [r.id, r.sortOrder ?? 'a0']));
        const prev = prevId && sortOf.has(prevId) ? sortOf.get(prevId)! : null;
        const next = nextId && sortOf.has(nextId) ? sortOf.get(nextId)! : null;

        // Pick a sortOrder strictly between the neighbors.
        const target = generateKeyBetween(prev, next);
        await tx.update(projects).set({ sortOrder: target }).where(eq(projects.id, input.id));
      });
      await pingProjectsChanged(project.agencyId, project.brandId);
      return { ok: true };
    }),

  /**
   * Move a project to a new pipeline stage (kanban drag/drop), validating the
   * transition against the viewer's role/permissions and running side effects.
   */
  setStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid(), status: statusEnum, rejectionReason: z.string().optional(), attachmentUrls: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      const allowed = getAllowedTransitions(tctx);
      const to = input.status as Status;
      if (project.status === to) return project;
      if (!allowed.includes(to)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: `Transition ${project.status} → ${to} is not permitted.` });
      }

      const from = project.status as Status;

      // --- Side-effecting transitions ---
      // Internal approval → revision (reject).
      if (from === 'internalApproval' && to === 'revision') {
        return rejectToRevision(ctx, project, 'agency', input.rejectionReason, input.attachmentUrls);
      }
      // Internal approval → client approval (approve).
      if (from === 'internalApproval' && to === 'clientApproval') {
        const [u] = await ctx.db
          .update(projects)
          .set({ status: 'clientApproval', approvedBy: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(eq(projects.id, project.id))
          .returning();
        await notifyProjectStatus(ctx, project.id);
        await pingProjectsChanged(project.agencyId, project.brandId);
        return u;
      }
      // Client approval → internalApproval/revision (client reject).
      if (from === 'clientApproval' && (to === 'internalApproval' || to === 'revision')) {
        // Brand rejection always re-enters internal approval (Flutter clientApprovalDecision reject).
        return clientReject(ctx, project, input.rejectionReason, input.attachmentUrls);
      }
      // → completed (client approval / manual completion).
      if (to === 'completed') {
        return completeProject(ctx, project, ctx.user.id);
      }
      // clientBrief → brief/upcoming: the agency advancing the stage (the brand
      // submits via submitBrief). Where it lands is decided by phase start time,
      // NOT the dropped column — dropping on "future phase" when the start has
      // already passed still lands on `brief`, and vice-versa. Parking in
      // `upcoming` (re)arms the exact-time activation job that later moves it to
      // `brief` (clientBrief rows aren't scheduled at fulfillment).
      if (from === 'clientBrief' && (to === 'brief' || to === 'upcoming')) {
        const now = new Date();
        const landing = briefLandingStatus(project, now);
        const [u] = await ctx.db
          .update(projects)
          .set({ status: landing, updatedAt: now })
          .where(eq(projects.id, project.id))
          .returning();
        if (landing === 'upcoming' && u.nextCycleAt) await scheduleProjectCycle(u.id, u.nextCycleAt);
        await pingProjectsChanged(project.agencyId, project.brandId);
        return u;
      }

      // allocate → production without re-allocating (the assignee was already set —
      // e.g. a recurring cycle that retained its contractor). Run the same side
      // effects as `allocate`: the contractor payout + invoice for THIS cycle must
      // be booked even though the assignee didn't change (applyContractorFee is
      // cycle-scoped idempotent, so a dialog-driven allocate can't double-book).
      if (from === 'allocate' && to === 'production') {
        // Internal + contractor + budget must go through payInternalProject (the
        // Stripe webhook advances to production once paid) — never a plain move.
        const budget = Number(project.contractorBudget ?? 0);
        if (project.isInternal && project.assigneeType === 'contractor' && budget > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Internal project: complete the contractor payment to start production.' });
        }
        const [u] = await ctx.db.update(projects).set({ status: 'production', updatedAt: new Date() }).where(eq(projects.id, project.id)).returning();
        if (u.assigneeType === 'contractor' && u.brandId && u.agencyId) {
          await connectBrandToAgency(u.brandId, u.agencyId, ctx.db).catch((e) =>
            console.error('[setStatus] connectBrandToAgency failed', (e as Error).message),
          );
        }
        if (u.assigneeType === 'contractor') {
          await applyContractorFee(ctx, u as ProjectRow);
        }
        await notifyProjectStatus(ctx, project.id);
        await pingProjectsChanged(project.agencyId, project.brandId);
        return u;
      }

      // Default: plain status write (e.g. upcoming→brief, brief→allocate via dialog).
      const [updated] = await ctx.db.update(projects).set({ status: to, updatedAt: new Date() }).where(eq(projects.id, project.id)).returning();
      await pingProjectsChanged(project.agencyId, project.brandId);
      return updated;
    }),

  /** Inline-edit brief context / description / contractor budget + duration. */
  updateDetails: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        briefContext: z.string().optional(),
        description: z.string().optional(),
        contractorBudget: z.string().optional(),
        contractorBudgetNote: z.string().optional(),
        estimatedContractorDurationInHours: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      const { id, ...rest } = input;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
      const [updated] = await ctx.db.update(projects).set(set).where(eq(projects.id, id)).returning();
      return updated;
    }),

  /** Brand submits the client-brief custom-field responses (clientBrief → brief/upcoming). */
  submitBrief: protectedProcedure
    .input(z.object({ id: z.string().uuid(), customFieldResponses: z.array(z.any()).default([]) }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      if (project.brandId) await assertBrandAccess(ctx, project.brandId);
      // Where the brief LANDS is decided by the phase start time, never by which
      // column the brand dropped on (see briefLandingStatus / kanban-permissions.md).
      const now = new Date();
      const status = briefLandingStatus(project, now);
      const [updated] = await ctx.db
        .update(projects)
        .set({ customFieldResponses: input.customFieldResponses as unknown[], status, updatedAt: now })
        .where(eq(projects.id, project.id))
        .returning();
      // The brand's questionnaire answer files flow into the locker's Agency
      // Documents (tagged to this project's agency). Append-only; re-submitting
      // keeps prior files as history (deduped per question+url).
      if (project.brandId) {
        const lockerRows = ((input.customFieldResponses as Array<{ question?: { id?: string; label?: string }; answer?: { value?: unknown } }>) ?? [])
          .flatMap((r) =>
            answerUrls(r?.answer?.value)
              .filter((u) => u.startsWith('http'))
              .map((url) => ({
                brandId: project.brandId!,
                url,
                name: r?.question?.label || 'Questionnaire file',
                agencyId: project.agencyId ?? null,
                projectId: project.id,
                projectTitle: project.title ?? project.serviceName ?? null,
                agencyWhoUploaded: project.agencyId ?? null,
                uploadedBy: ctx.user.id,
                category: 'questionnaire',
                source: 'brand',
                note: `Questionnaire answer${r?.question?.label ? ` — ${r.question.label}` : ''} from ${project.title ?? project.serviceName ?? 'project brief'}`,
                sourceType: 'questionnaire' as const,
                sourceId: `${project.id}:${r?.question?.id ?? ''}:${url}`,
              })),
          );
        if (lockerRows.length) await recordLockerFiles(ctx.db, lockerRows);
      }
      // Parking in `upcoming` from the clientBrief flow must (re)arm the exact-time
      // activation job — it wasn't scheduled at creation because the project started
      // in `clientBrief`, not `upcoming` (fulfillment only schedules upcoming rows).
      // The job later runs runProjectCycle → moves it to `brief` at the phase start.
      if (status === 'upcoming' && updated.nextCycleAt) {
        await scheduleProjectCycle(updated.id, updated.nextCycleAt);
      }
      return updated;
    }),

  /** Agency completes the brief stage: store brief docs + context, advance to allocate. */
  completeBrief: protectedProcedure
    .input(z.object({ id: z.string().uuid(), briefDocuments: z.array(z.any()).default([]), briefContext: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      if (!canAddBrief(tctx)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission: addBrief' });
      const set: Record<string, unknown> = { briefDocuments: input.briefDocuments as unknown[], status: 'allocate', updatedAt: new Date() };
      if (input.briefContext !== undefined) set.briefContext = input.briefContext;
      const [updated] = await ctx.db.update(projects).set(set).where(eq(projects.id, project.id)).returning();
      return updated;
    }),

  /** Append a brief document atomically (without advancing the stage). */
  addBriefDocument: protectedProcedure
    .input(z.object({ id: z.string().uuid(), document: z.any() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      if (project.agencyId) {
        try {
          await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
        } catch {
          if (project.brandId) await assertBrandAccess(ctx, project.brandId);
        }
      }
      const docs = [...((project.briefDocuments as unknown[]) ?? []), input.document];
      const [updated] = await ctx.db.update(projects).set({ briefDocuments: docs, updatedAt: new Date() }).where(eq(projects.id, project.id)).returning();
      // Only BRAND-workspace brief docs reach the locker (Agency Documents).
      // Agency-workspace docs (source: 'agency') are deliberately excluded.
      const doc = input.document as { url?: string; fileName?: string; source?: string } | null;
      if (doc?.url && doc.source === 'brand' && project.brandId) {
        await recordLockerFile(ctx.db, {
          brandId: project.brandId,
          url: doc.url,
          name: doc.fileName ?? 'Brief document',
          agencyId: project.agencyId ?? null,
          projectId: project.id,
          projectTitle: project.title ?? project.serviceName ?? null,
          agencyWhoUploaded: project.agencyId ?? null,
          uploadedBy: ctx.user.id,
          category: 'brief',
          source: 'brand',
          note: `Brief document from ${project.title ?? project.serviceName ?? 'the project brief'}`,
          sourceType: 'briefDoc',
          sourceId: `${project.id}:${doc.url}`,
        }).catch((e) => console.error('[projects] addBriefDocument locker copy failed', (e as Error).message));
      }
      return updated;
    }),

  /**
   * Agency pre-writes (or edits) the brief for a FUTURE deliverable cycle of a
   * cycling project. The recycle engine promotes the pre-brief onto the live
   * project when that cycle opens. The CURRENT cycle's brief is still edited
   * via updateDetails / completeBrief / addBriefDocument.
   */
  upsertCycleBrief: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        cycleNumber: z.number().int().min(2),
        briefContext: z.string().optional(),
        briefDocuments: z.array(z.any()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      if (!canAddBrief(tctx)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission: addBrief' });
      if (!hasDeliverableCycle(project.serviceType as ServiceType | null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This project has no deliverable cycle.' });
      }
      if (input.cycleNumber <= currentCycleNumber(project)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only future cycles can be pre-briefed — edit the current brief directly.' });
      }
      const now = new Date();
      const set: Record<string, unknown> = { updatedAt: now };
      if (input.briefContext !== undefined) set.briefContext = input.briefContext;
      if (input.briefDocuments !== undefined) set.briefDocuments = input.briefDocuments as unknown[];
      const [row] = await ctx.db
        .insert(projectCycles)
        .values({
          projectId: project.id,
          cycleNumber: input.cycleNumber,
          briefContext: input.briefContext ?? null,
          briefDocuments: (input.briefDocuments as unknown[]) ?? [],
        })
        .onConflictDoUpdate({ target: [projectCycles.projectId, projectCycles.cycleNumber], set })
        .returning();
      return row;
    }),

  /**
   * Append a Brand Workspace text post (the shared brand↔agency thread).
   * Either side may post; the entry records who wrote it so the other side
   * sees the author. Contractors can't reach this — it's brand-visible.
   */
  addBrandWorkspaceNote: protectedProcedure
    .input(z.object({ id: z.string().uuid(), content: z.string().min(1), source: z.enum(['brand', 'agency']) }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      // Brand or agency members may post; contractors are rejected.
      if (input.source === 'brand') {
        if (project.brandId) await assertBrandAccess(ctx, project.brandId);
      } else if (project.agencyId) {
        await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      }
      const me = (await ctx.db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1))[0];
      const authorName = [me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.email || 'User';
      const entry = {
        id: crypto.randomUUID(),
        authorId: ctx.user.id,
        authorName,
        source: input.source,
        content: input.content,
        createdAt: new Date().toISOString(),
      };
      const notes = [...((project.brandWorkspaceNotes as unknown[]) ?? []), entry];
      const [updated] = await ctx.db.update(projects).set({ brandWorkspaceNotes: notes, updatedAt: new Date() }).where(eq(projects.id, project.id)).returning();
      return updated;
    }),

  /**
   * Allocate the project: assign a staff member or contractor with optional
   * budget/duration. Validates contractor↔agency connection, advances to
   * production. Internal projects skip the status change (Stripe webhook moves
   * them later).
   */
  allocate: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        assigneeType: z.enum(['staff', 'contractor']),
        assigneeId: z.string().uuid(),
        contractorBudget: z.string().optional(),
        contractorBudgetNote: z.string().optional(),
        estimatedContractorDurationInHours: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      if (!canAllocate(tctx)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission: allocatePeople' });

      if (input.assigneeType === 'contractor' && project.agencyId) {
        await assertContractorConnected(ctx, project.agencyId, input.assigneeId);
        // Guard the budget against the agency-owner's available margin (the
        // Flutter allocate dialog's max-budget check). Skipped when no ceiling
        // is known yet (internal / pre-fulfilment projects).
        if (input.contractorBudget !== undefined) {
          const ceiling = await contractorBudgetCeiling(ctx, project);
          if (ceiling != null && Number(input.contractorBudget) > ceiling + 0.001) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Contractor budget exceeds the available agency margin (${formatPrice(ceiling)}).`,
            });
          }
        }
      } else if (input.assigneeType === 'staff' && project.agencyId) {
        // assigneeId is a user id (assigneeOptions returns the owner + active staff
        // keyed by user id). Confirm it really belongs to this agency before writing
        // it to the users-FK column, so a stale/forged id can't slip through.
        const isMember = await isAgencyMemberUser(ctx, project.agencyId, input.assigneeId);
        if (!isMember) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Assignee is not a member of this agency.' });
      }

      const set: Record<string, unknown> = {
        productionAssigneeId: input.assigneeId,
        assigneeType: input.assigneeType,
        allocatedAt: new Date(),
        updatedAt: new Date(),
      };
      if (input.contractorBudget !== undefined) set.contractorBudget = input.contractorBudget;
      if (input.contractorBudgetNote !== undefined) set.contractorBudgetNote = input.contractorBudgetNote;
      if (input.estimatedContractorDurationInHours !== undefined) set.estimatedContractorDurationInHours = input.estimatedContractorDurationInHours;

      // Move to production now unless this is an internal project that still
      // needs a Stripe payment — i.e. internal + contractor + budget > 0. Those
      // stay in `allocate`; payInternalProject opens checkout and the webhook
      // advances them to production once paid. Internal staff allocations and
      // zero-budget contractor allocations need no payment, so they start now
      // (matches the Flutter allocate dialog: it only calls payInternalProject
      // for a contractor with a budget, otherwise allocates straight through).
      const paymentBudget = input.contractorBudget !== undefined ? Number(input.contractorBudget) : Number(project.contractorBudget ?? 0);
      const awaitsInternalPayment = project.isInternal && input.assigneeType === 'contractor' && paymentBudget > 0;
      if (!awaitsInternalPayment) {
        set.status = 'production';
      }

      const [updated] = await ctx.db.update(projects).set(set).where(eq(projects.id, project.id)).returning();
      // allocate→production for a contractor: create the contractor payout + invoice
      // and deduct the fee from the agency owner's payout (onContractorFeeUpdated).
      if (updated.assigneeType === 'contractor' && updated.brandId && updated.agencyId) {
        // A contractor working a brand's project formally links the brand & agency:
        // ensure the connection + chat threads + the agency's default Info Hub sections.
        await connectBrandToAgency(updated.brandId, updated.agencyId, ctx.db).catch((e) =>
          console.error('[allocate] connectBrandToAgency failed', (e as Error).message),
        );
      }
      if (updated.status === 'production' && updated.assigneeType === 'contractor') {
        await applyContractorFee(ctx, updated as ProjectRow);
      }
      await notifyProjectStatus(ctx, project.id);
      return updated;
    }),

  /** Legacy bare assign (kept for compatibility); validates connection when contractor. */
  assign: protectedProcedure
    .input(z.object({ id: z.string().uuid(), assigneeType: z.enum(['none', 'staff', 'contractor']), productionAssigneeId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      if (input.assigneeType === 'contractor' && input.productionAssigneeId && project.agencyId) {
        await assertContractorConnected(ctx, project.agencyId, input.productionAssigneeId);
      }
      const [updated] = await ctx.db
        .update(projects)
        .set({
          assigneeType: input.assigneeType,
          productionAssigneeId: input.productionAssigneeId,
          allocatedAt: input.productionAssigneeId ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id))
        .returning();
      return updated;
    }),

  /* ---- Deliverables ---- */

  addDeliverable: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        type: z.enum(['text', 'document', 'image']).default('document'),
        content: z.string().optional(),
        fileName: z.string().optional(),
        description: z.string().optional(),
        source: z.enum(['brand', 'agency']).default('agency'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.projectId);
      // Assigned contractor, agency member, or brand member may add deliverables.
      const tctx = await buildTransitionContext(ctx, project);
      if (!isAssignedPerson(tctx) && !tctx.isAgencyOwner && !tctx.agencyStaff && !tctx.userBrandId && !tctx.isBrandOwner && !ctx.user.isSuperAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const { projectId, ...rest } = input;
      // Append after existing deliverables so manual drag order is preserved.
      const [{ value: existing }] = await ctx.db.select({ value: count() }).from(projectDeliverables).where(eq(projectDeliverables.projectId, projectId));
      const [d] = await ctx.db.insert(projectDeliverables).values({ projectId, uploadedBy: ctx.user.id, sortOrder: existing, cycle: currentCycleNumber(project), ...rest }).returning();
      await ctx.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      // A deliverable ADDED to an already-completed project flows straight into
      // the brand's document locker (completion-time copy has already run).
      if (project.status === 'completed' && project.brandId && d.source === 'agency' && d.content && (d.type === 'document' || d.type === 'image')) {
        await recordLockerFile(ctx.db, {
          brandId: project.brandId,
          url: d.content,
          name: d.fileName ?? d.description ?? 'Deliverable',
          agencyId: project.agencyId ?? null,
          projectId: project.id,
          projectTitle: project.title ?? project.serviceName ?? null,
          agencyWhoUploaded: project.agencyId ?? null,
          uploadedBy: d.uploadedBy ?? null,
          note: deliverableNote(project, (d.sortOrder ?? 0) + 1),
          type: d.type === 'image' ? 'image' : 'document',
          category: 'deliverable',
          source: 'agency',
          sourceType: 'deliverable',
          sourceId: d.id,
        }).catch((e) => console.error('[projects] addDeliverable locker copy failed', (e as Error).message));
      }
      return d;
    }),

  updateDeliverable: protectedProcedure
    .input(z.object({ id: z.string().uuid(), content: z.string().optional(), fileName: z.string().optional(), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      // Deliverables are locked once the project completes: their files have
      // already flowed into the brand's document locker, so they must not change
      // out from under it. New deliverables may still be ADDED (addDeliverable).
      await assertDeliverableMutable(ctx, id);
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
      const [d] = await ctx.db.update(projectDeliverables).set(set).where(eq(projectDeliverables.id, id)).returning();
      return d;
    }),

  removeDeliverable: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await assertDeliverableMutable(ctx, input.id);
    await ctx.db.delete(projectDeliverables).where(eq(projectDeliverables.id, input.id));
    return { ok: true };
  }),

  /**
   * Persist a drag-to-reorder of a project's deliverables (manage_deliverables
   * dialog's ReorderableListView). `orderedIds` is the full id list in the new
   * order; each row's sortOrder is set to its index. Same actor set as
   * addDeliverable may reorder (assigned contractor, agency member, brand member).
   */
  reorderDeliverables: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.projectId);
      const tctx = await buildTransitionContext(ctx, project);
      if (!isAssignedPerson(tctx) && !tctx.isAgencyOwner && !tctx.agencyStaff && !tctx.userBrandId && !tctx.isBrandOwner && !ctx.user.isSuperAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await Promise.all(
        input.orderedIds.map((id, i) =>
          ctx.db
            .update(projectDeliverables)
            .set({ sortOrder: i })
            .where(and(eq(projectDeliverables.id, id), eq(projectDeliverables.projectId, input.projectId))),
        ),
      );
      return { ok: true };
    }),

  /** Internal-approval per-deliverable approve/reject (no stage change). */
  reviewDeliverable: protectedProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .update(projectDeliverables)
        .set({ status: input.status, rejectionReason: input.rejectionReason, reviewedBy: ctx.user.id, reviewedAt: new Date() })
        .where(eq(projectDeliverables.id, input.id))
        .returning();
      return d;
    }),

  /**
   * Internal approval decision: approve → clientApproval, reject → revision
   * (increments revisionCount, records a projectRevisions row).
   */
  internalApprovalDecision: protectedProcedure
    .input(z.object({ id: z.string().uuid(), approved: z.boolean(), rejectionReason: z.string().optional(), attachmentUrls: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      if (!canApproveDeliverable(tctx)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission: approveDeliverable' });
      if (input.approved) {
        const [u] = await ctx.db
          .update(projects)
          .set({ status: 'clientApproval', approvedBy: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(eq(projects.id, project.id))
          .returning();
        await notifyProjectStatus(ctx, project.id);
        return u;
      }
      return rejectToRevision(ctx, project, 'agency', input.rejectionReason, input.attachmentUrls);
    }),

  /**
   * Client approval decision: approve → completed (schedules next cycle for
   * recurring services + auto-approves deliverables for standard); reject →
   * internalApproval (increments clientRevisionCount).
   */
  clientApprovalDecision: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      approved: z.boolean(),
      rejectionReason: z.string().optional(),
      attachmentUrls: z.array(z.string()).optional(),
      // Manual completion (agency completes on the client's behalf): records how
      // the client confirmed out-of-band and the historical date it happened.
      approvalMethod: z.string().optional(),
      approvedAt: z.coerce.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      const tctx = await buildTransitionContext(ctx, project);
      // Completing on the client's behalf is the "Approval Manager" capability
      // (approveDeliverable / approval designee / owner) — no separate perm.
      const complete = canApproveDeliverable(tctx);
      if (!canClientApprove(tctx) && !tctx.isBrandOwner && !complete) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (input.approved)
        return completeProject(ctx, project, ctx.user.id, {
          approvalMethod: input.approvalMethod ?? null,
          approvedAt: input.approvedAt ?? null,
        });
      return clientReject(ctx, project, input.rejectionReason, input.attachmentUrls);
    }),

  /**
   * Mark complete — Flutter requests a confirmation email to the brand owner
   * rather than directly completing. Stubbed external call.
   */
  markProjectComplete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(ctx, input.id);
    if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
    // Port of cloud function `requestProjectCompletion`: stamp a one-click confirm
    // token (10-day expiry) + email the brand owner. Clicking the emailed link
    // completes the project via the /confirm/complete endpoint (no login needed).
    const token = crypto.randomUUID();
    // request_completion.ts: requesting completion ALSO advances the project into
    // the client-approval lane (awaiting the brand's confirm), not just stamps a token.
    await ctx.db
      .update(projects)
      .set({
        status: 'clientApproval',
        completionToken: token,
        completionExpiry: new Date(Date.now() + 10 * 86_400_000),
        approvedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));
    await notifyProjectStatus(ctx, project.id);
    await enqueueEmail('project-completion-request', { projectId: project.id, origin: ctx.clientOrigin });
    return { ok: true };
  }),

  /* ---- Notes ---- */

  addNote: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), content: z.string().min(1), source: z.enum(['brand', 'agency']).default('agency') }))
    .mutation(async ({ ctx, input }) => {
      const [n] = await ctx.db
        .insert(projectNotes)
        .values({
          projectId: input.projectId,
          content: input.content,
          source: input.source,
          authorRole: input.source,
          authorId: ctx.user.id,
          authorName: authorName(ctx.user),
        })
        .returning();
      return n;
    }),

  /* ---- Delete / cancel ---- */

  /**
   * Immediate delete — INTERNAL (agency-paid) projects only (spec §4.1). The agency
   * acts directly (no brand to confirm with) and any refund goes back to the agency.
   * Non-internal projects must go through {@link requestSoftDeleteConfirmation} so the
   * brand confirms (spec §4.2). One-offs delete with a full up-front refund; recurring
   * refunds the current cycle pool and removes its subscription item.
   */
  softDelete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), proposedRefundAmount: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      if (project.status === 'completed') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Completed projects cannot be deleted.' });
      assertWeeklyDeletable(project);
      if (!project.isInternal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Non-internal projects must be deleted via brand confirmation (requestSoftDeleteConfirmation).',
        });
      }
      const purchase = project.purchaseId
        ? (await ctx.db.select().from(purchases).where(eq(purchases.id, project.purchaseId)).limit(1))[0]
        : null;
      // Reverse every still-pending payout for the cycle (invoices follow).
      await voidProjectPendingPayouts(ctx, project);
      // Refund to the AGENCY's account — full current pool by default (§4.1).
      const pool = await currentCycleRefundPool(project, purchase ?? null, ctx.db);
      const refund = input.proposedRefundAmount != null ? Number(input.proposedRefundAmount) : pool;
      if (refund > 0) await refundProjectPool(purchase ?? null, refund, ctx.db);
      // Recurring internal → also stop its billing (remove the subscription item).
      if (hasDeliverableCycle(project.serviceType as ServiceType | null)) {
        await cancelProjectSubscription(project, ctx.db);
      }
      const set: Record<string, unknown> = { deletedAt: new Date(), cancelledAt: new Date(), updatedAt: new Date() };
      if (input.proposedRefundAmount !== undefined) set.proposedRefundAmount = input.proposedRefundAmount;
      const [u] = await ctx.db.update(projects).set(set).where(eq(projects.id, project.id)).returning();
      return u;
    }),

  cancelSubscription: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(ctx, input.id);
    // Only genuine recurring subscriptions are cancellable: the Recurring Service
    // and Recurring Product (Ships) service types (exactly `hasDeliverableCycle`).
    // Everything else — one-offs, digital products, payment-plan instalments, and
    // the flat `subscription` type — is a fixed commitment, not a cancellable
    // recurring subscription. Payment plans are intentionally NOT a factor here.
    if (!hasDeliverableCycle(project.serviceType as ServiceType | null)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only recurring service and recurring product subscriptions can be cancelled.',
      });
    }
    // Either the fulfilling agency (owner/staff) OR the owning brand (owner/staff)
    // may cancel — Flutter exposes the cancel button on both the agency
    // `/subscriptions/:brandId` view and the brand's own `/subscriptions` view.
    if (project.agencyId) {
      try {
        await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      } catch (err) {
        if (project.brandId) await assertBrandAccess(ctx, project.brandId);
        else throw err;
      }
    } else if (project.brandId) {
      await assertBrandAccess(ctx, project.brandId);
    }
    // Cancel is SCHEDULED, never immediate (spec §3): it honours the minimum term
    // and the deliverable-cycle lock, landing before the next charge that would
    // fund the next, uncommitted cycle. Compute that effective date from the
    // current paymentCount + the cycle config.
    const purchase = project.purchaseId
      ? (await ctx.db.select().from(purchases).where(eq(purchases.id, project.purchaseId)).limit(1))[0]
      : null;
    const minTerm = Number(
      (project.recurringProjectConfig as { minimumTermBeforeCancellation?: number } | null)
        ?.minimumTermBeforeCancellation ?? 0,
    );
    // Delayed phases re-anchor to the phase start (§3.3): startDelayDays is on the item.
    const item = project.purchaseItemId
      ? (await ctx.db
          .select({ startDelayDays: purchaseItems.startDelayDays })
          .from(purchaseItems)
          .where(eq(purchaseItems.id, project.purchaseItemId))
          .limit(1))[0]
      : null;
    const cancelAt = scheduledCancellationDate({
      type: project.serviceType as ServiceType | null,
      deliverableFrequency: project.deliverableFrequency as DeliverableFrequency | null,
      repeatsEvery: project.repeatsEvery,
      anchor: cancellationAnchor(project.createdAt, item?.startDelayDays ?? 0),
      minTerm,
      paymentCount: purchase?.paymentCount ?? 0,
    });
    // Stamp the EFFECTIVE (future) cancel date; keep nextCycleAt so the committed
    // cycle still delivers. Only this project's billing is cancelled — the rest of
    // the subscription (and any future phase) keeps billing (cancelProjectSubscription).
    const [u] = await ctx.db
      .update(projects)
      .set({ cancelledAt: cancelAt, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning();
    await scheduleProjectCancellation(project, cancelAt, ctx.db);
    // Notify the brand + agency the subscription was cancelled (prod parity).
    await enqueueEmail('subscription-cancelled', { projectId: project.id });
    return u;
  }),

  /**
   * Revert a still-pending scheduled cancellation ("continue"). Only valid while
   * the cancellation hasn't taken effect yet (`cancelledAt` is in the future) —
   * once it lands the Stripe item/subscription is actually gone. Clears the
   * deferred job / Stripe `cancel_at` and the stamped `cancelledAt`.
   */
  resumeSubscription: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(ctx, input.id);
    if (!hasDeliverableCycle(project.serviceType as ServiceType | null)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only recurring service and recurring product subscriptions can be resumed.',
      });
    }
    // Same access rule as cancelSubscription: the fulfilling agency OR the owning brand.
    if (project.agencyId) {
      try {
        await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      } catch (err) {
        if (project.brandId) await assertBrandAccess(ctx, project.brandId);
        else throw err;
      }
    } else if (project.brandId) {
      await assertBrandAccess(ctx, project.brandId);
    }
    if (!project.cancelledAt || project.cancelledAt.getTime() <= Date.now()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This subscription has already ended and can no longer be resumed.',
      });
    }
    await unscheduleProjectCancellation(project, ctx.db);
    const [u] = await ctx.db
      .update(projects)
      .set({ cancelledAt: null, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning();
    await enqueueEmail('subscription-resumed', { projectId: project.id });
    return u;
  }),

  /**
   * Remove one recurring project from a multi-project subscription
   * (deleteSubscriptionItemTask): soft-delete + reverse its pending contractor
   * payout, and cancel the Stripe subscription only if it was the last active
   * recurring project on the purchase. (The single-line subscription model can't
   * prorate a partial removal — full cancel when nothing recurring remains.)
   */
  removeRecurringItem: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(ctx, input.id);
    if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
    await reverseContractorFee(ctx, project);
    await ctx.db.update(projects).set({ deletedAt: new Date(), cancelledAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, project.id));
    // Remove just this project's subscription item; cancel the whole
    // subscription only when it was the last active recurring project.
    await cancelProjectSubscription(project, ctx.db);
    return { id: project.id };
  }),

  /**
   * Ask the brand owner to confirm a cancellation/refund via an emailed link
   * (brandConfirmSoftDeleteProject). Stamps a token + the proposed refund and
   * sends the email; the project is only deleted when the brand clicks confirm
   * (the /confirm/soft-delete HTTP endpoint).
   */
  requestSoftDeleteConfirmation: protectedProcedure
    .input(z.object({ id: z.string().uuid(), proposedRefundAmount: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx, input.id);
      if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
      // A completed project is terminal — it can no longer be deleted.
      if (project.status === 'completed') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Completed projects cannot be deleted.' });
      assertWeeklyDeletable(project);
      const purchase = project.purchaseId
        ? (await ctx.db.select().from(purchases).where(eq(purchases.id, project.purchaseId)).limit(1))[0]
        : null;
      // Default the proposed refund to the full current-cycle pool (§5.1); the agency
      // may override with a smaller amount.
      const pool = await currentCycleRefundPool(project, purchase ?? null, ctx.db);
      const proposed = input.proposedRefundAmount ?? (pool > 0 ? pool.toFixed(2) : null);
      // The confirm link expires at the next charge so the brand is never charged the
      // cycle they're cancelling (§4.2); one-offs fall back to a 10-day window.
      const nextCharge = await nextChargeDate(project, purchase ?? null, ctx.db);
      const expiry = nextCharge ?? new Date(Date.now() + 10 * 86_400_000);
      const token = crypto.randomUUID();
      await ctx.db
        .update(projects)
        .set({ softDeleteToken: token, softDeleteExpiry: expiry, proposedRefundAmount: proposed, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      await enqueueEmail('soft-delete-confirm', { projectId: project.id, origin: ctx.clientOrigin });
      return { ok: true, proposedRefundAmount: proposed, expiresAt: expiry.toISOString() };
    }),

  /* ---- Internal projects (agency-paid) ---- */

  /**
   * Create an internal (agency-paid) project — work the agency runs itself and
   * pays a contractor for. Ports createInternalPurchase
   * (functions/src/modules/billing/create_internal_purchase.ts): an internal
   * purchase (written as PAID immediately — payment is deferred to
   * Allocate → Production) + a project seeded at `allocate` so the owner can
   * assign + pay. Pricing is derived PURELY from contractor budgets. (C1)
   *
   * The service is resolved either from an existing `serviceId` or from a
   * `customService` payload (mirroring submit_complimentary.dart). `title` /
   * `description` / `serviceName` remain accepted for the legacy bare-create
   * path used by older callers.
   */
  createInternalProject: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        // Legacy bare-create fields (kept so existing callers keep working).
        title: z.string().optional(),
        description: z.string().optional(),
        serviceName: z.string().optional(),
        // Brand involvement (Step1Complimentary).
        brandId: z.string().uuid().optional(),
        brandName: z.string().optional(),
        viewableToBrand: z.boolean().optional(),
        // Service resolution — existing service OR a custom service payload.
        serviceId: z.string().uuid().optional(),
        customService: z
          .object({
            name: z.string().min(1),
            description: z.string().optional(),
            type: z.enum(SERVICE_TYPES),
            upfrontProjectConfig: z.any().optional(),
            recurringProjectConfig: z.any().optional(),
            deliverableFrequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
            repeatsEvery: z.number().int().positive().optional(),
          })
          .optional(),
        // Configured variant/options/add-ons (existing-service path).
        options: z.record(z.string(), z.string()).optional(),
        addons: z.array(z.any()).optional(),
        selectedVariantId: z.string().optional(),
        // Existing-service contractor-budget overrides: the New Project dialog
        // sends the service config merged with the agency's edited budget, which
        // we apply over the service's stored config below.
        upfrontProjectConfig: z.record(z.string(), z.any()).optional(),
        recurringProjectConfig: z.record(z.string(), z.any()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');

      // ── Resolve the service (existing or custom), mirroring the cloud fn ──
      let targetName = input.serviceName ?? input.title ?? 'Unknown Service';
      let targetDescription: string | undefined = input.description;
      let targetType: ServiceType = 'oneOffService';
      let upfrontConfig: Record<string, unknown> | undefined;
      let recurringConfig: Record<string, unknown> | undefined;
      let deliverableFrequency: string | undefined;
      let repeatsEvery = 1;

      if (input.serviceId) {
        const service = (await ctx.db.select().from(services).where(eq(services.id, input.serviceId)).limit(1))[0];
        if (!service) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service not found.' });
        targetName = service.name;
        targetDescription = input.description ?? service.description ?? undefined;
        targetType = (service.type as ServiceType) ?? 'oneOffService';
        upfrontConfig = (service.upfrontProjectConfig as Record<string, unknown> | null) ?? undefined;
        recurringConfig = (service.recurringProjectConfig as Record<string, unknown> | null) ?? undefined;
        // Apply per-project contractor-budget overrides from the New Project
        // dialog over the service's stored config.
        if (input.upfrontProjectConfig) upfrontConfig = { ...(upfrontConfig ?? {}), ...input.upfrontProjectConfig };
        if (input.recurringProjectConfig) recurringConfig = { ...(recurringConfig ?? {}), ...input.recurringProjectConfig };
        deliverableFrequency = service.deliverableFrequency ?? undefined;
        repeatsEvery = service.repeatsEvery ?? 1;
      } else if (input.customService) {
        const cs = input.customService;
        targetName = cs.name;
        targetDescription = cs.description;
        targetType = cs.type;
        upfrontConfig = (cs.upfrontProjectConfig as Record<string, unknown> | undefined) ?? undefined;
        recurringConfig = (cs.recurringProjectConfig as Record<string, unknown> | undefined) ?? undefined;
        deliverableFrequency = cs.deliverableFrequency;
        repeatsEvery = cs.repeatsEvery ?? 1;
      }

      // ── Pricing PURELY from contractor budgets (cloud fn parity) ──
      const upfrontBudget = Number(upfrontConfig?.contractorDefaultBudget ?? 0) || 0;
      const recurringBudget = Number(recurringConfig?.contractorDefaultBudget ?? 0) || 0;
      const isWeekly = isBillingCycleWeekly(targetType);

      // Branch-exclusive, mirroring computeLineAmount / proposalItemAmount: a
      // weekly item fills ONLY the recurring bucket (upfront budget = setup,
      // recurring budget = per-cycle weekly); a one-off fills ONLY the one-off
      // bucket. Never both — populating both at once produced the contradictory
      // amount blob (oneOffTotal>0 AND recurring.weeklyAfter>0).
      const pricing = isWeekly
        ? {
            recurring: { upfront: upfrontBudget, weeklyAfter: recurringBudget },
            oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 },
            oneOffTotal: 0,
          }
        : {
            recurring: { upfront: 0, weeklyAfter: 0 },
            oneOff: {
              upfront: upfrontBudget,
              weeklyAfter: recurringBudget > 0 ? recurringBudget : 0,
              numberOfWeeks: recurringBudget > 0 ? Number(upfrontConfig?.projectDurationDays ?? 1) : 0,
            },
            oneOffTotal: upfrontBudget,
          };

      // The contractor budget the agency will pay at Allocate → Production.
      // This project is always the FIRST cycle (cycleCount: 1), so it uses the
      // upfront budget; recurring is only a fallback for services that define no
      // upfront budget. Subsequent cycles apply recurring in resetRecurringProject.
      // (Mirrors resolveContractorBudget in fulfillment-core.ts.)
      const contractorBudget = upfrontBudget || recurringBudget;

      // Brand visibility: only viewable when a brand is involved AND opted in.
      const viewableToBrand = input.brandId ? (input.viewableToBrand ?? false) : false;

      // ── Write the internal purchase as PAID immediately (payment deferred) ──
      const [purchase] = await ctx.db
        .insert(purchases)
        .values({
          brandId: input.brandId ?? null,
          userId: ctx.user.id,
          type: 'marketplace',
          status: 'completed',
          isInternal: true,
          viewableToBrand,
          amount: pricing as unknown as Record<string, unknown>,
          paidAt: new Date(),
          completedAt: new Date(),
        })
        .returning();

      // ── Create the project seeded at `brief` (cloud-fn parity:
      // on_internal_purchase_written seeds `Brief`). Internal projects start in
      // Brief like every other project — the agency completes the brief, moves
      // the card to Allocate, assigns + budgets a contractor, then pays
      // (payInternalProject), and the Stripe webhook advances Allocate →
      // Production. Internal work must never skip the Brief stage. ──
      const [project] = await ctx.db
        .insert(projects)
        .values({
          purchaseId: purchase.id,
          agencyId: input.agencyId,
          brandId: input.brandId ?? null,
          // Free-text client name for complimentary/internal projects with no
          // registered brand (Step1Complimentary). Surfaced on the Kanban card.
          brandName: input.brandName ?? null,
          serviceId: input.serviceId ?? null,
          serviceName: targetName,
          serviceType: targetType,
          title: input.title ?? targetName,
          description: targetDescription,
          status: 'brief',
          isInternal: true,
          viewableToBrand,
          amount: pricing as unknown as Record<string, unknown>,
          contractorBudget: contractorBudget > 0 ? contractorBudget.toFixed(2) : undefined,
          upfrontProjectConfig: upfrontConfig ?? null,
          recurringProjectConfig: recurringConfig ?? null,
          deliverableFrequency: (deliverableFrequency as typeof projects.$inferInsert.deliverableFrequency) ?? null,
          repeatsEvery,
          // Recurring internal projects re-cycle on completion (no Stripe sub —
          // the agency re-pays the contractor each cycle at allocate), so seed
          // the cycle schedule the same way fulfillment does.
          cycleCount: 1,
          nextCycleAt: projectNextCycleAt({
            type: targetType,
            deliverableFrequency: (deliverableFrequency as DeliverableFrequency | undefined) ?? null,
            repeatsEvery,
            from: new Date(),
          }),
          selectedVariantId: input.selectedVariantId ?? null,
          selectedOptions: input.options ?? undefined,
          selectedAddons: (input.addons as unknown[]) ?? undefined,
        })
        .returning();
      await notifyProjectStatus(ctx, project.id);
      return project;
    }),

  /**
   * Pay an internal project's contractor fee via Stripe (payInternalProject).
   * Returns a Checkout URL; the webhook then advances allocate→production and
   * books the contractor payout. In dev (no Stripe) it advances directly.
   */
  payInternalProject: protectedProcedure.input(z.object({ id: z.string().uuid(), successUrl: z.string().url().optional(), cancelUrl: z.string().url().optional() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(ctx, input.id);
    if (project.agencyId) await assertAgencyAccess(ctx, project.agencyId, 'agencyProjects');
    if (!project.isInternal) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an internal project' });
    const budget = Number(project.contractorBudget ?? 0);
    if (!project.productionAssigneeId || budget <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Assign a contractor and budget first' });
    if (!stripe) {
      // Dev fallback: advance straight to production (books the contractor payout).
      await advanceInternalProjectToProduction(project.id, ctx.db);
      return { url: null as string | null };
    }
    // Stripe surcharge is borne by the AGENCY for internal purchases (the
    // contractor receives the full budget): gross up so the net captured equals
    // the budget — (budget + $0.30) / (1 − 1.75%). Shown as a separate fee line
    // (pay_internal_project.ts parity). Normal brand purchases do NOT gross up.
    const STRIPE_PCT = 0.0175;
    const STRIPE_FIXED = 0.3;
    // CHARGE → round the surcharge UP so the captured net still covers the budget.
    const fee = roundChargeUp((budget + STRIPE_FIXED) / (1 - STRIPE_PCT) - budget);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'aud', product_data: { name: `Internal project: ${project.serviceName ?? project.title ?? 'work'}` }, unit_amount: chargeCents(budget) }, quantity: 1 },
        ...(fee > 0
          ? [{ price_data: { currency: 'aud' as const, product_data: { name: 'Processing fee' }, unit_amount: chargeCents(fee) }, quantity: 1 }]
          : []),
      ],
      success_url: input.successUrl ?? `${ctx.clientOrigin}/project/${project.id}?internal_paid=true`,
      cancel_url: input.cancelUrl ?? `${ctx.clientOrigin}/project/${project.id}`,
      metadata: withEnvTag({ internalProjectId: project.id }),
    });
    return { url: session.url };
  }),
});

/**
 * Advance a paid internal project allocate→production and book the contractor
 * payout. Called from the Stripe webhook on internal-project checkout completion.
 */
export async function advanceInternalProjectToProduction(projectId: string, db = defaultDb): Promise<void> {
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  if (!project || project.status === 'production') return;
  const [updated] = await db.update(projects).set({ status: 'production', updatedAt: new Date() }).where(eq(projects.id, projectId)).returning();
  await applyContractorFee({ db }, updated as ProjectRow);
}

type PurchaseRow = typeof purchases.$inferSelect;

/**
 * Guard: when recurring projects are non-refundable (the
 * `IS_RECURRING_PROJECTS_REFUNDABLE` flag is off), a weekly-billed project cannot
 * be DELETED — deletion issues a refund we can no longer give. Server-side
 * enforcement of the front-end disable in project-detail.tsx (the button is UX
 * only; these mutations are directly callable). No-refund subscription
 * *cancellation* (`cancelSubscription`) is intentionally unaffected.
 */
function assertWeeklyDeletable(project: ProjectRow): void {
  if (
    !IS_RECURRING_PROJECTS_REFUNDABLE &&
    isBillingCycleWeekly(project.serviceType as ServiceType | null)
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'Weekly-billed projects are non-refundable and cannot be deleted. Cancel the subscription instead.',
    });
  }
}

/**
 * §5.1 — the refundable pool for a delete, in dollars. For a recurring project it
 * is the payments collected WITHIN the current (undelivered) deliverable cycle
 * (`refundableCyclePoolCount` × the weekly fee); earlier cycles are earned. For a
 * one-off it is the full up-front the brand has paid (deposit + any instalments).
 */
export async function currentCycleRefundPool(
  project: ProjectRow,
  purchase: PurchaseRow | null,
  db = defaultDb,
): Promise<number> {
  const amount = (project.amount ?? {}) as {
    recurring?: { weeklyAfter?: number };
    oneOff?: { upfront?: number; weeklyAfter?: number };
  };
  if (hasDeliverableCycle(project.serviceType as ServiceType | null)) {
    const weekly = Number(amount.recurring?.weeklyAfter ?? 0);
    if (weekly <= 0 || !purchase) return 0;
    const item = project.purchaseItemId
      ? (await db
          .select({ startDelayDays: purchaseItems.startDelayDays })
          .from(purchaseItems)
          .where(eq(purchaseItems.id, project.purchaseItemId))
          .limit(1))[0]
      : null;
    const count = refundableCyclePoolCount({
      type: project.serviceType as ServiceType | null,
      deliverableFrequency: project.deliverableFrequency as DeliverableFrequency | null,
      repeatsEvery: project.repeatsEvery,
      anchor: cancellationAnchor(project.createdAt, item?.startDelayDays ?? 0),
      cycleCount: project.cycleCount ?? 1,
      paymentCount: purchase.paymentCount ?? 0,
    });
    return roundChargeUp(count * weekly);
  }
  // One-off: full up-front total (deposit + instalments collected so far).
  const upfront = Number(amount.oneOff?.upfront ?? 0);
  const instal = Number(amount.oneOff?.weeklyAfter ?? 0) * Math.max(0, (purchase?.paymentCount ?? 1) - 1);
  return roundChargeUp(upfront + instal);
}

/**
 * The next weekly charge date for a recurring project (spec §4.2: the brand
 * confirm-link expires here). `null` for a one-off (no upcoming recurring charge).
 */
export async function nextChargeDate(
  project: ProjectRow,
  purchase: PurchaseRow | null,
  db = defaultDb,
): Promise<Date | null> {
  if (!hasDeliverableCycle(project.serviceType as ServiceType | null) || !purchase) return null;
  const item = project.purchaseItemId
    ? (await db
        .select({ startDelayDays: purchaseItems.startDelayDays })
        .from(purchaseItems)
        .where(eq(purchaseItems.id, project.purchaseItemId))
        .limit(1))[0]
    : null;
  const anchor = cancellationAnchor(project.createdAt, item?.startDelayDays ?? 0);
  // Payment k lands at anchor + (k-1)·7d; the next one is at + paymentCount·7d.
  const next = new Date(anchor.getTime() + (purchase.paymentCount ?? 0) * 7 * 86_400_000);
  const soon = new Date(Date.now() + 86_400_000);
  return next.getTime() > soon.getTime() ? next : soon;
}

/**
 * §0.6 — refund `amount` (dollars) which may span MULTIPLE weekly Stripe invoices
 * for a recurring purchase. Best-effort: a one-off refunds its stored intent; a
 * recurring purchase walks its paid invoices newest-first and refunds each
 * `payment_intent` until the amount is covered. ⚠️ Needs live-Stripe validation.
 */
export async function refundProjectPool(
  purchase: PurchaseRow | null,
  amount: number,
  _db = defaultDb,
): Promise<void> {
  if (!stripe || !purchase || amount <= 0) return;
  let remaining = payoutCents(amount);
  try {
    if (purchase.stripeSubscriptionId) {
      const invs = await stripe.invoices.list({
        subscription: purchase.stripeSubscriptionId,
        status: 'paid',
        limit: 24,
      });
      for (const inv of invs.data) {
        if (remaining <= 0) break;
        const pi = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id;
        if (!pi || !inv.amount_paid) continue;
        const cents = Math.min(remaining, inv.amount_paid);
        await stripe.refunds.create({ payment_intent: pi, amount: cents });
        remaining -= cents;
      }
      if (remaining > 0 && purchase.stripePaymentIntentId) {
        await stripe.refunds.create({ payment_intent: purchase.stripePaymentIntentId, amount: remaining });
      }
    } else if (purchase.stripePaymentIntentId) {
      await stripe.refunds.create({ payment_intent: purchase.stripePaymentIntentId, amount: remaining });
    }
  } catch (err) {
    console.error('[projects] pool refund failed', (err as Error).message);
  }
}

/**
 * §5.3 — void a project's still-pending payouts when its cycle is deleted: drop
 * the project's breakdown lines from every `upcoming`/`pending` payout, then fail
 * a payout that's left empty or reduce its amount to the remaining lines. Invoice
 * status derives from the payout, so the invoices follow automatically. (Unlike
 * `reverseContractorFee`, nothing is re-credited to the agency — the cycle is
 * being refunded, so no party is paid for it.) Best-effort.
 */
export async function voidProjectPendingPayouts(
  ctx: { db: typeof defaultDb },
  project: ProjectRow,
): Promise<void> {
  try {
    const breaks = await ctx.db
      .select({ payoutId: payoutBreakdowns.payoutId })
      .from(payoutBreakdowns)
      .where(eq(payoutBreakdowns.projectId, project.id));
    const payoutIds = [...new Set(breaks.map((b) => b.payoutId))];
    for (const payoutId of payoutIds) {
      const payout = (await ctx.db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1))[0];
      if (!payout || !['upcoming', 'pending'].includes(payout.status)) continue; // already paid/processing
      await ctx.db
        .delete(payoutBreakdowns)
        .where(and(eq(payoutBreakdowns.payoutId, payoutId), eq(payoutBreakdowns.projectId, project.id)));
      const remaining = await ctx.db
        .select({ amount: payoutBreakdowns.amount })
        .from(payoutBreakdowns)
        .where(eq(payoutBreakdowns.payoutId, payoutId));
      if (remaining.length === 0) {
        await ctx.db.update(payouts).set({ status: 'failed', updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      } else {
        const newAmount = remaining.reduce((s, r) => s + Number(r.amount), 0);
        await ctx.db.update(payouts).set({ amount: newAmount.toFixed(2), updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      }
    }
  } catch (err) {
    console.error('[projects] void pending payouts failed for', project.id, (err as Error).message);
  }
}

/**
 * Finalize a brand-confirmed soft-delete (the /confirm/soft-delete link target):
 * validate the token + expiry, cancel this project's billing, void its pending
 * payouts/invoices, refund the proposed pool (across multiple Stripe payments),
 * and soft-delete. Returns false on an invalid/expired token. Idempotent.
 */
export async function finalizeSoftDelete(projectId: string, token: string, db = defaultDb): Promise<boolean> {
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  if (!project || !project.softDeleteToken || project.softDeleteToken !== token) return false;
  if (project.softDeleteExpiry && project.softDeleteExpiry < new Date()) return false;
  if (project.deletedAt) return true; // already done (idempotent)
  // The project completed after the delete link was issued — it's now terminal.
  if (project.status === 'completed') return false;
  // Weekly-billed projects are non-refundable when the flag is off — refuse to
  // finalize a delete from a link issued before the flag was flipped.
  if (!IS_RECURRING_PROJECTS_REFUNDABLE && isBillingCycleWeekly(project.serviceType as ServiceType | null)) return false;

  const purchase = project.purchaseId
    ? (await db.select().from(purchases).where(eq(purchases.id, project.purchaseId)).limit(1))[0]
    : null;
  // Stop this project's recurring billing now (the brand has confirmed) — removes
  // just its subscription item, sparing siblings / future phases.
  await cancelProjectSubscription(project as ProjectRow, db);
  // Reverse every still-pending payout for the deleted cycle (invoices follow).
  await voidProjectPendingPayouts({ db }, project as ProjectRow);
  // Refund the proposed pool — may span several weekly Stripe payments (§0.6).
  const refund = Number(project.proposedRefundAmount ?? 0);
  if (refund > 0) await refundProjectPool(purchase, refund, db);
  await db.update(projects).set({ deletedAt: new Date(), cancelledAt: new Date(), softDeleteToken: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
  return true;
}

/**
 * Finalize a brand-confirmed completion (the /confirm/complete link target):
 * validate the token + expiry, then run the same completion the brand triggers
 * via clientApprovalDecision(approved) — mark completed, approve deliverables,
 * schedule the next cycle for recurring services, copy files to the locker.
 * Returns false on an invalid/expired token. Idempotent once completed.
 */
export async function finalizeCompletion(projectId: string, token: string, db = defaultDb): Promise<boolean> {
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  if (!project || !project.completionToken || project.completionToken !== token) return false;
  if (project.completionExpiry && project.completionExpiry < new Date()) return false;
  // Clear the token first so a double-click can't run completion twice.
  await db.update(projects).set({ completionToken: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
  if (project.status === 'completed') return true; // already done (idempotent)
  // completeProject only touches ctx.db; the emailed token is the authorization,
  // so the brand owner is recorded as the reviewer.
  const reviewedBy = project.brandId
    ? (await db.select({ ownerId: brands.ownerId }).from(brands).where(eq(brands.id, project.brandId)).limit(1))[0]?.ownerId ?? 'brand'
    : 'brand';
  await completeProject({ db } as unknown as Context, project as ProjectRow, reviewedBy);
  return true;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Side-effect implementations
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Fire task auto-generation for a project status change (reads the project's
 * fresh status). Best-effort; never blocks the mutation. Mirrors the Flutter
 * on_project_status_change cloud function.
 */
async function notifyProjectStatus(ctx: Context, projectId: string): Promise<void> {
  try {
    const pr = (await ctx.db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
    if (!pr) return;
    const brand = pr.brandId ? (await ctx.db.select().from(brands).where(eq(brands.id, pr.brandId)).limit(1))[0] : null;
    const agency = pr.agencyId ? (await ctx.db.select().from(agencies).where(eq(agencies.id, pr.agencyId)).limit(1))[0] : null;
    await onProjectStatusChanged(
      {
        projectId,
        status: pr.status,
        assigneeType: pr.assigneeType,
        productionAssigneeId: pr.productionAssigneeId,
        agencyId: pr.agencyId,
        agencyName: agency?.businessName ?? null,
        brandOwnerId: brand?.ownerId ?? null,
        brandName: brand?.businessName ?? pr.brandName ?? null,
        projectName: pr.taskTitle ?? pr.title ?? pr.serviceName ?? null,
        approvalDesigneeId: agency?.approvalDesigneeId ?? null,
        organizationName: agency?.businessName ?? null,
      },
      ctx.db,
    );
  } catch {
    /* task generation is best-effort */
  }
}

/**
 * Port of onContractorFeeUpdated: when a project moves allocate→production with a
 * contractor assignee and a budget, create a `pending` contractor payout + an
 * invoice (contractor → agency) and deduct the fee from the agency owner's payout
 * for the same purchase. Idempotent: skips if a contractor payout already exists
 * for this project. Best-effort — never blocks the allocation.
 */
/**
 * The agency-owner payout(s) for ONE project. Payouts are split per project (see
 * fulfillment.computePayoutSplit), and a payout has no projectId column — the link
 * lives on its breakdowns — so the project's own agency payout is the one carrying
 * a breakdown tagged with this `projectId`. The contractor-fee deduction/refund
 * uses this so a fee only ever touches the payout of the project the contractor was
 * allocated to, never a sibling project's payout in the same purchase.
 */
export async function agencyPayoutsForProject(
  db: typeof defaultDb,
  project: ProjectRow,
): Promise<(typeof payouts.$inferSelect)[]> {
  if (!project.purchaseId || !project.agencyId) return [];
  const rows = await db
    .select({ payout: payouts })
    .from(payouts)
    .innerJoin(payoutBreakdowns, eq(payoutBreakdowns.payoutId, payouts.id))
    .where(
      and(
        eq(payouts.purchaseId, project.purchaseId),
        eq(payouts.beneficiaryAgencyId, project.agencyId),
        eq(payoutBreakdowns.projectId, project.id),
      ),
    );
  const byId = new Map<string, typeof payouts.$inferSelect>();
  for (const r of rows) if (!byId.has(r.payout.id)) byId.set(r.payout.id, r.payout);
  return [...byId.values()];
}

export async function applyContractorFee(ctx: { db: typeof defaultDb }, project: ProjectRow): Promise<void> {
  const budget = Number(project.contractorBudget ?? 0);
  if (!project.productionAssigneeId || !Number.isFinite(budget) || budget <= 0) return;
  try {
    // Stamp the contractor fee with a weekly-payment number that lands in the
    // CURRENT deliverable cycle, so dispatch's completion gate (eligibleBreakdowns
    // → cycleOfPayment → isDeliverableCycleComplete) releases this fee only when
    // THIS cycle completes — not as soon as an earlier cycle did. Anchored on
    // `createdAt` to match the anchor dispatch.eligibleBreakdowns uses. Non-cycling
    // types carry no week (they gate on `project.status === 'completed'`).
    const recurs = hasDeliverableCycle(project.serviceType as ServiceType | null);
    const cycleSpec = {
      type: project.serviceType as ServiceType | null,
      deliverableFrequency: project.deliverableFrequency as DeliverableFrequency | null,
      repeatsEvery: project.repeatsEvery,
      anchor: project.createdAt ?? new Date(),
    };
    const feeWeek = recurs
      ? weeklyPaymentsBefore(cycleSpec.anchor, cycleStart(project.cycleCount ?? 1, cycleSpec)) + 1
      : null;

    // Idempotency: don't create a second contractor payout for the SAME project
    // and SAME cycle. Scoped per-cycle (by `feeWeek`) so a recurring project's
    // next cycle — re-allocated after it re-cycles — books its own contractor
    // payout instead of being silently blocked by an earlier cycle's row.
    const dupe = await ctx.db
      .select({ id: payoutBreakdowns.id })
      .from(payoutBreakdowns)
      .where(
        and(
          eq(payoutBreakdowns.projectId, project.id),
          eq(payoutBreakdowns.commissionType, 'contractorCommission'),
          feeWeek == null
            ? isNull(payoutBreakdowns.week)
            : eq(payoutBreakdowns.week, feeWeek),
        ),
      )
      .limit(1);
    if (dupe.length) return;

    const brand = project.brandId ? (await ctx.db.select().from(brands).where(eq(brands.id, project.brandId)).limit(1))[0] : null;
    // PAYOUT → floor the contractor budget to whole cents; the SAME floored figure
    // is deducted from the agency owner's payout below, so the ledger stays balanced.
    const payoutBudget = roundPayoutDown(budget);
    const amount = payoutBudget.toFixed(2);
    // Contractor work-based payout settles with the priority window (+14d Brisbane Friday),
    // matching the agency-owner payout it is deducted from. Ports onContractorFeeUpdated.
    // Internal projects carry no client revenue and no claw-back risk (the agency
    // funds the fee up front at allocate), so their payout is due IMMEDIATELY — its
    // toPayAt is always the creation time, never parked for the +14d window. It's
    // still completion-gated in dispatch, so it never pays before the work is done.
    const toPayAt = project.isInternal ? new Date() : payoutFriday('priority');

    // Deduct the contractor fee from THIS project's agency-owner payout (payouts
    // are split per project, so we never touch a sibling project's payout).
    if (!project.isInternal && project.purchaseId && project.agencyId) {
      const ownerPayouts = await agencyPayoutsForProject(ctx.db, project);
      for (const op of ownerPayouts) {
        const remaining = roundPayoutDown(Number(op.amount) - payoutBudget);
        if (remaining < 0) {
          console.error('[contractor-fee] budget exceeds owner share', { payoutId: op.id, ownerAmount: op.amount, budget });
          break;
        }
        if (remaining === 0) {
          // The contractor fee consumes the agency owner's entire net for this
          // purchase. Never leave a $0 owner payout (a meaningless payable) — delete
          // it outright: its breakdowns cascade and any linked invoice's payoutId is
          // set null (see schema FKs). reverseContractorFee recreates the owner
          // payout if the project is later cancelled and the fee is refunded.
          await ctx.db.delete(payouts).where(eq(payouts.id, op.id));
          break; // one owner payout per purchase+agency
        }
        await ctx.db.insert(payoutBreakdowns).values({
          payoutId: op.id,
          purchaseId: project.purchaseId,
          projectId: project.id,
          brandId: project.brandId,
          description: 'Deducting contractor fee',
          commissionType: 'agencyNet',
          role: 'owner',
          amount: (-payoutBudget).toFixed(2),
        });
        await ctx.db.update(payouts).set({ amount: remaining.toFixed(2), updatedAt: new Date() }).where(eq(payouts.id, op.id));
        break; // one owner payout per purchase+agency
      }
    }

    // Create the contractor payout + its breakdown.
    const payout = await insertPayout(ctx.db, {
      amount,
      currency: 'AUD',
      beneficiaryId: project.productionAssigneeId,
      agencyId: project.agencyId,
      purchaseId: project.purchaseId,
      status: 'pending',
      as: 'contractor',
      sourceBrandName: brand?.businessName ?? null,
      toPayAt,
    });
    if (!payout) return; // non-positive budget already filtered above; guard for safety
    await ctx.db.insert(payoutBreakdowns).values({
      payoutId: payout.id,
      projectId: project.id,
      purchaseId: project.purchaseId,
      brandId: project.brandId,
      description: 'contractorCommission',
      commissionType: 'contractorCommission',
      role: 'contractor',
      sourceServiceName: project.serviceName,
      amount,
      gst: '0',
      week: feeWeek,
      metadata: { serviceName: project.serviceName, serviceType: project.serviceType, brandName: brand?.businessName ?? null },
    });

    // Create the contractor → agency invoice for this fee.
    const [invoice] = await ctx.db
      .insert(invoices)
      .values({
        purchaseId: project.purchaseId,
        payoutId: payout.id,
        cycle: project.cycleCount ?? 0,
        commissionType: 'contractorCommission',
        ...partyColumns({ userId: project.productionAssigneeId }, 'from'),
        ...partyColumns({ agencyId: project.agencyId }, 'to'),
        total: amount,
      })
      .returning();
    await ctx.db.insert(invoiceItems).values({
      invoiceId: invoice.id,
      name: project.serviceName ?? 'Contractor work',
      qty: 1,
      totalPrice: amount,
      selectedOptions: (project.selectedOptions as Record<string, string>) ?? {},
      selectedAddons: (project.selectedAddons as unknown[]) ?? [],
    });
  } catch (err) {
    console.error('[contractor-fee] failed for project', project.id, (err as Error).message);
  }
}

/**
 * The agency-owner's available payout for a project — the real ceiling on the
 * contractor budget, since `applyContractorFee` deducts the budget from the
 * owner's share and refuses to go negative. This is the web-stack analogue of
 * the Flutter allocate dialog's "max budget %" (agencyCommission − 1 − Σ other
 * commissions, applied to the cycle price). Returns null when there is no owner
 * payout yet (internal projects / pre-fulfilment), where the UI shouldn't cap.
 */
export async function contractorBudgetCeiling(ctx: { db: typeof defaultDb }, project: ProjectRow): Promise<number | null> {
  if (!project.purchaseId || !project.agencyId) return null;
  const rows = await agencyPayoutsForProject(ctx.db, project);
  if (!rows.length) return null;
  return rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

/**
 * Reverse a project's contractor payout when the project is cancelled/soft-deleted:
 * mark the not-yet-paid contractor payout `failed` and re-credit the deducted fee
 * back to the agency owner's payout. Idempotent (only acts on a still-pending
 * contractor payout). Best-effort.
 */
export async function reverseContractorFee(ctx: { db: typeof defaultDb }, project: ProjectRow): Promise<void> {
  try {
    const crBreak = (
      await ctx.db
        .select({ payoutId: payoutBreakdowns.payoutId, amount: payoutBreakdowns.amount })
        .from(payoutBreakdowns)
        .where(and(eq(payoutBreakdowns.projectId, project.id), eq(payoutBreakdowns.commissionType, 'contractorCommission')))
        .limit(1)
    )[0];
    if (!crBreak) return;
    const payout = (await ctx.db.select().from(payouts).where(eq(payouts.id, crBreak.payoutId)).limit(1))[0];
    if (!payout || !['upcoming', 'pending'].includes(payout.status)) return; // already paid/processing/cancelled

    await ctx.db.update(payouts).set({ status: 'failed', updatedAt: new Date() }).where(eq(payouts.id, payout.id));

    // Re-credit the agency owner's payout for the same purchase.
    const budget = Number(crBreak.amount);
    if (!project.isInternal && project.purchaseId && project.agencyId && budget > 0) {
      const ownerPayouts = await agencyPayoutsForProject(ctx.db, project);
      const op = ownerPayouts.find((p) => ['upcoming', 'pending'].includes(p.status));
      if (op) {
        await ctx.db.insert(payoutBreakdowns).values({
          payoutId: op.id,
          purchaseId: project.purchaseId,
          projectId: project.id,
          brandId: project.brandId,
          description: 'Reversing contractor fee (project cancelled)',
          commissionType: 'agencyNet',
          role: 'owner',
          amount: budget.toFixed(2),
        });
        await ctx.db
          .update(payouts)
          .set({ amount: (Number(op.amount) + budget).toFixed(2), updatedAt: new Date() })
          .where(eq(payouts.id, op.id));
      } else {
        // No agency payout to re-credit — it was deleted because the contractor fee
        // had consumed the agency's entire net (see applyContractorFee). Recreate it
        // so the refunded budget is paid back to the agency's bank account.
        const agency = (await ctx.db.select({ ownerId: agencies.ownerId }).from(agencies).where(eq(agencies.id, project.agencyId)).limit(1))[0];
        if (agency) {
          const brand = project.brandId ? (await ctx.db.select({ businessName: brands.businessName }).from(brands).where(eq(brands.id, project.brandId)).limit(1))[0] : null;
          const recreated = await insertPayout(ctx.db, {
            amount: budget.toFixed(2),
            currency: 'AUD',
            beneficiaryAgencyId: project.agencyId,
            agencyId: project.agencyId,
            purchaseId: project.purchaseId,
            status: 'upcoming',
            as: 'agency',
            sourceBrandName: brand?.businessName ?? null,
            toPayAt: payoutFriday('priority'),
          });
          if (recreated) {
            await ctx.db.insert(payoutBreakdowns).values({
              payoutId: recreated.id,
              purchaseId: project.purchaseId,
              projectId: project.id,
              brandId: project.brandId,
              description: 'Reversing contractor fee (project cancelled)',
              commissionType: 'agencyNet',
              role: 'owner',
              amount: budget.toFixed(2),
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[contractor-fee] reversal failed for project', project.id, (err as Error).message);
  }
}

/** Reject during internal approval: status→revision, revisionCount++, record revision. */
async function rejectToRevision(ctx: Context, project: ProjectRow, side: 'agency' | 'brand', reason?: string, attachmentUrls?: string[]) {
  await ctx.db.insert(projectRevisions).values({
    projectId: project.id,
    content: reason ?? '',
    attachmentUrls: attachmentUrls ?? [],
    authorId: ctx.user!.id,
    authorName: authorName(ctx.user!),
    authorRole: side,
    source: side,
    cycle: currentCycleNumber(project),
  });
  const [updated] = await ctx.db
    .update(projects)
    .set({
      status: 'revision',
      revisionCount: (project.revisionCount ?? 0) + 1,
      revisionNote: reason ?? null,
      revisionComments: reason ? [...((project.revisionComments as string[]) ?? []), reason] : project.revisionComments,
      revisionAttachmentUrl: attachmentUrls && attachmentUrls.length ? attachmentUrls[0] : null,
      revisionAttachmentUrls: attachmentUrls ?? [],
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id))
    .returning();
  await notifyProjectStatus(ctx, project.id);
  return updated;
}

/** Client rejection: status→internalApproval, clientRevisionCount++, record brand revision. */
async function clientReject(ctx: Context, project: ProjectRow, reason?: string, attachmentUrls?: string[]) {
  await ctx.db.insert(projectRevisions).values({
    projectId: project.id,
    content: reason ?? '',
    attachmentUrls: attachmentUrls ?? [],
    authorId: ctx.user!.id,
    authorName: authorName(ctx.user!),
    authorRole: 'brand',
    source: 'brand',
    cycle: currentCycleNumber(project),
  });
  const [updated] = await ctx.db
    .update(projects)
    .set({
      status: 'internalApproval',
      clientRevisionCount: (project.clientRevisionCount ?? 0) + 1,
      revisionNote: reason ?? null,
      revisionComments: reason ? [...((project.revisionComments as string[]) ?? []), reason] : project.revisionComments,
      revisionAttachmentUrl: attachmentUrls && attachmentUrls.length ? attachmentUrls[0] : null,
      revisionAttachmentUrls: attachmentUrls ?? [],
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id))
    .returning();
  await notifyProjectStatus(ctx, project.id);
  return updated;
}

/**
 * Complete a project. Recurring services schedule the next cycle and clear the
 * production assignee; standard projects auto-approve all deliverables. In both
 * cases approved deliverables are copied to the brand document locker (stub).
 */
/**
 * Guard: deliverables can't be edited or deleted once their project is
 * `completed` (their files are already in the brand document locker). Adding
 * brand-new deliverables to a completed project is still allowed.
 */
async function assertDeliverableMutable(ctx: Context, deliverableId: string): Promise<void> {
  const row = (
    await ctx.db
      .select({ status: projects.status })
      .from(projectDeliverables)
      .innerJoin(projects, eq(projects.id, projectDeliverables.projectId))
      .where(eq(projectDeliverables.id, deliverableId))
      .limit(1)
  )[0];
  if (row?.status === 'completed') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Deliverables are locked once the project is completed' });
  }
}

async function completeProject(
  ctx: Context,
  project: ProjectRow,
  reviewedBy: string,
  opts?: { approvalMethod?: string | null; approvedAt?: Date | null },
) {
  const now = new Date();
  // Manual completion (agency completes on behalf of the client): record the
  // out-of-band confirmation method and the back-dated approval time. Mirrors
  // manual_completion_dialog.dart → clientApprovalDecision(approvalMethod, approvedAt).
  const approvedAt = opts?.approvedAt ?? now;
  const approvalMethod = opts?.approvalMethod ?? null;

  // Auto-approve all outstanding deliverables and move them to the agency partition.
  await ctx.db
    .update(projectDeliverables)
    .set({ status: 'approved', source: 'agency', reviewedBy, reviewedAt: now })
    .where(and(eq(projectDeliverables.projectId, project.id), inArray(projectDeliverables.status, ['pending', 'rejected'])));
  // The production assignee is RETAINED on completion — including for recurring
  // projects (deliberate departure from the Flutter parity clearing). The next
  // cycle keeps the previous contractor/staff member so the allocate dialog can
  // pre-select them, and future-earnings predictions keep attributing the
  // contractor leg to them until someone else is allocated. Re-allocation (the
  // allocate dialog) still runs on every cycle's allocate→production move, which
  // is what books the new cycle's contractor payout + invoice.
  const [updated] = await ctx.db
    .update(projects)
    .set({
      status: 'completed',
      approvedBy: reviewedBy,
      approvedAt,
      approvalMethod,
      updatedAt: now,
    })
    .where(eq(projects.id, project.id))
    .returning();
  await copyDeliverablesToLocker(ctx, project);

  // Recurring projects re-cycle via the exact-time schedule engine: it either
  // re-opens now (next cycle already due) or arms a job at nextCycleAt — anchored
  // to the previous boundary (no drift) and bumping cycleCount exactly once on
  // reset. The cycle boundary (nextCycleAt) was frozen at creation/last reset.
  if (hasDeliverableCycle(updated.serviceType as ServiceType | null)) {
    await onRecurringProjectCompleted(updated, now, ctx.db);
  }

  // Internal projects have no client revenue to wait on — the agency already
  // funded the contractor fee at allocate. Release this project's payouts the
  // moment the work is marked complete (toPayAt pulled forward to now) instead
  // of parking them for the weekly payout cron. Runs AFTER the recurring
  // re-cycle so `cycleCount` has advanced and the just-finished cycle's fee is
  // eligible. Still completion-gated inside dispatch, so it never pays early.
  if (updated.isInternal) {
    await dispatchProjectPayoutsNow(updated.id, ctx.db);
  }

  // Dev notification: ping the dev inbox whenever a project carrying a real
  // (non-$0) amount completes. Only in staging/production (never local dev, per
  // the mailer's own dev/prod split); best-effort — enqueued, so it never blocks
  // or fails the completion. Skipped when EMAIL_DEV_REDIRECT isn't configured.
  if (!isDev && env.EMAIL_DEV_REDIRECT && projectHasAmount(updated.amount)) {
    await enqueueEmail('generic', {
      to: env.EMAIL_DEV_REDIRECT,
      subject: 'Dev notification: A project has been completed',
      body: `Project "${updated.title ?? updated.serviceName ?? updated.id}" has been completed.`,
    });
  }

  return updated;
}

/**
 * Whether a project's pricing blob carries any real money — used to skip the
 * dev-notification email for $0 (complimentary) projects. Sums only the money
 * leaves of the `amount` blob (mirrors the `base` calc in fulfillment-core);
 * `oneOff.numberOfWeeks` is a count, not currency, so it's deliberately excluded.
 */
function projectHasAmount(amount: ProjectRow['amount']): boolean {
  const a = (amount ?? {}) as {
    recurring?: { upfront?: number; weeklyAfter?: number };
    oneOff?: { upfront?: number; weeklyAfter?: number };
    oneOffTotal?: number;
  };
  const total =
    (a.recurring?.upfront ?? 0) +
    (a.recurring?.weeklyAfter ?? 0) +
    (a.oneOff?.upfront ?? 0) +
    (a.oneOff?.weeklyAfter ?? 0) +
    (a.oneOffTotal ?? 0);
  return total > 0;
}

/**
 * Locker provenance note for a deliverable. Mentions the cycle only for
 * recurring services (one-off services have no cycle to speak of).
 */
function deliverableNote(project: ProjectRow, ordinal: number): string {
  const service = project.serviceName ?? project.title ?? 'project';
  const recurring = hasDeliverableCycle(project.serviceType as ServiceType | null);
  const cycle = recurring ? ` · cycle ${(project.cycleCount ?? 0) + 1}` : '';
  return `Deliverable ${ordinal} from ${service}${cycle}`;
}

/**
 * Copy a completed project's approved (file-backed) deliverables into the brand
 * document locker as agency-sourced files, deduping per deliverable id. Mirrors
 * the Flutter client-approval file-locker copy. Best-effort.
 */
async function copyDeliverablesToLocker(ctx: Context, project: ProjectRow): Promise<void> {
  if (!project.brandId) return;
  try {
    const dels = await ctx.db
      .select()
      .from(projectDeliverables)
      .where(and(eq(projectDeliverables.projectId, project.id), eq(projectDeliverables.status, 'approved')));
    const fileDels = dels.filter((d) => (d.type === 'document' || d.type === 'image') && d.content);
    if (!fileDels.length) return;
    // Agency Documents, deduped per deliverable id (idempotent re-completion).
    await recordLockerFiles(
      ctx.db,
      fileDels.map((d, i) => ({
        brandId: project.brandId!,
        url: d.content!,
        name: d.fileName ?? d.description ?? 'Deliverable',
        agencyId: project.agencyId ?? null,
        projectId: project.id,
        projectTitle: project.title ?? project.serviceName ?? null,
        agencyWhoUploaded: project.agencyId ?? null,
        uploadedBy: d.uploadedBy ?? null,
        note: deliverableNote(project, i + 1),
        type: d.type === 'image' ? 'image' : 'document',
        category: 'deliverable',
        source: 'agency',
        sourceType: 'deliverable' as const,
        sourceId: d.id,
      })),
    );
  } catch (err) {
    console.error('[projects] copyDeliverablesToLocker failed', (err as Error).message);
  }
}
