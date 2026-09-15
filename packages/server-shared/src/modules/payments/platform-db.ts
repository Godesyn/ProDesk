/**
 * Payments (EziQuotes) — platform-wide (super-admin) analytics queries, ported
 * from the export's server/platformDb.ts. "Platform" here means the payments
 * product's admin dashboard (GMV, activity, finance, growth) — not Manus glue —
 * so it's kept, rewritten against the payment_* tables:
 *   payments → payment_transactions, proposals → payment_proposals,
 *   accounts → payment_accounts (joined on brand_id).
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';

// Get daily GMV for the last N days
export async function getPlatformDailyGmv(days = 30): Promise<{ date: string; total: number }[]> {
  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(paid_at, 'YYYY-MM-DD') AS date,
      SUM(amount_cents) AS total
    FROM payment_transactions
    WHERE status = 'succeeded'
      AND paid_at >= NOW() - (${days} || ' days')::interval
    GROUP BY TO_CHAR(paid_at, 'YYYY-MM-DD')
    ORDER BY date ASC
  `);
  return (rows as unknown as any[]).map((r) => ({
    date: String(r.date),
    total: Number(r.total) || 0,
  }));
}

// Get recent platform-wide activity events
export async function getRecentPlatformActivity(limit = 20): Promise<{
  time: string;
  account: string;
  action: string;
  amount: string;
}[]> {
  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(p.created_at, 'HH24:MI') AS time,
      a.business_name AS account,
      CASE p.status::text
        WHEN 'succeeded' THEN 'Payment received'
        WHEN 'pending'   THEN 'Payment pending'
        ELSE 'Payment failed'
      END AS action,
      '$' || TO_CHAR(p.amount_cents / 100.0, 'FM999,999,990.00') AS amount
    FROM payment_transactions p
    LEFT JOIN payment_proposals pr ON pr.id = p.proposal_id
    LEFT JOIN payment_accounts a ON a.brand_id = p.brand_id
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `);
  return (rows as unknown as any[]).map((r) => ({
    time: String(r.time || ''),
    account: String(r.account || ''),
    action: String(r.action || ''),
    amount: String(r.amount || ''),
  }));
}

// Get platform-wide finance overview
export async function getPlatformFinanceOverview(): Promise<{
  totalGmv: number;
  totalPayments: number;
  avgOrderValue: number;
  activeAccounts: number;
}> {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END), 0) AS total_gmv,
      COUNT(CASE WHEN status = 'succeeded' THEN 1 END) AS total_payments,
      COALESCE(AVG(CASE WHEN status = 'succeeded' THEN amount_cents END), 0) AS avg_order_value,
      (SELECT COUNT(DISTINCT brand_id) FROM payment_proposals WHERE status IN ('sent', 'accepted', 'paid')) AS active_accounts
    FROM payment_transactions
  `);
  const r = (rows as unknown as any[])[0] || {};
  return {
    totalGmv: Number(r.total_gmv) || 0,
    totalPayments: Number(r.total_payments) || 0,
    avgOrderValue: Number(r.avg_order_value) || 0,
    activeAccounts: Number(r.active_accounts) || 0,
  };
}

// Get platform-wide growth analytics
export async function getPlatformGrowthAnalytics(): Promise<{
  newAccountsThisMonth: number;
  proposalsSentThisMonth: number;
  conversionRate: number;
  churnRate: number;
}> {
  const rows = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM payment_accounts WHERE created_at >= DATE_TRUNC('month', NOW())) AS new_accounts,
      (SELECT COUNT(*) FROM payment_proposals WHERE created_at >= DATE_TRUNC('month', NOW())) AS proposals_sent,
      (SELECT COUNT(*) FROM payment_proposals WHERE status IN ('accepted', 'paid') AND created_at >= DATE_TRUNC('month', NOW())) AS accepted_proposals
  `);
  const r = (rows as unknown as any[])[0] || {};
  const sent = Number(r.proposals_sent) || 0;
  const accepted = Number(r.accepted_proposals) || 0;
  return {
    newAccountsThisMonth: Number(r.new_accounts) || 0,
    proposalsSentThisMonth: sent,
    conversionRate: sent > 0 ? Math.round((accepted / sent) * 100) : 0,
    churnRate: 0,
  };
}
