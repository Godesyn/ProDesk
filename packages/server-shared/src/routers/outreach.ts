/**
 * OUTREACH router — our own outbound cold email, run through Smartlead.
 *
 * Super-admin only, and ProDesk only: this is the agency's own sending
 * infrastructure, not a tenant-facing feature, so every procedure runs on
 * `superAdminProcedure` and there is no brand scoping anywhere in it.
 *
 * Smartlead is headless. Everything the operator does — connect mailboxes, set
 * caps, stop sending, read health — happens here and is pushed through the API;
 * nobody opens Smartlead after setup. Reads are cached in Redis for 30–60s so a
 * page view costs one API call rather than a burst, and every bulk write is
 * queued to the Worker because Smartlead's rate limit is per key across all
 * endpoints.
 *
 * See docs/agents/outreach.md and docs/agents/outreach-api-findings.md.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { router, superAdminProcedure } from '../trpc/trpc.js';
import { outreachQueue } from '../jobs/queues.js';
import {
  outreachProspectState,
  outreachReplyDrafts,
  outreachSequenceSource,
  outreachSuppression,
} from '../db/schema.js';
import {
  discardDraft,
  latestDraftFor,
  listQueue,
  pendingCount,
  saveDraftEdit,
  sendReply,
} from '../modules/outreach/replies.js';
import { suppress } from '../modules/outreach/suppression.js';
import { createVerdiictAccount, regenerateAccountLink } from '../modules/outreach/fulfilment.js';
import {
  estimateCostUsd,
  mapsProvider,
  verifier,
  MAPS_RESULT_CEILING,
} from '../modules/outreach/list-builder/providers/index.js';
import {
  regionSearch,
  RegionSearchError,
} from '../modules/outreach/list-builder/providers/region-search.js';
import {
  blockedBy,
  countsOf,
  createRun,
  getRun as getListRun,
  isCapped,
  isResumable,
  listRuns,
  listVerticals,
  moveRun,
  queueStateOf,
  RegionAlreadyScrapedError,
  RegionBilledButFailedError,
  RegionCoveredError,
  RunNotQueuedError,
  RunNotRetryableError,
  retryRun,
  sendQueue,
  setRunSkipped,
  supersedeRun,
  patchRun,
} from '../modules/outreach/list-builder/ledger.js';
import { coverage } from '../modules/outreach/list-builder/coverage.js';
import { runBusinesses } from '../modules/outreach/list-builder/businesses.js';
import { coveringParentFor, rememberRegion } from '../modules/outreach/list-builder/gazetteer.js';
import { loadSet, REVIEW_HOLD_MS } from '../modules/outreach/list-builder/run.js';
import {
  beginPurge,
  countProspectsByRun,
  readPurge,
  resolveLeadId,
  withdrawFromCampaign,
} from '../modules/outreach/list-builder/prospects.js';
import { cached, cacheKeys, invalidate } from '../modules/outreach/cache.js';
import {
  attachAllMailboxes,
  CampaignNotConfiguredError,
  configuredCampaignName,
  DEFAULT_SCHEDULE,
  ensureCampaign,
  normaliseVertical,
  saveSequences,
  toSequenceSteps,
} from '../modules/outreach/campaigns.js';
import {
  beginFanout,
  CAP_MAX,
  CAP_MIN,
  clampCap,
  getCapPolicy,
  getFanoutProgress,
  saveCapPolicy,
} from '../modules/outreach/caps.js';
import { getSendingFloor } from '../modules/outreach/sending-floor.js';
import {
  outreachWebhookStatus,
  registerOutreachWebhook,
} from '../modules/outreach/webhook.js';
import {
  addSmtpAccount,
  getCampaign,
  getCampaignSequences,
  getDayWiseStats,
  getLeadMessageHistory,
  getWarmupStats,
  isSmartleadConfigured,
  setCampaignSchedule,
  setCampaignStatus,
  sequenceStepDelayDays,
  setDailyCap,
  SmartleadError,
  SmartleadNotConfiguredError,
  suspendEmailAccount,
  unsuspendEmailAccount,
} from '../modules/outreach/smartlead.js';

/**
 * Pass Smartlead's own words through to the operator.
 *
 * There is no other surface to go and check — nobody opens Smartlead — so our
 * error copy is the only error surface that exists. Swallowing the reason here
 * would leave a dead end.
 */
function rethrow(e: unknown): never {
  if (e instanceof SmartleadNotConfiguredError || e instanceof CampaignNotConfiguredError) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: e.message });
  }
  if (e instanceof SmartleadError) {
    throw new TRPCError({
      code: e.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: `Smartlead: ${e.message}`,
    });
  }
  throw e;
}

const accountId = z.number().int().positive();

/**
 * Does this draft already carry a Verdiict login link?
 *
 * Matched on the confirmation path rather than on the whole URL, because the
 * origin differs per environment and the token never repeats. Both places that
 * can put a link in a body — the "Add account link" button and the append below
 * — produce this same path.
 */
function bodyHasAccountLink(body: string): boolean {
  return /\/auth\/confirm\?token_hash=/i.test(body);
}

/**
 * Wake the run at the front of the send queue.
 *
 * A waiting run polls every twenty seconds to ask whether the one ahead has
 * finished, which is fine for a queue that drains on its own. It is not fine
 * for a queue the operator just reordered: they moved a run to the front and
 * expect it to go, not to go in a bit. Nothing else notices a reorder, so the
 * reorder says so.
 *
 * Best-effort. The poll is the real guarantee; this only removes the wait.
 */
async function nudgeQueue(): Promise<void> {
  const [head] = (await sendQueue()).filter((r) => !r.skippedAt);
  if (!head) return;
  // Keyed, so a burst of reorder clicks starts one extra tick rather than one
  // per click. A tick that finds itself still blocked schedules its own
  // follow-up, so unkeyed nudges would each spawn a polling chain that never
  // merges back.
  await outreachQueue.add(
    'list-build',
    { runId: head.id },
    { jobId: `queue-nudge-${head.id}`, removeOnComplete: true, removeOnFail: 20 },
  );
}

