/**
 * Recurring-cycle engine — replaces the hourly kanban sweep with EXACT-TIME
 * BullMQ delayed jobs. The lifecycle is event-driven:
 *
 *   • At creation, a `upcoming` (delayed-phase) project schedules a job at its
 *     phase start; a recurring project schedules nothing yet (it re-cycles only
 *     after it completes).
 *   • When a recurring project COMPLETES, {@link onRecurringProjectCompleted}
 *     either re-opens it immediately (next cycle already due + paid) or schedules
 *     a job at its `nextCycleAt`.
 *   • The job ({@link runProjectCycle}) re-checks eligibility (the Flutter
 *     payment gate) and either activates / re-cycles the project — anchoring the
 *     NEXT cycle to the PREVIOUS `nextCycleAt` so the schedule never drifts — or
 *     no-ops (the renewal webhook will drive it once payment lands).
 *
 * The webhook (advanceRecurringCycle) now owns payment state ONLY; this module
 * owns the project status/cycle transition — removing the old double-advance
 * race. A daily `reconcile` backstop catches any job lost to a Redis flush.
 */
import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { projects, projectCycles, purchases, brands, agencies } from '../../db/schema.js';
import { kanbanQueue } from '../../jobs/queues.js';
import { onProjectStatusChanged } from '../../routers/tasks.js';
import {
  isPaymentMadeOnTimeForCycle,
  projectNextCycleAt,
} from './fulfillment-core.js';
import { hasDeliverableCycle, type ServiceType } from '../../lib/service-type.js';
import type { DeliverableFrequency } from '../../lib/deliverable-frequency.js';
import { addSubscriptionItemForProject, cancelProjectSubscription, resumeProjectSubscription } from '../billing/subscription.js';

type Db = typeof defaultDb;
type ProjectRow = typeof projects.$inferSelect;

const cycleJobId = (projectId: string) => `cycle-${projectId}`;

/**
 * The contractor budget applied to EACH recurring deliverable cycle (cycles 2+):
 * a percentage of the weekly recurring fee, else the flat configured amount, else
 * null. This is what a contractor is paid per cycle once allocated — the
 * future-earnings predictor forecasts it for the current assignee. (The FIRST
 * cycle uses `upfrontProjectConfig` via fulfillment-core; this is the recurring
 * config only.)
 */
export function recurringContractorBudget(
  recurringProjectConfig: unknown,
  amount: unknown,
): number | null {
  const cfg = (recurringProjectConfig ?? {}) as {
    contractorDefaultBudget?: number | null;
    contractorDefaultBudgetInPercentage?: number | null;
  };
  if (cfg.contractorDefaultBudgetInPercentage) {
    const amt = (amount ?? {}) as { recurring?: { weeklyAfter?: number } };
    const weekly = amt.recurring?.weeklyAfter ?? 0;
    return (weekly * cfg.contractorDefaultBudgetInPercentage) / 100;
  }
  return cfg.contractorDefaultBudget ?? null;
}

/**
 * Schedule (or reschedule) the exact-time cycle job for a project. Removes any
 * existing job for the project first so the latest `runAt` always wins. A
 * past/now `runAt` runs on the next tick (delay 0).
 */
export async function scheduleProjectCycle(
  projectId: string,
  runAt: Date,
): Promise<void> {
  const jobId = cycleJobId(projectId);
  await kanbanQueue.remove(jobId).catch(() => {});
  const delay = Math.max(0, runAt.getTime() - Date.now());
  await kanbanQueue.add('cycle', { projectId }, { jobId, delay });
}

/** Cancel a pending cycle job (project cancelled / soft-deleted). */
export async function cancelProjectCycle(projectId: string): Promise<void> {
  await kanbanQueue.remove(cycleJobId(projectId)).catch(() => {});
}

const cancelJobId = (projectId: string) => `cancel-${projectId}`;
/** Fire the deferred per-item removal a touch before its boundary charge. */
const CANCEL_JOB_BUFFER_MS = 12 * 60 * 60 * 1000;

/**
 * Schedule a subscription cancellation to take effect at `cancelAt` (spec §3).
 * A past/now date cancels immediately. A future date either schedules Stripe's
 * native whole-sub `cancel_at` (handled inside {@link cancelProjectSubscription})
 * or, for a multi-item subscription, arms a deferred job to remove just this
 * project's item before its next invoice ({@link runProjectCancellation}).
 */
export async function scheduleProjectCancellation(
  project: ProjectRow,
  cancelAt: Date,
  db: Db = defaultDb,
): Promise<void> {
  if (cancelAt.getTime() <= Date.now()) {
    await cancelProjectSubscription(project, db);
    return;
  }
  const { deferItemRemoval } = await cancelProjectSubscription(project, db, { cancelAt });
  if (deferItemRemoval) {
    const jobId = cancelJobId(project.id);
    await kanbanQueue.remove(jobId).catch(() => {});
    const delay = Math.max(0, cancelAt.getTime() - CANCEL_JOB_BUFFER_MS - Date.now());
    await kanbanQueue.add('cancel-item', { projectId: project.id }, { jobId, delay });
  }
}

