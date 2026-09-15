/**
 * Reconcile wire payouts that Wise ALREADY SENT but that our DB still reads as
 * `failed` — and which the hourly leg-2 retry sweep would otherwise pay AGAIN.
 *
 * ── The incident this fixes ──────────────────────────────────────────────────
 * On 2026-07-23 23:55 UTC leg 1 (Stripe -> our Wise-linked bank) funded four
 * payouts. Leg 2 ran at 02:10-02:14 UTC on 2026-07-24 while our Wise AUD balance
 * still held $1, so funding those transfers failed on insufficient balance. The
 * code deployed at the time predated the balance gate (a3edded, authored
 * 2026-07-26, on main from 2026-07-30), so it created the Wise transfers anyway,
 * never persisted `wiseFunding.wiseTransferId`, and treated insufficient-balance
 * as a hard `failed`. The AUD credits landed at 07:28 and every one of those
 * already-created transfers was funded and sent.
 *
 * The rows could never heal: `transaction_id` held the STRIPE payout id instead of
 * the Wise transfer id, and `markPayoutReceived` keys off `transaction_id`, so the
 * Wise `outgoing_payment_sent` webhook had nothing to match.
 *
 * And they are actively dangerous. `retryFundedWiseLeg2` selects
 * `status IN ('processingByWire','failed') AND wiseFunding->>'status' = 'funded'`,
 * which they match; with no `wiseTransferId` recorded they take the FIRST-SEND
 * path, so the only thing preventing a duplicate payment is the balance gate. The
 * moment the Wise AUD balance rises above the payout amount, the sweep would mint
 * brand new transfers and pay the contractor twice.
 *
 * ── What this script does ────────────────────────────────────────────────────
 * It does NOT trust a hardcoded list. For every at-risk payout (`failed` +
 * `wiseFunding.status = 'funded'` + no `wiseTransferId`) it goes to the live Wise
 * API and only reconciles when the evidence is unambiguous:
 *
 *   1. list Wise transfers created within TRANSFER_WINDOW_S of the payout's
 *      `updated_at` (the leg-2 attempt that created the transfer),
 *   2. keep those paying the beneficiary's own wire recipient id, in the payout's
 *      source currency, whose state is `outgoing_payment_sent`,
 *   3. require the transfer to appear as a DEBIT on our balance statement whose
 *      absolute value equals the payout amount to the cent — the money that
 *      actually left our balance must equal what we owed,
 *   4. require EXACTLY ONE surviving candidate.
 *
 * Anything ambiguous is skipped and reported, never guessed. The statement debit
 * also supplies the true `completely_paid_at` (its `referenceNumber` is
 * `TRANSFER-<id>`), so the timestamp is observed rather than inferred.
 *
 * It then writes the terminal state the webhook would have written
 * (`dispatch.markPayoutReceived`: status `paid`, paid_amount = amount,
 * completely_paid_at) and records the real transfer id in BOTH places that matter:
 *   • `transaction_id`             — a webhook redelivery now matches and no-ops.
 *   • `wiseFunding.wiseTransferId` — defence in depth: if anything ever revives
 *                                    the row, `dispatchWiseLeg2` takes the
 *                                    idempotent re-fund path, never a new send.
 * Breakdown `paid_at` stamps are already correct and are left alone.
 *
 * Idempotent: reconciled rows leave the `failed` pool, so a re-run finds nothing.
 *
 * Usage (note --conditions development, else tsx runs the stale server-shared dist):
 *   npx tsx --conditions development src/scripts/reconcile-sent-wise-payouts.ts --prod
 *   npx tsx --conditions development src/scripts/reconcile-sent-wise-payouts.ts --prod --yes
 */
import './env-setup.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const APPLY = process.argv.includes('--yes');
const IS_PROD = process.argv.includes('--prod');
const IS_STAGE = process.argv.includes('--stage');

/** How far from the leg-2 attempt (`payout.updated_at`) a transfer may have been created. */
const TRANSFER_WINDOW_S = 120;
/** How far after the attempt to search the balance statement for the debit. */
const STATEMENT_LOOKAHEAD_DAYS = 30;
/**
 * The winning transfer must have been created within this many seconds of the
 * payout's leg-2 attempt. The attempt stamped `updated_at` immediately after
 * creating its transfer, so the true pair is ~1s apart.
 */
const NEAREST_MAX_S = 15;
/**
 * ...and the runner-up must be at least this much further away, so a batch of
 * same-amount transfers to the same recipient is only ever split when the timing
 * is decisive. Below this margin the script refuses and asks for a human.
 */
const RUNNERUP_MARGIN_S = 10;