export const outreachRouter = router({
  /* ── The Sending Floor ─────────────────────────────────────────────────── */

  /** Everything the Mailboxes screen renders: domains, mailboxes, capacity, health. */
  floor: superAdminProcedure.query(async () => {
    try {
      return await getSendingFloor();
    } catch (e) {
      return rethrow(e);
    }
  }),

  /** Rolling 7-day warmup detail for one mailbox, for the detail view. */
  warmupStats: superAdminProcedure
    .input(z.object({ accountId }))
    .query(async ({ input }) => {
      try {
        return await getWarmupStats(input.accountId);
      } catch (e) {
        return rethrow(e);
      }
    }),

  /* ── Stop / start one mailbox ──────────────────────────────────────────── */

  /**
   * Stop a mailbox sending.
   *
   * The intended mechanism is a zeroed daily cap: immediate, reversible, one
   * field, and it leaves warmup running. Smartlead's docs never confirmed a cap
   * of 0 is accepted, so if it is rejected we fall back to its purpose-built
   * suspend — which stops sending just as well but ALSO pauses warmup.
   *
   * Which one happened comes back in `mechanism` so the toast can say so. An
   * operator who thinks warmup is still running when it isn't will misread every
   * reputation number on the screen afterwards.
   */
  stopMailbox: superAdminProcedure
    .input(z.object({ accountId }))
    .mutation(async ({ input }) => {
      let mechanism: 'cap' | 'suspend' = 'cap';
      try {
        await setDailyCap(input.accountId, 0);
      } catch (e) {
        if (!(e instanceof SmartleadError)) return rethrow(e);
        try {
          await suspendEmailAccount(input.accountId);
          mechanism = 'suspend';
        } catch (fallbackError) {
          return rethrow(fallbackError);
        }
      }
      await invalidate(cacheKeys.emailAccounts);
      return { mechanism };
    }),

  /**
   * Resume a stopped mailbox.
   *
   * Restores it to the cap policy rather than to whatever it held before, so a
   * mailbox that sat stopped through a policy change comes back in line with
   * everything else. Unsuspends first, since a suspended mailbox ignores its cap.
   */
  startMailbox: superAdminProcedure
    .input(z.object({ accountId, suspended: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      try {
        if (input.suspended) await unsuspendEmailAccount(input.accountId);
        const policy = await getCapPolicy();
        const cap = clampCap(policy.overrides[String(input.accountId)] ?? policy.global);
        await setDailyCap(input.accountId, cap);
        await invalidate(cacheKeys.emailAccounts);
        return { cap };
      } catch (e) {
        return rethrow(e);
      }
    }),

  /* ── Cap policy ────────────────────────────────────────────────────────── */

  capPolicy: superAdminProcedure.query(async () => {
    const policy = await getCapPolicy();
    return { ...policy, min: CAP_MIN, max: CAP_MAX };
  }),

  /**
   * Set one mailbox's cap.
   *
   * A single write, so it runs inline — the fan-out queue exists for the
   * twenty-at-once case, not this one. The override is recorded in the policy so
   * the next global change doesn't quietly erase it.
   */
  setMailboxCap: superAdminProcedure
    .input(z.object({ accountId, cap: z.number().int().min(CAP_MIN).max(CAP_MAX) }))
    .mutation(async ({ input }) => {
      try {
        await setDailyCap(input.accountId, input.cap);
        const policy = await getCapPolicy();
        const overrides = { ...policy.overrides };
        if (input.cap === policy.global) delete overrides[String(input.accountId)];
        else overrides[String(input.accountId)] = input.cap;
        await saveCapPolicy({ ...policy, overrides });
        await invalidate(cacheKeys.emailAccounts);
        return { cap: input.cap };
      } catch (e) {
        return rethrow(e);
      }
    }),

  /**
   * Change the global cap and push it to every mailbox.
   *
   * Returns a `runId` immediately; the write itself happens in the Worker.
   * Twenty sequential Smartlead calls is far too slow to hold a click open, and
   * doing it inline would burn the rate-limit budget the whole screen shares.
   */
  applyCapPolicy: superAdminProcedure
    .input(
      z.object({
        global: z.number().int().min(CAP_MIN).max(CAP_MAX),
        overrides: z.record(z.string(), z.number().int().min(CAP_MIN).max(CAP_MAX)).default({}),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isSmartleadConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Smartlead is not connected. Add SMARTLEAD_API_KEY to the environment.',
        });
      }
      const policy = { global: input.global, overrides: input.overrides };
      await saveCapPolicy(policy);

      const runId = randomUUID();
      // Seed progress before enqueuing so the UI never polls into a 404 gap.
      const floor = await getSendingFloor().catch(() => null);
      const total = floor?.totals.activeMailboxes ?? 0;
      await beginFanout(runId, total);
      await outreachQueue.add(
        'cap-fanout',
        { runId, policy },
        { removeOnComplete: true, removeOnFail: 50 },
      );
      return { runId, total };
    }),

  /** Poll a fan-out. Null once the run has aged out of Redis. */
  fanoutProgress: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(({ input }) => getFanoutProgress(input.runId)),

  /**
   * Account-wide engagement, one row per day, for the monitoring panel.
   *
   * The only true daily series Smartlead exposes — domain health is aggregates
   * per window only, which is why this is estate-wide rather than per domain.
   */
  dayWiseStats: superAdminProcedure
    .input(z.object({ days: z.number().int().min(7).max(90).default(28) }))
    .query(async ({ input }) => {
      if (!isSmartleadConfigured()) return [];
      const end = new Date();
      const start = new Date(end.getTime() - (input.days - 1) * 86_400_000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      try {
        return await cached(
          `day-wise:${iso(start)}:${iso(end)}`,
          () => getDayWiseStats(iso(start), iso(end)),
          300,
        );
      } catch (e) {
        // Monitoring must never take down the floor it sits on.
        console.error('[outreach] day-wise stats failed', (e as Error).message);
        return [];
      }
    }),

  /* ── Campaigns, sequences, schedules ───────────────────────────────────── */

  /**
   * THE campaign — this environment's one campaign, created if it isn't there.
   *
   * One query, not a list plus a detail fetch, because there is nothing to pick
   * between: `OUTREACH_CAMPAIGN_NAME` names exactly one campaign and everything
   * the Sending Email screen renders belongs to it. Reaching the page is what
   * creates it, so a fresh environment needs no setup step beyond the env var.
   */
  campaign: superAdminProcedure.query(async ({ ctx }) => {
    try {
      const ensured = await ensureCampaign();
      const [campaign, sequences, emailAccountIds, source] = await Promise.all([
        getCampaign(ensured.id),
        getCampaignSequences(ensured.id).catch(() => []),
        // Not a read — every mailbox on the floor is attached here, so opening
        // the screen is also what wires up anything connected since last time.
        attachAllMailboxes(ensured.id).catch(() => [] as number[]),
        ctx.db
          .select({
            seqNumber: outreachSequenceSource.seqNumber,
            subject: outreachSequenceSource.subject,
            body: outreachSequenceSource.body,
            delayInDays: outreachSequenceSource.delayInDays,
          })
          .from(outreachSequenceSource)
          .where(eq(outreachSequenceSource.campaignId, ensured.id)),
      ]);

      // The editor edits the SOURCE, not the letter. Smartlead holds the
      // rendered HTML — correct for sending, useless for editing, because the
      // shell is a one-way transform and feeding a rendered letter back into the
      // textarea would wrap it again on the next save. A step with no stored
      // source predates migration 0106 and falls back to Smartlead's body,
      // which is the raw text those sequences were saved with anyway.
      const authored = new Map(source.map((r) => [r.seqNumber, r]));
      const withSource = sequences.map((s) => {
        const own = authored.get(s.seq_number);
        return {
          ...s,
          subject: own?.subject ?? s.subject ?? '',
          email_body: own?.body ?? s.email_body ?? '',
          /**
           * The wait, resolved here rather than in the editor: ours first,
           * Smartlead's under either of its two names second, and null only
           * when neither knows. Reading it off `seq_delay_details` in the UI
           * is what made a saved follow-up snap back to the default.
           */
          delayInDays: own?.delayInDays ?? sequenceStepDelayDays(s),
          /** False = the body shown is Smartlead's HTML, not something we stored. */
          hasSource: own !== undefined,
        };
      });

      return {
        id: campaign.id,
        name: campaign.name ?? ensured.name,
        status: (campaign.status ?? 'DRAFTED').toUpperCase(),
        /** True on the read that brought it into existence — the UI says so once. */
        justCreated: ensured.created,
        sequences: withSource,
        emailAccountIds,
        // The saved schedule, so the panel shows what this campaign actually
        // does rather than re-proposing the defaults at every page load. Read
        // back under Smartlead's own names — see `setCampaignSchedule`.
        schedule: {
          timezone: campaign.scheduler_cron_value?.tz ?? DEFAULT_SCHEDULE.timezone,
          days: campaign.scheduler_cron_value?.days ?? [...DEFAULT_SCHEDULE.days_of_the_week],
          startHour: campaign.scheduler_cron_value?.startHour ?? DEFAULT_SCHEDULE.start_hour,
          endHour: campaign.scheduler_cron_value?.endHour ?? DEFAULT_SCHEDULE.end_hour,
          minTimeBtwEmails: campaign.min_time_btwn_emails ?? DEFAULT_SCHEDULE.min_time_btw_emails,
          maxNewLeadsPerDay: campaign.max_leads_per_day ?? DEFAULT_SCHEDULE.max_new_leads_per_day,
        },
      };
    } catch (e) {
      return rethrow(e);
    }
  }),

  /**
   * Save the campaign's sequence.
   *
   * Smartlead refuses this while a campaign is ACTIVE, so a running campaign is
   * paused and resumed around the save. `pausedAndResumed` and `resumeError` come
   * back so the UI can say what happened — especially the case where the save
   * worked but the campaign could not be restarted.
   *
   * No `campaignId` on any of these writes: there is one campaign and the server
   * knows which, so a client cannot address a different one by accident.
   */
  saveSequences: superAdminProcedure
    .input(
      z.object({
        sequences: z
          .array(
            z.object({
              id: z.number().int().nullable().default(null),
              seqNumber: z.number().int().min(1),
              subject: z.string().default(''),
              body: z.string(),
              delayInDays: z.number().int().min(0).max(365),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { id } = await ensureCampaign();

        // Checks the tags and wraps each body in the letter. Throws on an
        // unknown tag, before anything is written anywhere — a typo must not
        // reach Smartlead, and it must not be half-saved to us either.
        const steps = toSequenceSteps(input.sequences);
        const result = await saveSequences(id, steps);

        // Source second, and only on success: the row we keep is a record of
        // what was sent, so writing it before the send could succeed would let
        // the editor show copy that no prospect ever received.
        await ctx.db
          .insert(outreachSequenceSource)
          .values(
            input.sequences.map((s) => ({
              campaignId: id,
              seqNumber: s.seqNumber,
              subject: s.subject,
              body: s.body,
              delayInDays: s.delayInDays,
            })),
          )
          .onConflictDoUpdate({
            target: [outreachSequenceSource.campaignId, outreachSequenceSource.seqNumber],
            set: {
              subject: sql`excluded.subject`,
              body: sql`excluded.body`,
              delayInDays: sql`excluded.delay_in_days`,
              updatedAt: sql`now()`,
            },
          });

        // A sequence that lost its last follow-up must lose that follow-up's
        // source too. Without this the step comes back the next time someone
        // adds a fourth, carrying copy that was deliberately deleted.
        await ctx.db
          .delete(outreachSequenceSource)
          .where(
            and(
              eq(outreachSequenceSource.campaignId, id),
              sql`${outreachSequenceSource.seqNumber} > ${input.sequences.length}`,
            ),
          );

        return result;
      } catch (e) {
        return rethrow(e);
      }
    }),

  saveSchedule: superAdminProcedure
    .input(
      z.object({
        timezone: z.string().min(1),
        days: z.array(z.number().int().min(0).max(6)).min(1),
        startHour: z.string().regex(/^\d{2}:\d{2}$/),
        endHour: z.string().regex(/^\d{2}:\d{2}$/),
        /** Smartlead's own floor is 3 minutes; 1 or 2 is a 400. Verified live. */
        minTimeBtwEmails: z.number().int().min(3).max(1440),
        maxNewLeadsPerDay: z.number().int().min(1).max(10_000),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { id } = await ensureCampaign();
        await setCampaignSchedule(id, {
          timezone: input.timezone,
          days_of_the_week: input.days,
          start_hour: input.startHour,
          end_hour: input.endHour,
          min_time_btw_emails: input.minTimeBtwEmails,
          max_new_leads_per_day: input.maxNewLeadsPerDay,
        });
        await invalidate(cacheKeys.campaigns);
        return { ok: true };
      } catch (e) {
        return rethrow(e);
      }
    }),

  /*
   * There is no "set which mailboxes this campaign sends from" any more.
   *
   * With one campaign the answer is all of them, so it is applied rather than
   * asked — see `attachAllMailboxes`. The choice that still matters is per
   * MAILBOX and lives on the Sending Floor, where stopping one sets its cap to
   * zero and it stops sending for every campaign at once.
   */

  setCampaignStatus: superAdminProcedure
    .input(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'STOPPED']) }))
    .mutation(async ({ input }) => {
      try {
        const { id } = await ensureCampaign();
        await setCampaignStatus(id, input.status);
        await invalidate(cacheKeys.campaigns);
        return { status: input.status };
      } catch (e) {
        return rethrow(e);
      }
    }),

  /**
   * A real prospect to preview a template against — §8 wants the preview to show
   * what a person actually receives, not lorem ipsum.
   *
   * No vertical filter any more: the one campaign sends to every vertical, so
   * there is no "this campaign's vertical" to narrow to. It still prefers a
   * prospect WITH a personalisation detail, because that is the interesting case
   * — the empty one is what the fallback copy underneath the editor describes.
   */
  previewProspect: superAdminProcedure
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          email: outreachProspectState.email,
          businessName: outreachProspectState.businessName,
          website: outreachProspectState.website,
          // What `{{location}}` resolves to. The preview used to hardcode this
          // blank because it wasn't stored, so the one tag whose real send was
          // fine looked broken on screen.
          address: outreachProspectState.address,
          detail: outreachProspectState.personalisationDetail,
          // Stored at push time so the preview renders the sentence that was
          // actually sent, not one recomputed against a different benchmark.
          hook: outreachProspectState.reviewHook,
          reviewsCount: outreachProspectState.reviewsCount,
          rating: outreachProspectState.rating,
        })
        .from(outreachProspectState)
        // Presence, explicitly — not `desc(personalisationDetail)`.
        //
        // Postgres sorts DESC with NULLS FIRST, so ordering on the column
        // itself did the exact opposite of what it was written to do: it
        // reliably picked a prospect with NO detail, and the screen whose only
        // job is to show what a real person receives showed the fallback every
        // single time. The hook leads because it is the sentence the letter is
        // built around; the detail breaks the tie.
        .orderBy(
          sql`(${outreachProspectState.reviewHook} IS NOT NULL) DESC`,
          sql`(${outreachProspectState.personalisationDetail} IS NOT NULL) DESC`,
          desc(outreachProspectState.createdAt),
        )
        .limit(1);
      return rows[0] ?? null;
    }),

  /* ── Prospects ─────────────────────────────────────────────────────────── */

  /**
   * The prospect list, keyset-paginated.
   *
   * Keyset rather than offset because the list grows while you page through it,
   * and offset paging silently skips or repeats rows when it does.
   */
  prospects: superAdminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.object({ createdAt: z.string(), id: z.string() }).nullish(),
        search: z.string().trim().optional(),
        classification: z.enum(['yes', 'question', 'not_now', 'never', 'other']).optional(),
        vertical: z.string().trim().optional(),
        sendingDomain: z.string().trim().optional(),
        repliedOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [
        input.classification
          ? eq(outreachProspectState.classification, input.classification)
          : undefined,
        input.vertical ? eq(outreachProspectState.vertical, input.vertical) : undefined,
        input.sendingDomain
          ? eq(outreachProspectState.sendingDomain, input.sendingDomain)
          : undefined,
        input.repliedOnly ? isNotNull(outreachProspectState.repliedAt) : undefined,
        input.search
          ? or(
              ilike(outreachProspectState.email, `%${input.search}%`),
              ilike(outreachProspectState.businessName, `%${input.search}%`),
            )
          : undefined,
        // Keyset: strictly "older than the cursor", with id breaking ties on
        // rows created in the same microsecond.
        input.cursor
          ? sql`(${outreachProspectState.createdAt}, ${outreachProspectState.id}) < (${new Date(
              input.cursor.createdAt,
            ).toISOString()}::timestamptz, ${input.cursor.id}::uuid)`
          : undefined,
      ].filter(Boolean);

      const rows = await ctx.db
        .select()
        .from(outreachProspectState)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(outreachProspectState.createdAt), desc(outreachProspectState.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const last = items[items.length - 1];

      return {
        items,
        nextCursor:
          hasMore && last
            ? { createdAt: last.createdAt.toISOString(), id: last.id }
            : null,
      };
    }),

  /**
   * The search terms actually present in the prospect table, largest first.
   *
   * Read from the prospects rather than from the run ledger or the campaign
   * list: this drives a filter, and a filter offering a term that matches
   * nothing is worse than one that omits it. `vertical` is the search term the
   * List Builder ran — the same string that became the campaign and the noun in
   * the opener — so it is the one label that says where a prospect came from.
   */
  prospectVerticals: superAdminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        vertical: outreachProspectState.vertical,
        count: sql<number>`count(*)::int`,
      })
      .from(outreachProspectState)
      .where(isNotNull(outreachProspectState.vertical))
      .groupBy(outreachProspectState.vertical)
      .orderBy(desc(sql`count(*)`));
    return rows
      .filter((r): r is { vertical: string; count: number } => !!r.vertical)
      .map((r) => ({ vertical: r.vertical, count: r.count }));
  }),

  /**
   * Delete one prospect, stopping their sequence first.
   *
   * Synchronous, unlike the whole-run purge, because one contact is at most two
   * Smartlead calls. It refuses when the campaign can't be told to stop: a row
   * deleted while its sequence keeps running is a person we are emailing and no
   * longer have a record of.
   */
  deleteProspect: superAdminProcedure
    .input(z.object({ email: z.string().trim().toLowerCase() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(outreachProspectState)
        .where(eq(outreachProspectState.email, input.email))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such prospect.' });

      const outcome = await withdrawFromCampaign(row);
      if (!outcome.ok) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Smartlead would not take them out of the campaign, so they are still being emailed and the record has been kept: ${outcome.reason}`,
        });
      }
      await ctx.db.delete(outreachProspectState).where(eq(outreachProspectState.id, row.id));
      return { ok: true };
    }),

  /** The conversation, fetched live from Smartlead, plus any queued draft. */
  prospectThread: superAdminProcedure
    .input(z.object({ email: z.string().trim().toLowerCase() }))
    .query(async ({ ctx, input }) => {
      const [prospect] = await ctx.db
        .select()
        .from(outreachProspectState)
        .where(eq(outreachProspectState.email, input.email))
        .limit(1);
      if (!prospect) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such prospect.' });

      let messages: unknown[] = [];
      let threadError: string | null = null;
      /**
       * Why there is no thread to fetch, when there isn't one.
       *
       * This used to be silent, and silence read as a claim. `resolveLeadId`
       * answers null for four different situations — no API key in this
       * environment, no campaign, Smartlead having no lead for the address, and
       * the lookup itself failing (its `catch` swallows rate limits and 5xx) —
       * and only the third of those has anything to do with the prospect. The
       * caller got an empty message list and no error for all four, so a screen
       * showing a conversation had no way to tell "nothing has been sent to this
       * business" from "we could not find out", and said the former.
       */
      let threadUnavailable: string | null = null;
      // The lead id is resolved on first read rather than captured at push
      // time — see `resolveLeadId`. Without this the condition below was never
      // true for anyone, because nothing else ever wrote the column, and every
      // conversation on this screen and in the Reply Queue rendered empty.
      const leadId = await resolveLeadId(prospect);
      if (!isSmartleadConfigured()) {
        threadUnavailable = 'Smartlead is not configured in this environment, so no thread can be read.';
      } else if (!prospect.smartleadCampaignId) {
        threadUnavailable = 'This prospect was never pushed into a campaign.';
      } else if (!leadId) {
        threadUnavailable =
          'Smartlead has no lead for this address. It was either never uploaded or has since been removed from the campaign.';
      } else {
        try {
          const history = await getLeadMessageHistory(prospect.smartleadCampaignId, leadId);
          messages = Array.isArray(history) ? history : (history?.history ?? []);
        } catch (e) {
          // The thread is a live read; losing it must not hide the prospect.
          threadError = e instanceof SmartleadError ? e.message : (e as Error).message;
        }
      }

      return {
        prospect,
        messages,
        threadError,
        threadUnavailable,
        draft: await latestDraftFor(input.email),
      };
    }),

  /**
   * Override the model's classification.
   *
   * Written to `manualClassification`, never over the top of the model's call —
   * so "what did the classifier think" stays answerable after a correction, and
   * the override records who made it and when.
   */
  overrideClassification: superAdminProcedure
    .input(
      z.object({
        email: z.string().trim().toLowerCase(),
        classification: z.enum(['yes', 'question', 'not_now', 'never', 'other']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(outreachProspectState)
        .set({
          manualClassification: input.classification,
          manualClassificationByUserId: ctx.user.id,
          manualClassificationAt: new Date(),
        })
        .where(eq(outreachProspectState.email, input.email));

      // An override to `never` is a do-not-contact instruction, so it suppresses
      // too. Leaving those as separate actions invites doing only the first.
      if (input.classification === 'never') {
        await suppress({
          value: input.email,
          kind: 'email',
          reason: 'manually classified never',
          source: 'operator',
          addedByUserId: ctx.user.id,
        });
      }
      return { ok: true };
    }),

  /* ── Suppression ───────────────────────────────────────────────────────── */

  suppressions: superAdminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }))
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(outreachSuppression)
        .orderBy(desc(outreachSuppression.createdAt))
        .limit(input.limit),
    ),

  addSuppression: superAdminProcedure
    .input(
      z.object({
        value: z.string().trim().min(3),
        kind: z.enum(['email', 'domain']),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await suppress({ ...input, source: 'operator', addedByUserId: ctx.user.id });
      return { ok: true };
    }),

  /**
   * Take an entry off the local list.
   *
   * Deliberately does NOT remove it from Smartlead's block list. Our copy is
   * authoritative for list building; Smartlead's is a replica that only ever
   * refuses to send, and leaving a stale entry there fails safe. Removing it
   * from both would need the block-list entry id, which the add endpoint does
   * not return — so the honest thing is to do the half we can do, and say so.
   */
  removeSuppression: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(outreachSuppression)
        .where(eq(outreachSuppression.id, input.id))
        .returning({ value: outreachSuppression.value, pushedAt: outreachSuppression.pushedAt });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such suppression.' });
      return { value: row.value, stillBlockedInSmartlead: !!row.pushedAt };
    }),

  /* ── The Smartlead webhook ─────────────────────────────────────────────── */

  /**
   * Is Smartlead actually pointed at us?
   *
   * Everything downstream of a reply — classify, draft, queue, hand off — is
   * driven by one callback, and Smartlead has to be told the URL. Nothing in
   * the product ever told it, so this reads whether that has been done and
   * whether an event has ever landed. `eventCount` is the only end-to-end
   * proof: registration succeeding means Smartlead accepted a URL, not that it
   * can reach it.
   */
  webhookStatus: superAdminProcedure.query(() => outreachWebhookStatus()),

  /** Point Smartlead at this environment's callback. Idempotent; re-runnable. */
  registerWebhook: superAdminProcedure.mutation(async () => {
    try {
      return await registerOutreachWebhook();
    } catch (e) {
      if (e instanceof SmartleadError || e instanceof SmartleadNotConfiguredError) return rethrow(e);
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (e as Error).message });
    }
  }),

  /* ── Reply queue ───────────────────────────────────────────────────────── */

  replyQueue: superAdminProcedure.query(() => listQueue()),

  pendingReplyCount: superAdminProcedure.query(() => pendingCount()),

  saveDraft: superAdminProcedure
    .input(z.object({ draftId: z.string().uuid(), body: z.string() }))
    .mutation(async ({ input }) => {
      await saveDraftEdit(input.draftId, input.body);
      return { ok: true };
    }),

  /**
   * Send an approved reply.
   *
   * On a `yes`, the Verdiict account is created FIRST and its link appended to
   * the body — one email, from the human they replied to, at peak intent. If
   * account creation fails the send is abandoned rather than sending a promise
   * with no link in it.
   */
  sendReply: superAdminProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        body: z.string().min(1),
        /** Create the Verdiict account and append its link. */
        withAccountLink: z.boolean().default(false),
        /** The address that replied, if different from the one we prospected. */
        replyEmail: z.string().trim().toLowerCase().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select({ email: outreachReplyDrafts.email })
        .from(outreachReplyDrafts)
        .where(eq(outreachReplyDrafts.id, input.draftId))
        .limit(1);
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'That reply is no longer in the queue.' });

      let appendLink: string | null = null;
      let includedLink = false;
      if (input.withAccountLink) {
        try {
          const handoff = await createVerdiictAccount({
            email: input.replyEmail ?? draft.email,
            prospectEmail: draft.email,
          });
          includedLink = true;
          // The account is still created — it is idempotent, and it is what
          // records the handoff — but the link is only APPENDED if the body
          // doesn't already carry one. The Reply Queue's "Add account link"
          // writes a link into the draft, and it is only offered on a `yes`,
          // which is exactly when this branch appends a second one: the
          // operator pressed the button and the prospect received the same URL
          // twice.
          appendLink = bodyHasAccountLink(input.body)
            ? null
            : `Set up your listing here: ${handoff.link}`;
        } catch (e) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Nothing was sent — the account could not be created: ${(e as Error).message}`,
          });
        }
      }

      try {
        await sendReply({
          draftId: input.draftId,
          body: input.body,
          userId: ctx.user.id,
          appendLink,
        });
      } catch (e) {
        return rethrow(e);
      }
      return { sent: true, includedLink };
    }),

  discardReply: superAdminProcedure
    .input(z.object({ draftId: z.string().uuid(), alsoSuppress: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      await discardDraft({ ...input, userId: ctx.user.id });
      return { ok: true };
    }),

  /** A fresh login link for someone who lost theirs. */
  resendAccountLink: superAdminProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email() }))
    .mutation(async ({ input }) => ({ link: await regenerateAccountLink(input.email) })),

  /* ── List Builder ──────────────────────────────────────────────────────── */

  listBuilderConfig: superAdminProcedure.query(async () => ({
    scraper: mapsProvider().name,
    scraperConfigured: mapsProvider().configured,
    verifierConfigured: verifier.configured,
    /**
     * Whether this environment has a campaign to push into.
     *
     * A run with nowhere to send is a run that spends money for nothing, so the
     * form refuses to start one — the same way it refuses without a scraper or a
     * verifier, and for the same reason.
     */
    campaignConfigured: !!configuredCampaignName(),
    /**
     * Always available — OpenStreetMap needs no key. Named so the UI can show
     * the attribution its licence requires, and say which service is answering.
     */
    regionSearchProvider: regionSearch().name,
    regionSearchAttribution: regionSearch().attribution,
    /** False on a provider that can't be asked "did I already start this?". */
    supportsAdoption: mapsProvider().supportsAdoption,
    resultCeiling: MAPS_RESULT_CEILING,
    /**
     * No lists here any more — not of regions, and no longer of verticals.
     *
     * Both used to be typed out in regions.ts, and both were the same mistake
     * in different clothes: a table of strings standing in for something the
     * system already knows. Regions are searched and their containment comes
     * from OpenStreetMap (see coverage.ts). Verticals now come off the ledger,
     * so the suggestions are the ones we have actually run rather than a wish
     * list of 13 that never shrank as they were done.
     */
    verticals: await listVerticals(),
  })),

  /**
   * Region search — used only to NAME an area (see region-search.ts).
   *
   * OpenStreetMap by default, Google Places when a key is configured. Needs no
   * key to work at all, which is the point: a hardcoded list of 38 names was
   * the thing standing between the operator and any region outside Sydney.
   */
  regionSuggest: superAdminProcedure
    .input(z.object({ query: z.string().trim().min(2).max(120) }))
    .query(async ({ input }) => {
      try {
        return await regionSearch().suggest(input.query);
      } catch (e) {
        if (e instanceof RegionSearchError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: e.message });
        }
        throw e;
      }
    }),

  estimateListRun: superAdminProcedure
    .input(z.object({ maxRecords: z.number().int().min(1) }))
    .query(({ input }) => ({ usd: estimateCostUsd(input.maxRecords) })),

  /**
   * Start ONE run for ONE (vertical × region) pair.
   *
   * Deliberately not a list of regions. In-run duplicates are free — the actor
   * dedupes by placeId before billing — but cross-run duplicates are billed
   * twice, so one term, one region, one run, one ledger row is the invariant
   * that keeps the cost model honest.
   */
  startListRun: superAdminProcedure
    .input(
      z.object({
        /**
         * The search term handed to the actor, and the campaign bucket, and the
         * noun in the opener — one string doing all three. See regions.ts for
         * why there is no separate `searchTerm`.
         */
        vertical: z.string().trim().min(2),
        /**
         * Google's id for the region. REQUIRED: the region is always searched
         * now, so every run carries the identity that makes the exact-match
         * uniqueness index apply. Resolved server-side — the client sends an
         * id, never a country or a canonical name, because those decide what
         * gets scraped and billed.
         */
        placeId: z.string().trim().min(1),
        /**
         * A SPEND ceiling, not a target: Apify bills per place found, so a cap
         * set well above what a region holds costs nothing extra. The old 5,000
         * limit was below the real size of a few verticals — cafés across
         * Greater Sydney is ~10,500 — which forced those runs to truncate, and
         * a truncated run cannot be continued without paying twice for what it
         * already collected (billing happens at the scrape, ahead of our
         * dedupe). So the ceiling here is the provider's, not an arbitrary one.
         */
        maxRecords: z.number().int().min(1).max(MAPS_RESULT_CEILING).default(5000),
        sendingDomain: z.string().trim().nullable().default(null),
        /** The optional Haiku homepage crawl. Off by default — see §5. */
        personalise: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      if (!mapsProvider().configured) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No Maps provider is configured. Add APIFY_TOKEN to the environment.',
        });
      }
      if (!verifier.configured) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'No email verifier is configured. Verification is mandatory before any address reaches Smartlead — add MILLIONVERIFIER_API_KEY.',
        });
      }
      // Where this run's contacts will land. Not a choice the client makes any
      // more — there is one campaign per environment — and resolved BEFORE the
      // scrape rather than at push time, because a run that scrapes 4,000
      // businesses and then discovers it has nowhere to send them has already
      // spent the money.
      let campaignId: number;
      try {
        campaignId = (await ensureCampaign()).id;
        // And that it can actually send when the contacts land in it.
        await attachAllMailboxes(campaignId);
      } catch (e) {
        return rethrow(e);
      }
      try {
        // The name, the country and — the one that decides what actually gets
        // scraped — the BOUNDARY all come from resolving the id, never from the
        // client. A client-supplied area is a client-supplied bill. If the
        // provider can't confirm the id, or has no shape for it, the run
        // doesn't start; that refusal is free and a wrong region isn't.
        const resolved = await regionSearch().resolve(input.placeId);
        const row = await createRun({
          ...input,
          campaignId,
          region: resolved.label,
          countryCode: resolved.countryCode,
          boundary: resolved.boundary,
        });
        // The region goes on the map immediately — local, free, and it means the
        // coverage grid knows about the place before the scrape has found a
        // single business.
        await rememberRegion({
          osmId: resolved.placeId,
          label: resolved.label,
          countryCode: resolved.countryCode,
          adminLevel: resolved.adminLevel,
          boundary: resolved.boundary,
        });
        await outreachQueue.add(
          'list-build',
          { runId: row.id },
          { removeOnComplete: true, removeOnFail: 50 },
        );
        // What is INSIDE the region is a separate, slower question — fifteen
        // seconds of Overpass — and nothing about starting a scrape should wait
        // on it. Idempotent by job id: re-picking a region does not re-ask.
        await outreachQueue.add(
          'region-children',
          { osmId: resolved.placeId },
          { jobId: `region-children-${resolved.placeId}`, removeOnComplete: true, removeOnFail: 20 },
        );
        return { runId: row.id };
      } catch (e) {
        // Rule 1 of the cost model, enforced by a unique index rather than by
        // the operator remembering. Surfaced as a refusal, not a warning.
        if (e instanceof RegionAlreadyScrapedError) {
          throw new TRPCError({ code: 'CONFLICT', message: e.message });
        }
        // The same rule, for the case no index can see: this region is inside
        // one we already bought. See RegionCoveredError.
        if (e instanceof RegionCoveredError) {
          throw new TRPCError({ code: 'CONFLICT', message: e.message });
        }
        // The same rule again, for the case the index deliberately lets past: a
        // failed run that had already paid for its scrape. Re-running it would
        // buy the same businesses twice — see `BILLED` in ledger.ts.
        if (e instanceof RegionBilledButFailedError) {
          throw new TRPCError({ code: 'CONFLICT', message: e.message });
        }
        if (e instanceof RegionSearchError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: e.message });
        }
        throw e;
      }
    }),

  listRun: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const row = await getListRun(input.runId);
      if (!row) return null;
      // The candidate list lives in Redis, not on the row — see run.ts. Only
      // the verified survivors are shown, and only a slice of them: this is a
      // spot-check before pushing, not a data browser.
      const set = row.status === 'review' ? await loadSet(row.id) : null;
      const sendable = (set ?? []).filter((c) => c.verdict === 'valid');
      return {
        id: row.id,
        vertical: row.vertical,
        region: row.regionLabel ?? row.regionKey,
        provider: row.provider,
        status: row.status,
        stage: row.stage,
        maxRecords: row.maxRecords,
        personalise: row.personalise,
        campaignId: row.campaignId,
        counts: countsOf(row),
        capped: isCapped(row),
        /**
         * A failed run whose scrape is still on the provider, free to re-read.
         * The difference between one click and buying the region again.
         */
        retryable: row.status === 'failed',
        reusesScrape: isResumable(row),
        costEstimateUsd: row.costEstimateUsd ? Number(row.costEstimateUsd) : null,
        costActualUsd: row.costActualUsd ? Number(row.costActualUsd) : null,
        error: row.error,
        /**
         * When this run pushes itself. Null means held — the countdown is the
         * difference between a run that is waiting for you and one you are
         * merely watching.
         */
        autoPushAt: row.autoPushAt?.toISOString() ?? null,
        /** So the UI can render the hold's full length, not just what's left. */
        holdMs: REVIEW_HOLD_MS,
        /* ── The send queue ────────────────────────────────────────────────
           A run can be entirely ready — scraped, verified, counted down — and
           still not send, because something ahead of it in the queue hasn't.
           That is the one state this panel could otherwise render as "about to
           push" for an hour, so it is answered on the row. */
        queueState: queueStateOf(row),
        position: row.queuePosition,
        skipped: !!row.skippedAt,
        blockedBy: await blockedBy(row).then((b) =>
          b ? { id: b.id, label: `${b.vertical} · ${b.regionLabel ?? b.regionKey}`, status: b.status } : null,
        ),
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        /**
         * How many will actually be emailed. The number on the hold button, and
         * the only thing this procedure still says about the contacts — the
         * roster itself is `runBusinesses`, which pages rather than shipping a
         * sorted slice of the whole set on every four-second poll.
         */
        readyCount: sendable.length,
      };
    }),

  /**
   * The businesses in one run, paginated.
   *
   * The panel above this used to show 200 of them, six fields wide, and only
   * while the run sat at `review`. Everything else we hold about a business —
   * category, address, phone, the verifier's answer, which campaign it went to,
   * what it wrote back — was reachable only by leaving for the Prospects screen
   * and searching by name, one at a time.
   *
   * Reads the candidate set before a push and the prospect rows after it; see
   * businesses.ts for why those are not the same list, and why this pager is
   * offset-based when the prospects list next door is deliberately keyset.
   */
  runBusinesses: superAdminProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
        search: z.string().trim().max(200).optional(),
        cut: z.enum(['all', 'will_send', 'rejected', 'replied', 'yes']).default('all'),
      }),
    )
    .query(({ ctx, input }) =>
      runBusinesses(
        {
          runId: input.runId,
          limit: input.limit,
          offset: input.offset,
          search: input.search || undefined,
          cut: input.cut,
        },
        ctx.db,
      ),
    ),

  listRuns: superAdminProcedure.query(async () => {
    const rows = await listRuns();
    // One grouped count for the whole ledger rather than one per row: the
    // number is what makes "delete this run's prospects" a decision rather than
    // a leap, so it has to be on every row, cheaply.
    const prospectCounts = await countProspectsByRun(rows.map((r) => r.id));
    // Who is actually next. Read from the queue rather than from `rows`,
    // because `rows` is capped at 50 and the run holding everything up may be
    // the oldest one on the page — or off the end of it.
    const head = (await sendQueue()).find((r) => !r.skippedAt) ?? null;
    return rows.map((r) => ({
      id: r.id,
      vertical: r.vertical,
      region: r.regionLabel ?? r.regionKey,
      /** Normalised — what the "already scraped" check has to compare on. */
      regionKey: r.regionKey,
      placeId: r.placeId,
      status: r.status,
      stage: r.stage,
      counts: countsOf(r),
      maxRecords: r.maxRecords,
      capped: isCapped(r),
      /** Retryable for free — see `retryListRun`. */
      retryable: r.status === 'failed',
      reusesScrape: isResumable(r),
      /** Prospect rows still on file from this run — what a purge would delete. */
      prospectCount: prospectCounts.get(r.id) ?? 0,
      /* ── Where this run sits in the send queue ──────────────────────────
         Three states and no fourth: queued, sending, sent. `position` is the
         order it will send in (or did); `skipped` is parked-and-not-blocking;
         `blockedBy` names the run ahead that is holding it up, which is the
         one thing a strict queue owes the person reading it. */
      queueState: queueStateOf(r),
      position: r.queuePosition,
      skipped: !!r.skippedAt,
      blockedBy:
        head && head.id !== r.id && !r.skippedAt && queueStateOf(r) === 'queued'
          ? { id: head.id, label: `${head.vertical} · ${head.regionLabel ?? head.regionKey}` }
          : null,
      autoPushAt: r.autoPushAt?.toISOString() ?? null,
      costActualUsd: r.costActualUsd ? Number(r.costActualUsd) : null,
      costEstimateUsd: r.costEstimateUsd ? Number(r.costEstimateUsd) : null,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    }));
  }),

  /**
   * What has been bought, and what is left.
   *
   * The Sydney basin is 6–9 months of runway at the planned volume, so this is
   * the number that tells the operator when to open Melbourne. It's a surface,
   * not a report.
   *
   * Computed from the polygons the runs were scraped against rather than from
   * matching region names, which is why a whole-metro run now reads as covering
   * the thirty councils inside it. See coverage.ts.
   */
  listCoverage: superAdminProcedure.query(() => coverage()),

  /**
   * Is this region already inside something we bought for this vertical?
   *
   * Asked when the operator picks a region, so the refusal arrives while they
   * are still deciding rather than as an error on the button. Reads the
   * gazetteer only — no geocoder, no geometry — so it is cheap enough to sit on
   * that path. The authoritative check still runs inside `createRun`.
   */
  regionOverlap: superAdminProcedure
    .input(z.object({ vertical: z.string().trim().min(1), placeId: z.string().trim().min(1) }))
    .query(async ({ input }) =>
      coveringParentFor(normaliseVertical(input.vertical), input.placeId),
    ),

  /** Push now, without waiting out the hold. */
  confirmListRun: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const row = await getListRun(input.runId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That run no longer exists.' });
      if (row.status !== 'review') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `This run is ${row.status}, not waiting for review.`,
        });
      }
      if (!row.campaignId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Pick a campaign for this run before pushing it.',
        });
      }
      // "Push now" brings the deadline forward. It does not jump the queue —
      // the order decides who is emailed first, and a button that silently
      // overruled it would make the order advisory. Skipping the blocker is the
      // deliberate way to change your mind, and it is one click away.
      const ahead = await blockedBy(row);
      if (ahead) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            `${ahead.vertical} · ${ahead.regionLabel ?? ahead.regionKey} is ahead of this run in ` +
            `the send queue and hasn't sent yet (${ahead.status}). Move this run up, or skip that one.`,
        });
      }
      await patchRun(row.id, { status: 'pushing', stage: 'pushing', autoPushAt: null });
      await outreachQueue.add('list-build', { runId: row.id }, { removeOnComplete: true });
      return { ok: true };
    }),

  /**
   * Park a run out of the send queue, or put it back.
   *
   * This is what Hold used to be, grown a second job. Hold cleared the
   * auto-push deadline so a run waited for a person indefinitely; that is still
   * exactly what happens, but a held run at the front of a strict queue would
   * hold up everything behind it, so it now steps out of the line as well.
   *
   * Two controls doing almost the same thing was the alternative, and "hold"
   * and "skip" are not a distinction anyone would keep straight at the moment
   * they are deciding who gets emailed tomorrow.
   *
   * Available from the moment a run is created, not only at `review`: the run
   * blocking the queue is often one that is still scraping, and being unable to
   * step it aside until it finished would be the wrong half of the feature.
   */
  skipListRun: superAdminProcedure
    .input(z.object({ runId: z.string().uuid(), skipped: z.boolean() }))
    .mutation(async ({ input }) => {
      const row = await getListRun(input.runId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That run no longer exists.' });
      try {
        const updated = await setRunSkipped(input.runId, input.skipped, REVIEW_HOLD_MS);
        // Unskipping a reviewed run re-arms its five minutes, and five minutes
        // should mean five minutes — the resume sweep would find it eventually,
        // but "eventually" is up to ten.
        if (updated?.autoPushAt) {
          await outreachQueue.add(
            'list-build',
            { runId: row.id },
            { delay: REVIEW_HOLD_MS, removeOnComplete: true, removeOnFail: 50 },
          );
        }
        // Whatever was stuck behind it can now move. Nothing notifies a waiting
        // run that the queue changed, so nudge the whole line rather than
        // leaving them to their twenty-second poll.
        if (input.skipped) await nudgeQueue();
        return {
          skipped: !!updated?.skippedAt,
          autoPushAt: updated?.autoPushAt?.toISOString() ?? null,
        };
      } catch (e) {
        if (e instanceof RunNotQueuedError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: e.message });
        }
        throw e;
      }
    }),

  /**
   * Move a run one place up or down the send queue.
   *
   * One place at a time, because the list is read as an order and the honest
   * gesture for "this one before that one" is a swap. Runs that have sent, or
   * are sending right now, refuse — their place is history.
   */
  moveListRun: superAdminProcedure
    .input(z.object({ runId: z.string().uuid(), delta: z.union([z.literal(-1), z.literal(1)]) }))
    .mutation(async ({ input }) => {
      try {
        await moveRun(input.runId, input.delta);
        await nudgeQueue();
        return { ok: true };
      } catch (e) {
        if (e instanceof RunNotQueuedError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: e.message });
        }
        throw e;
      }
    }),

  /**
   * Delete every prospect a run created — the undo for a run that should not
   * have happened.
   *
   * Enqueued rather than done here: each contact costs up to two Smartlead calls
   * to take out of its campaign first, and a few hundred of those is a minute of
   * work. Progress is readable from `listRunPurge` while it runs.
   */
  deleteRunProspects: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const row = await getListRun(input.runId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That run no longer exists.' });
      const state = await beginPurge(row.id);
      if (!state) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This run is already being cleared.',
        });
      }
      if (state.total === 0) {
        return { ...state, finishedAt: new Date().toISOString() };
      }
      await outreachQueue.add(
        'prospect-purge',
        { runId: row.id },
        { jobId: `prospect-purge-${row.id}`, removeOnComplete: true, removeOnFail: 50 },
      );
      return state;
    }),

  /** Progress of a run's prospect purge. Null when none has been started. */
  listRunPurge: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(({ input }) => readPurge(input.runId)),

  /**
   * Pick a failed run back up, from wherever the money stopped mattering.
   *
   * This is the free half of the pair `supersedeListRun` completes. A run that
   * failed after its scrape landed has a dataset sitting on the provider that
   * costs nothing to re-read, so retrying it is a few cents of re-verification
   * against the ~$15 a fresh scrape would cost — and until this existed the
   * only way forward from a post-scrape failure was to pay that $15 again.
   */
  retryListRun: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        const row = await retryRun(input.runId);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That run no longer exists.' });
        await outreachQueue.add(
          'list-build',
          { runId: row.id },
          { removeOnComplete: true, removeOnFail: 50 },
        );
        return { status: row.status, reusedScrape: row.status === 'running' };
      } catch (e) {
        if (e instanceof RunNotRetryableError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: e.message });
        }
        throw e;
      }
    }),

  /**
   * Retire a run so its region can be scraped again.
   *
   * The escape hatch for the ~1–2%/month of genuinely new businesses a stale
   * region accumulates. Deliberately a separate, explicit act: the uniqueness
   * rule is the only thing standing between us and paying twice, and it should
   * be annoying to bypass.
   */
  supersedeListRun: superAdminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const row = await getListRun(input.runId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That run no longer exists.' });
      if (row.status === 'running' || row.status === 'starting') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'This run is still scraping and still billing. Abort it in the provider console first.',
        });
      }
      await supersedeRun(row.id);
      return { ok: true };
    }),

  /* ── Connect a mailbox ─────────────────────────────────────────────────── */

  /**
   * Add a mailbox to Smartlead by SMTP/IMAP credentials.
   *
   * Smartlead validates the connection synchronously, so a wrong app password
   * fails here rather than silently sending nothing for a week. Its rejection is
   * surfaced verbatim.
   */
  connectMailbox: superAdminProcedure
    .input(
      z.object({
        fromName: z.string().trim().min(1),
        fromEmail: z.string().trim().email(),
        userName: z.string().trim().min(1),
        password: z.string().min(1),
        smtpHost: z.string().trim().min(1),
        smtpPort: z.number().int().positive(),
        imapHost: z.string().trim().min(1),
        imapPort: z.number().int().positive(),
        warmupEnabled: z.boolean().default(true),
        maxEmailPerDay: z.number().int().min(CAP_MIN).max(CAP_MAX).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const policy = await getCapPolicy();
        const result = await addSmtpAccount({
          from_name: input.fromName,
          from_email: input.fromEmail.toLowerCase(),
          user_name: input.userName,
          password: input.password,
          smtp_host: input.smtpHost,
          smtp_port: input.smtpPort,
          imap_host: input.imapHost,
          imap_port: input.imapPort,
          warmup_enabled: input.warmupEnabled,
          max_email_per_day: clampCap(input.maxEmailPerDay ?? policy.global),
          type: 'GMAIL',
        });
        await invalidate(cacheKeys.emailAccounts);
        return { id: result?.id ?? null };
      } catch (e) {
        return rethrow(e);
      }
    }),
});
