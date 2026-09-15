import { inArray } from 'drizzle-orm';
import { payouts, payoutBreakdowns, users, agencies, projects } from '../../db/schema.js';

/**
 * The three disbursement-readiness checkpoints surfaced in the payout/invoice
 * status tooltip, mirroring Flutter `_PayoutStatusCell`
 * (earnings_payout_tile.dart:471-516):
 *   • bankAccountLinked — beneficiary has a linked payout account
 *   • payoutDateReached — now is past `toPayAt`
 *   • projectCompleted  — the payout's first breakdown project is `completed`
 * These gate disbursement in the payout cron, so surfacing them lets the payee
 * see exactly what is (or isn't) blocking a payout.
 */
export interface PayoutReadiness {
  bankAccountLinked: boolean;
  payoutDateReached: boolean;
  projectCompleted: boolean;
  toPayAt: Date | null;
  /**
   * False when the payout has NO breakdown items at all — dispatch pays the sum
   * of eligible items, so such a payout can never disburse. The UI shows these
   * as "Stopped" instead of a forever-pending status.
   */
  hasBreakdowns: boolean;
}

/**
 * Attach the readiness checkpoints to a set of payout-shaped rows (id +
 * beneficiaryId + toPayAt). Used directly by the payouts router; invoices reuse
 * it via {@link readinessForPayoutIds}.
 */
export async function enrichReadiness<
  T extends { id: string; beneficiaryId: string | null; beneficiaryAgencyId?: string | null; toPayAt: Date | null },
>(
  db: any,
  rows: T[],
): Promise<(T & PayoutReadiness)[]> {
  if (rows.length === 0) return [];
  const now = Date.now();
  const payoutIds = rows.map((r) => r.id);

  // Agency beneficiaries: an agency-received payout is "linked" only when the
  // agency has linked its OWN connected account (no owner fall-back — see
  // dispatch.resolvePayoutRecipient).
  const agencyIds = [...new Set(rows.map((r) => r.beneficiaryAgencyId).filter(Boolean))] as string[];
  const agencyRows = agencyIds.length
    ? await db
        .select({ id: agencies.id, bankAccountLinked: agencies.bankAccountLinked, stripeAccountId: agencies.stripeAccountId })
        .from(agencies)
        .where(inArray(agencies.id, agencyIds))
    : [];
  const agencyLinkedById = new Map<string, boolean>(
    agencyRows.map((a: any) => [a.id, !!a.bankAccountLinked || !!a.stripeAccountId]),
  );

  const beneIds = [...new Set(rows.map((r) => r.beneficiaryId).filter(Boolean))] as string[];
  const beneRows = beneIds.length
    ? await db.select({ id: users.id, bankAccountLinked: users.bankAccountLinked }).from(users).where(inArray(users.id, beneIds))
    : [];
  const linkedByUser = new Map<string, boolean>(beneRows.map((u: any) => [u.id, !!u.bankAccountLinked]));

  // First breakdown project per payout (the Flutter tile checks breakdown.first).
  const bdRows = await db
    .select({ payoutId: payoutBreakdowns.payoutId, projectId: payoutBreakdowns.projectId })
    .from(payoutBreakdowns)
    .where(inArray(payoutBreakdowns.payoutId, payoutIds));
  const firstProjectByPayout = new Map<string, string>();
  const payoutsWithBreakdowns = new Set<string>();
  for (const b of bdRows) {
    payoutsWithBreakdowns.add(b.payoutId);
    if (b.projectId && !firstProjectByPayout.has(b.payoutId)) firstProjectByPayout.set(b.payoutId, b.projectId);
  }
  const projIds = [...new Set([...firstProjectByPayout.values()])];
  const projRows = projIds.length
    ? await db.select({ id: projects.id, status: projects.status }).from(projects).where(inArray(projects.id, projIds))
    : [];
  const statusByProject = new Map<string, string>(projRows.map((p: any) => [p.id, p.status]));

  return rows.map((r) => {
    const projId = firstProjectByPayout.get(r.id);
    return {
      ...r,
      bankAccountLinked: r.beneficiaryAgencyId
        ? (agencyLinkedById.get(r.beneficiaryAgencyId) ?? false)
        : r.beneficiaryId
          ? (linkedByUser.get(r.beneficiaryId) ?? false)
          : false,
      payoutDateReached: r.toPayAt ? now > new Date(r.toPayAt).getTime() : false,
      projectCompleted: projId ? statusByProject.get(projId) === 'completed' : false,
      hasBreakdowns: payoutsWithBreakdowns.has(r.id),
    };
  });
}

/**
 * Resolve readiness for a set of payout ids, keyed by payout id. Invoices carry
 * an optional `payoutId`; this lets the invoice views show the same readiness
 * checkpoints as the payout views for the connected payout.
 */
export async function readinessForPayoutIds(db: any, payoutIds: (string | null | undefined)[]): Promise<Map<string, PayoutReadiness>> {
  const ids = [...new Set(payoutIds.filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: payouts.id, beneficiaryId: payouts.beneficiaryId, beneficiaryAgencyId: payouts.beneficiaryAgencyId, toPayAt: payouts.toPayAt })
    .from(payouts)
    .where(inArray(payouts.id, ids));
  const enriched = await enrichReadiness(db, rows);
  return new Map(
    enriched.map((e) => [
      e.id,
      { bankAccountLinked: e.bankAccountLinked, payoutDateReached: e.payoutDateReached, projectCompleted: e.projectCompleted, toPayAt: e.toPayAt, hasBreakdowns: e.hasBreakdowns },
    ]),
  );
}