/* ── Config ──────────────────────────────────────────────────────────────── */
// `env-setup` loads .env.prod / .env.stage / .env, none of which are committed.
// The Railway env files are the sole committed source of config, so fall back to
// them (see the `single client env` / `central env module` conventions).
const railwayEnvFile = resolve(
  repoRoot,
  IS_PROD
    ? '.railway/envs/shared.production.env'
    : IS_STAGE
      ? '.railway/envs/shared.staging.env'
      : '.railway/envs/shared.development.env',
);
const railwayEnv = existsSync(railwayEnvFile)
  ? readFileSync(railwayEnvFile, 'utf8')
  : '';

function envValue(key: string): string {
  if (process.env[key]) return process.env[key] as string;
  return railwayEnv.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm'))?.[1] ?? '';
}

const DATABASE_URL = envValue('DATABASE_URL');
const WISE_API_TOKEN = envValue('WISE_API_TOKEN');
const WISE_PROFILE_ID = envValue('WISE_PROFILE_ID');
if (!DATABASE_URL) throw new Error('DATABASE_URL not resolved');
if (!WISE_API_TOKEN || !WISE_PROFILE_ID)
  throw new Error('WISE_API_TOKEN / WISE_PROFILE_ID not resolved');

// Wise is sandboxed everywhere except production, matching payout-providers.ts.
const WISE_BASE = IS_PROD
  ? 'https://api.transferwise.com'
  : 'https://api.sandbox.transferwise.tech';
const wiseHeaders = { Authorization: `Bearer ${WISE_API_TOKEN}` };

console.log('db   :', DATABASE_URL.replace(/:[^@:]+@/, ':***@'));
console.log('wise :', WISE_BASE, 'profile', WISE_PROFILE_ID);
console.log(
  APPLY
    ? '\n⚡ LIVE MODE — reconciliations will be committed\n'
    : '\n🔍 DRY RUN — pass --yes to apply\n',
);

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

/* ── Wise helpers ────────────────────────────────────────────────────────── */
interface WiseTransfer {
  id: number;
  status?: { current?: string } | string;
  sourceValue?: number;
  sourceCurrency?: string;
  targetValue?: number;
  targetCurrency?: string;
  targetAccount?: number;
  created?: string;
}

const transferState = (t: WiseTransfer): string =>
  typeof t.status === 'string' ? t.status : (t.status?.current ?? '');

/**
 * Wise timestamps, as epoch ms. `/v1/transfers` returns `created` as
 * "2026-07-24 02:10:12" — UTC, but with no zone marker, which `new Date()` would
 * read as machine-local time (a silent hours-wide skew on a non-UTC box). Other
 * endpoints return proper ISO-8601. Normalise the bare form to UTC.
 */
function wiseTime(s: string | undefined): number {
  if (!s) return NaN;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(hasZone ? s : `${s.replace(' ', 'T')}Z`).getTime();
}