/**
 * Revert a still-pending scheduled cancellation ("continue"): the symmetric
 * inverse of {@link scheduleProjectCancellation}. Removes the deferred per-item
 * removal job (multi-item path) and clears Stripe's native `cancel_at`
 * (last-item path) so billing simply continues. The caller clears
 * `projects.cancelledAt`.
 */
export async function unscheduleProjectCancellation(
  project: ProjectRow,
  db: Db = defaultDb,
): Promise<void> {
  await kanbanQueue.remove(cancelJobId(project.id)).catch(() => {});
  await resumeProjectSubscription(project, db);
}

/** Worker body for the deferred per-item removal — remove the item now (it's due). */
export async function runProjectCancellation(
  projectId: string,
  db: Db = defaultDb,
): Promise<void> {
  const p = (
    await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  )[0];
  if (!p) return;
  await cancelProjectSubscription(p, db);
}

/**
 * Called when a recurring project is marked completed. If its next cycle is
 * already due, re-open it now; otherwise arm the exact-time job. No-op for
 * service types that don't re-cycle a deliverable.
 */
export async function onRecurringProjectCompleted(
  project: ProjectRow,
  now = new Date(),
  db: Db = defaultDb,
): Promise<void> {
  if (!hasDeliverableCycle(project.serviceType as ServiceType | null)) return;
  if (!project.nextCycleAt) return;
  if (project.nextCycleAt.getTime() <= now.getTime()) {
    await runProjectCycle(project.id, now, db);
  } else {
    await scheduleProjectCycle(project.id, project.nextCycleAt);
  }
}

/**
 * The cycle job body: activate a due `upcoming` (delayed-phase) project or
 * re-open a `completed` recurring project for its next cycle. Idempotent and
 * safe to run late.
 */
export async function runProjectCycle(
  projectId: string,
  now = new Date(),
  db: Db = defaultDb,
): Promise<{ acted: boolean; reason?: string }> {
  const p = (
    await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  )[0];
  if (!p || p.deletedAt) return { acted: false, reason: 'gone' };
  if (p.status !== 'completed' && p.status !== 'upcoming')
    return { acted: false, reason: `status:${p.status}` };
  if (!p.nextCycleAt || p.nextCycleAt.getTime() > now.getTime()) {
    // Not due yet — re-arm for the real time (covers an early manual trigger).
    if (p.nextCycleAt) await scheduleProjectCycle(p.id, p.nextCycleAt);
    return { acted: false, reason: 'not-due' };
  }

  const activation = p.status === 'upcoming';

  // Payment gate (completed recurring only): a re-cycle waits until the next
  // cycle's weekly instalments have been collected. Activation of a delayed
  // phase and projects without a Stripe subscription are not gated.
  if (!activation && p.purchaseId) {
    const purchase = (
      await db.select().from(purchases).where(eq(purchases.id, p.purchaseId)).limit(1)
    )[0];
    const gated = !!purchase?.stripeSubscriptionId;
    if (gated) {
      const paid = isPaymentMadeOnTimeForCycle(
        purchase!.paymentCount ?? 0,
        (p.cycleCount ?? 1) + 1,
        {
          type: p.serviceType as ServiceType | null,
          createdAt: p.createdAt,
          deliverableFrequency: p.deliverableFrequency as DeliverableFrequency | null,
          repeatsEvery: p.repeatsEvery,
        },
      );
      if (!paid) return { acted: false, reason: 'unpaid' }; // webhook will re-arm
    }
  }

  await resetRecurringProject(p, now, db, { activation });
  return { acted: true };
}