async function wiseGet<T>(path: string): Promise<T> {
  const res = await fetch(`${WISE_BASE}${path}`, { headers: wiseHeaders });
  if (!res.ok)
    throw new Error(`Wise GET ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

async function transfersCreatedNear(at: Date): Promise<WiseTransfer[]> {
  const start = new Date(at.getTime() - TRANSFER_WINDOW_S * 1000);
  const end = new Date(at.getTime() + TRANSFER_WINDOW_S * 1000);
  return wiseGet<WiseTransfer[]>(
    `/v1/transfers?profile=${WISE_PROFILE_ID}&limit=50` +
      `&createdDateStart=${start.toISOString()}&createdDateEnd=${end.toISOString()}`,
  );
}

interface StatementDebit {
  transferId: string;
  sentAt: string;
  /** Absolute AUD value that left our balance (payout amount incl. Wise fee). */
  debited: number;
  received?: string;
}

/**
 * DEBITs on our `currency` balance in [from, to], indexed by Wise transfer id.
 * The statement's `referenceNumber` is `TRANSFER-<id>`, which is what lets us tie
 * a send to an exact timestamp and an exact amount.
 */
async function statementDebits(
  currency: string,
  from: Date,
  to: Date,
): Promise<Map<string, StatementDebit>> {
  const balances = await wiseGet<Array<{ id: number; currency: string }>>(
    `/v4/profiles/${WISE_PROFILE_ID}/balances?types=STANDARD`,
  );
  const balance = balances.find(
    (b) => b.currency?.toUpperCase() === currency.toUpperCase(),
  );
  const out = new Map<string, StatementDebit>();
  if (!balance) return out;
  const st = await wiseGet<{
    transactions?: Array<{
      type?: string;
      date?: string;
      amount?: { value?: number };
      referenceNumber?: string;
      exchangeDetails?: { toAmount?: { value?: number; currency?: string } };
    }>;
  }>(
    `/v1/profiles/${WISE_PROFILE_ID}/balance-statements/${balance.id}/statement.json` +
      `?currency=${currency}&intervalStart=${from.toISOString()}` +
      `&intervalEnd=${to.toISOString()}&type=COMPACT`,
  );
  for (const t of st.transactions ?? []) {
    const ref = t.referenceNumber ?? '';
    if (t.type !== 'DEBIT' || !ref.startsWith('TRANSFER-')) continue;
    const to2 = t.exchangeDetails?.toAmount;
    out.set(ref.slice('TRANSFER-'.length), {
      transferId: ref.slice('TRANSFER-'.length),
      sentAt: t.date ?? '',
      debited: Math.abs(t.amount?.value ?? 0),
      received: to2?.value ? `${to2.value} ${to2.currency}` : undefined,
    });
  }
  return out;
}

/* ── 1. Find the at-risk payouts ─────────────────────────────────────────── */
type Row = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  transaction_id: string | null;
  updated_at: Date;
  wise_funding: Record<string, unknown> | null;
  beneficiary_email: string | null;
  recipient_id: string | null;
};

const atRisk = (await sql`
  SELECT p.id,
         p.amount::text        AS amount,
         p.currency,
         p.status,
         p.transaction_id,
         p.updated_at,
         p.wise_funding,
         u.email               AS beneficiary_email,
         COALESCE(
           u.payout_methods -> 'wire' ->> 'recipientId',
           a.payout_methods -> 'wire' ->> 'recipientId'
         )                     AS recipient_id
    FROM payouts p
    LEFT JOIN users    u ON u.id = p.beneficiary_id
    LEFT JOIN agencies a ON a.id = p.beneficiary_agency_id
   WHERE p.status = 'failed'
     AND p.wise_funding ->> 'status' = 'funded'
     AND p.wise_funding ->> 'wiseTransferId' IS NULL
   ORDER BY p.updated_at`) as unknown as Row[];

console.log(`at-risk payouts (failed + funded + no wiseTransferId): ${atRisk.length}`);
if (!atRisk.length) {
  console.log('nothing to reconcile.');
  await sql.end();
  process.exit(0);
}
for (const r of atRisk)
  console.log(
    `  ${r.id}  ${r.amount} ${r.currency}  txn=${r.transaction_id}  ` +
      `leg2Attempt=${r.updated_at.toISOString()}  recipient=${r.recipient_id ?? '(none)'}`,
  );

/* ── 2. Verify each against Wise ─────────────────────────────────────────── */
const times = atRisk.map((r) => r.updated_at.getTime());
const debits = await statementDebits(
  atRisk[0].currency,
  new Date(Math.min(...times) - TRANSFER_WINDOW_S * 1000),
  new Date(Math.max(...times) + STATEMENT_LOOKAHEAD_DAYS * 86_400_000),
);
console.log(`\nstatement debits indexed: ${debits.size}`);

interface Plan {
  row: Row;
  transferId: string;
  sentAt: string;
  received?: string;
  gapS: number;
}
const plans: Plan[] = [];
const skipped: Array<{ row: Row; why: string }> = [];

for (const row of atRisk) {
  if (!row.recipient_id) {
    skipped.push({ row, why: 'beneficiary has no wire recipientId' });
    continue;
  }
  const candidates = (await transfersCreatedNear(row.updated_at)).filter(
    (t) =>
      String(t.targetAccount) === String(row.recipient_id) &&
      (t.sourceCurrency ?? '').toUpperCase() === row.currency.toUpperCase() &&
      transferState(t) === 'outgoing_payment_sent',
  );
  // The debit that left our balance must equal what we owed, to the cent.
  const matched = candidates.filter((t) => {
    const d = debits.get(String(t.id));
    return d && Math.abs(d.debited - Number(row.amount)) < 0.005;
  });
  if (!matched.length) {
    skipped.push({
      row,
      why:
        'no sent transfer whose balance debit equals the payout amount' +
        ` (${candidates.length} sent transfer(s) to the recipient in the window)`,
    });
    continue;
  }
  // A weekly run pays several identical amounts to the same recipient, so amount
  // alone can't split them. Timing can: each payout's own leg-2 attempt created
  // its transfer and then immediately stamped `updated_at`, so the true pair is
  // ~1s apart while its siblings are tens of seconds away. Demand that the
  // nearest candidate is both close AND clearly closer than the runner-up.
  const byNearest = matched
    .map((t) => ({
      t,
      gapS: Math.abs(wiseTime(t.created) - row.updated_at.getTime()) / 1000,
    }))
    .sort((a, b) => a.gapS - b.gapS);
  const best = byNearest[0];
  const runnerUp = byNearest[1];
  if (best.gapS > NEAREST_MAX_S) {
    skipped.push({
      row,
      why: `nearest sent transfer was created ${best.gapS.toFixed(1)}s from the leg-2 attempt (max ${NEAREST_MAX_S}s)`,
    });
    continue;
  }
  if (runnerUp && runnerUp.gapS - best.gapS < RUNNERUP_MARGIN_S) {
    skipped.push({
      row,
      why:
        `ambiguous timing — transfers ${best.t.id} (${best.gapS.toFixed(1)}s) and ` +
        `${runnerUp.t.id} (${runnerUp.gapS.toFixed(1)}s) are within ${RUNNERUP_MARGIN_S}s of each other`,
    });
    continue;
  }
  const d = debits.get(String(best.t.id))!;
  plans.push({
    row,
    transferId: String(best.t.id),
    sentAt: d.sentAt,
    received: d.received,
    gapS: best.gapS,
  });
}

// Two payouts must never claim the same transfer — that would mark one row paid
// against money that actually settled a different row, hiding a real send.
const claims = new Map<string, string[]>();
for (const p of plans)
  claims.set(p.transferId, [...(claims.get(p.transferId) ?? []), p.row.id]);
for (const [transferId, owners] of claims) {
  if (owners.length < 2) continue;
  for (const id of owners) {
    const i = plans.findIndex((p) => p.row.id === id);
    if (i === -1) continue;
    skipped.push({
      row: plans[i].row,
      why: `transfer ${transferId} was claimed by ${owners.length} payouts (${owners.join(', ')})`,
    });
    plans.splice(i, 1);
  }
}

console.log(`\n=== verified as ALREADY SENT — will reconcile (${plans.length}) ===`);
for (const p of plans)
  console.log(
    `  ${p.row.id}  ${p.row.amount} ${p.row.currency}  ->  transfer ${p.transferId}` +
      `  (created ${p.gapS.toFixed(1)}s from the leg-2 attempt)` +
      `  sent ${p.sentAt}  recipient got ${p.received ?? '?'}`,
  );
if (skipped.length) {
  console.log(`\n=== SKIPPED — needs a human (${skipped.length}) ===`);
  for (const s of skipped) console.log(`  ${s.row.id}  ${s.row.amount}: ${s.why}`);
}

if (!plans.length || !APPLY) {
  if (!APPLY) console.log('\nDRY RUN — re-run with --yes to apply.');
  await sql.end();
  process.exit(0);
}

/* ── 3. Apply ────────────────────────────────────────────────────────────── */
// Outside the repo on purpose: the snapshot holds live payout rows, and the repo
// root is not gitignored for it — one `git add -A` would commit prod financials.
const snapshotPath = resolve(
  tmpdir(),
  `payouts-wise-recon-snapshot-${Math.max(...times)}.json`,
);
writeFileSync(
  snapshotPath,
  JSON.stringify(
    plans.map((p) => ({ plan: p.transferId, before: p.row })),
    null,
    2,
  ),
);
console.log('\nrollback snapshot →', snapshotPath);

let done = 0;
for (const p of plans) {
  // Guarded on `failed` so a concurrent sweep or a re-run can't double-apply.
  const updated = await sql`
    UPDATE payouts
       SET status             = 'paid',
           paid_amount        = amount,
           completely_paid_at = ${p.sentAt}::timestamptz,
           transaction_id     = ${p.transferId},
           wise_funding       = COALESCE(wise_funding, '{}'::jsonb)
                                  || jsonb_build_object(
                                       'status', 'transferring',
                                       'wiseTransferId', ${p.transferId}::text
                                     ),
           updated_at         = now()
     WHERE id = ${p.row.id}
       AND status = 'failed'
   RETURNING id, status, paid_amount::text AS paid_amount, transaction_id,
             completely_paid_at`;
  if (!updated.length) {
    console.log(`  ! ${p.row.id} no longer 'failed' — skipped`);
    continue;
  }
  done++;
  const u = updated[0];
  console.log(
    `  ✓ ${u.id} → ${u.status} paid=${u.paid_amount} txn=${u.transaction_id}` +
      ` at ${u.completely_paid_at?.toISOString?.() ?? u.completely_paid_at}`,
  );
}
console.log(`\nreconciled ${done}/${plans.length}.`);

const stillAtRisk = await sql`
  SELECT id, amount::text AS amount FROM payouts
   WHERE status IN ('processingByWire', 'failed')
     AND wise_funding ->> 'status' = 'funded'
     AND wise_funding ->> 'wiseTransferId' IS NULL`;
console.log(
  stillAtRisk.length
    ? `⚠ still exposed to a duplicate send: ${stillAtRisk.map((r) => `${r.id} (${r.amount})`).join(', ')}`
    : '✓ no payout is exposed to a duplicate leg-2 send.',
);

await sql.end();