/** Re-open one project for its next deliverable cycle (or activate a delayed phase). */
async function resetRecurringProject(
  p: ProjectRow,
  now: Date,
  db: Db,
  opts: { activation: boolean },
): Promise<void> {
  const recurs = hasDeliverableCycle(p.serviceType as ServiceType | null);
  // Anchor the NEXT cycle to the PREVIOUS nextCycleAt (drift-free), not `now`.
  const next = recurs
    ? projectNextCycleAt({
        type: p.serviceType as ServiceType | null,
        deliverableFrequency: p.deliverableFrequency as DeliverableFrequency | null,
        repeatsEvery: p.repeatsEvery,
        from: p.nextCycleAt ?? now,
      })
    : null;

  const cfg = (p.recurringProjectConfig ?? {}) as {
    taskName?: string | null;
    projectDurationDays?: number | null;
    estimatedContractorDurationInHours?: number | null;
    contractorDefaultBudget?: number | null;
    contractorDefaultBudgetInPercentage?: number | null;
  };
  const deadline =
    cfg.projectDurationDays && cfg.projectDurationDays > 0
      ? new Date(now.getTime() + cfg.projectDurationDays * 86_400_000)
      : null;

  // Recurring contractor budget: percentage of the weekly recurring fee, else flat.
  const recurringBudget = recurringContractorBudget(p.recurringProjectConfig, p.amount);

  const isReCycle = !opts.activation && recurs;
  const comments = isReCycle
    ? [
        ...((p.revisionComments as string[]) ?? []),
        `New cycle started for ${p.deliverableFrequency ?? 'recurring project'}.`,
      ]
    : ((p.revisionComments as string[]) ?? []);

  // Per-cycle history: freeze the closing cycle's brief before the live fields
  // are overwritten, and promote any agency pre-written brief for the opening
  // cycle. The pre-brief row is also stamped startedAt so the rail can date it.
  const closingCycle = Math.max(p.cycleCount ?? 1, 1);
  const openingCycle = closingCycle + 1;
  let preBrief: { briefContext: string | null; briefDocuments: unknown[] | null } | undefined;
  if (isReCycle) {
    await db
      .insert(projectCycles)
      .values({
        projectId: p.id,
        cycleNumber: closingCycle,
        briefContext: p.briefContext,
        briefDocuments: (p.briefDocuments as unknown[]) ?? [],
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: [projectCycles.projectId, projectCycles.cycleNumber],
        set: {
          briefContext: p.briefContext,
          briefDocuments: (p.briefDocuments as unknown[]) ?? [],
          completedAt: now,
          updatedAt: now,
        },
      });
    [preBrief] = await db
      .insert(projectCycles)
      .values({ projectId: p.id, cycleNumber: openingCycle, startedAt: now })
      .onConflictDoUpdate({
        target: [projectCycles.projectId, projectCycles.cycleNumber],
        set: { startedAt: now, updatedAt: now },
      })
      .returning({
        briefContext: projectCycles.briefContext,
        briefDocuments: projectCycles.briefDocuments,
      });
  }

  // The previous cycle's assignee is RETAINED across the reset so the allocate
  // dialog pre-selects them on re-allocation. The new cycle still passes through
  // `allocate` — that move (projects.allocate / setStatus) books the cycle's
  // contractor payout + invoice even when the assignee is unchanged.
  await db
    .update(projects)
    .set({
      status: 'brief',
      nextCycleAt: next,
      ...(isReCycle
        ? {
            cycleCount: openingCycle,
            revisionComments: comments,
            taskTitle: cfg.taskName ?? p.taskTitle,
            estimatedContractorDurationInHours:
              cfg.estimatedContractorDurationInHours ?? p.estimatedContractorDurationInHours,
            ...(recurringBudget != null
              ? { contractorBudget: Number(recurringBudget).toFixed(2) }
              : {}),
            deadline,
            ...(preBrief?.briefContext ? { briefContext: preBrief.briefContext } : {}),
            ...(preBrief?.briefDocuments?.length
              ? { briefDocuments: preBrief.briefDocuments }
              : {}),
          }
        : {}),
      updatedAt: now,
    })
    .where(eq(projects.id, p.id));

  // Regenerate brief-stage tasks (Flutter: handled by onProjectStatusChange).
  const brand = p.brandId
    ? (await db.select().from(brands).where(eq(brands.id, p.brandId)).limit(1))[0]
    : null;
  const agency = p.agencyId
    ? (await db.select().from(agencies).where(eq(agencies.id, p.agencyId)).limit(1))[0]
    : null;
  await onProjectStatusChanged(
    {
      projectId: p.id,
      status: 'brief',
      assigneeType: p.assigneeType,
      productionAssigneeId: p.productionAssigneeId,
      agencyId: p.agencyId,
      agencyName: agency?.businessName ?? null,
      brandOwnerId: brand?.ownerId ?? null,
      approvalDesigneeId: agency?.approvalDesigneeId ?? null,
      organizationName: agency?.businessName ?? null,
    },
    db,
  ).catch(() => {});

  // A delayed recurring phase begins billing only now (not at checkout): add its
  // Stripe subscription item on activation. Its first weekly charge lands 7 days
  // from here — the first week is covered by the upfront paid at checkout.
  if (opts.activation && recurs) {
    const fresh = (await db.select().from(projects).where(eq(projects.id, p.id)).limit(1))[0];
    if (fresh) await addSubscriptionItemForProject(fresh, db);
  }

  // Recurring re-cycle leaves the new cycle in `brief`; it will re-arm its next
  // job when it completes. A delayed phase that turns out to also recur arms its
  // first cycle now.
  if (opts.activation && next) await scheduleProjectCycle(p.id, next);
}

/**
 * Daily backstop — re-open any due recurring/upcoming project whose exact-time
 * job was lost (e.g. a Redis flush). Idempotent; the per-project gate inside
 * runProjectCycle prevents double-advance.
 */
export async function reconcileDueProjects(
  now = new Date(),
  db: Db = defaultDb,
): Promise<{ reset: number }> {
  const due = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        inArray(projects.status, ['completed', 'upcoming']),
        isNotNull(projects.nextCycleAt),
        lte(projects.nextCycleAt, now),
        isNull(projects.deletedAt),
      ),
    );
  let reset = 0;
  for (const { id } of due) {
    try {
      const r = await runProjectCycle(id, now, db);
      if (r.acted) reset++;
    } catch (err) {
      console.error('[recurring] reconcile failed for', id, (err as Error).message);
    }
  }
  return { reset };
}
