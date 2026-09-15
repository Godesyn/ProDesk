/**
 * Wind down every recurring project: freeze the cycle, close the project, and
 * stop the money that has not moved yet. Reversible from one snapshot.
 *
 * Three changes, applied together in a single transaction:
 *
 *   1. `projects.next_cycle_at → NULL`. All three cycle entry points bail on a
 *      null boundary (`onRecurringProjectCompleted` returns early,
 *      `reconcileDueProjects` filters `isNotNull`, and `runProjectCycle`
 *      re-reads the row when its delayed job fires and reports `not-due`), so a
 *      frozen project stays where it is and any job already armed in Redis is
 *      neutralised without having to drain the queue.
 *
 *   2. `projects.status → 'completed'`. This is the state the wind-down is for.
 *      It must land in the SAME transaction as (1): `runProjectCycle` ignores a
 *      project unless its status is `completed`/`upcoming`, so a project
 *      completed while still armed would become re-cyclable in that window.
 *
 *      Written directly rather than through `completeProject`, which is the
 *      interactive path: it also auto-approves outstanding deliverables, copies
 *      them into the brand document locker, and emails the dev inbox per
 *      project. None of that belongs in a bulk administrative close. The cost
 *      is that open browser tabs miss the realtime ping and show stale cards
 *      until refreshed, and that deliverables stay `pending` on a closed
 *      project — harmless, since completion already locks them
 *      (`assertDeliverableUnlocked`).
 *
 *   3. `payouts.status → 'stopped'` on the outstanding payouts of those
 *      projects. Freezing alone does NOT hold the money: an internal project
 *      dispatches its payouts on completion (`dispatchProjectPayoutsNow`), and
 *      the completion gate's terminal-cycle branch (`cycleCount === cycle` and
 *      status completed) makes the cut eligible even with no re-cycle.
 *      `stopped` is refused by `dispatchPayout`, which early-returns on any
 *      status but `pending`.
 *
 *      `stopped` rather than the existing `voidProjectPendingPayouts`, which
 *      deletes the breakdown rows and parks the payout in `failed` — a state
 *      the weekly cron actively retries. Their linked invoices need no separate
 *      write: invoice status is derived from the payout (docs/invoices.md §7),
 *      so they read `stopped` the moment the payout does.
 *
 * Nothing here reimburses anyone. Refunds live on the delete path
 * (`finalizeSoftDelete` → `refundProjectPool`), which this never touches, and
 * payouts that have already moved money are refused rather than stopped.
 *
 * Idempotent: it targets only projects not already in the end state, and only
 * payouts still in `upcoming`/`pending`. Re-running it is a no-op.
 *
 * Requires migration 0110 (the `stopped` enum value) to be applied first.
 *
 *   npx tsx --conditions development src/scripts/freeze-recurring-projects.ts --prod
 *   npx tsx --conditions development src/scripts/freeze-recurring-projects.ts --prod --yes
 *   npx tsx --conditions development src/scripts/freeze-recurring-projects.ts --prod --undo=<snapshot.json>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const APPLY = process.argv.includes('--yes');
const IS_PROD = process.argv.includes('--prod');
const IS_STAGE = process.argv.includes('--stage');
const UNDO = process.argv.find((a) => a.startsWith('--undo='))?.slice(7);

const RECURRING_TYPES = ['recurringService', 'recurringProductShips'];
const STOPPABLE_FROM = ['upcoming', 'pending'];

const railwayEnvFile = resolve(
  repoRoot,
  IS_PROD
    ? '.railway/envs/shared.production.env'
    : IS_STAGE
      ? '.railway/envs/shared.staging.env'
      : '.railway/envs/shared.development.env',
);
const railwayEnv = existsSync(railwayEnvFile) ? readFileSync(railwayEnvFile, 'utf8') : '';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  railwayEnv.match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1] ??
  '';
if (!DATABASE_URL) throw new Error('DATABASE_URL not resolved');

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
console.log('db  :', DATABASE_URL.replace(/:[^@:]+@/, ':***@'));
console.log('env :', IS_PROD ? 'PRODUCTION' : IS_STAGE ? 'staging' : 'development');

type ProjectSnap = { id: string; next_cycle_at: string | null; status: string };
type PayoutSnap = { id: string; status: string };
type Snapshot = { projects: ProjectSnap[]; payouts: PayoutSnap[] };

async function undo(path: string) {
  const snap = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  console.log(`\nrestoring ${snap.projects.length} projects and ${snap.payouts.length} payouts from ${path}`);
  if (!APPLY) {
    console.log('\nDRY RUN. Pass --yes to apply.');
    for (const p of snap.projects) console.log(`  project ${p.id} → ${p.status}, next ${p.next_cycle_at ?? 'null'}`);
    for (const p of snap.payouts) console.log(`  payout  ${p.id} status → ${p.status}`);
    return;
  }
  await sql.begin(async (tx) => {
    for (const p of snap.projects) {
      await tx`
        update projects
        set next_cycle_at = ${p.next_cycle_at}, status = ${p.status}::project_status, updated_at = now()
        where id = ${p.id}`;
    }
    for (const p of snap.payouts) {
      await tx`update payouts set status = ${p.status}::payout_status, updated_at = now() where id = ${p.id} and status = 'stopped'`;
    }
  });
  console.log('restored.');
}

if (UNDO) {
  await undo(UNDO);
  await sql.end();
  process.exit(0);
}

const [{ exists: enumReady }] = await sql`
  select exists(
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'payout_status' and e.enumlabel = 'stopped'
  ) as exists`;
if (!enumReady && APPLY) {
  throw new Error("payout_status has no 'stopped' value — apply migration 0110 first");
}
if (!enumReady) console.log("note : payout_status has no 'stopped' value yet (migration 0110 not applied)");

/** Every live recurring project, whether or not it still needs changing. */
const allRecurring = await sql<{ id: string }[]>`
  select id from projects
  where deleted_at is null and service_type = any(${RECURRING_TYPES})`;
const allRecurringIds = allRecurring.map((p) => p.id);

/** The subset not already frozen AND completed — the only rows we write. */
const targetProjects = await sql<
  {
    id: string;
    service_name: string | null;
    status: string;
    cycle_count: number;
    next_cycle_at: string | null;
  }[]
>`
  select id, service_name, status, cycle_count, next_cycle_at
  from projects
  where deleted_at is null
    and service_type = any(${RECURRING_TYPES})
    and (next_cycle_at is not null or status <> 'completed')
  order by next_cycle_at nulls last`;

const candidatePayouts = allRecurringIds.length
  ? await sql<
      {
        id: string;
        status: string;
        amount: string;
        paid_amount: string;
        currency: string;
        transaction_id: string | null;
        wise_status: string | null;
        beneficiary: string | null;
        invoices: number;
      }[]
    >`
      select p.id, p.status, p.amount, p.paid_amount, p.currency, p.transaction_id,
             p.wise_funding->>'status' as wise_status,
             coalesce(u.email, a.business_name) as beneficiary,
             count(distinct i.id)::int as invoices
      from payouts p
      join payout_breakdowns b on b.payout_id = p.id
      left join users u on u.id = p.beneficiary_id
      left join agencies a on a.id = p.beneficiary_agency_id
      left join invoices i on i.payout_id = p.id
      where p.status = any(${STOPPABLE_FROM})
        and b.project_id = any(${allRecurringIds})
      group by p.id, u.email, a.business_name
      order by p.created_at`
  : [];

const unsafe = candidatePayouts.filter(
  (p) => Number(p.paid_amount) > 0 || p.transaction_id || p.wise_status,
);
const stoppable = candidatePayouts.filter((p) => !unsafe.includes(p));

console.log(`\n=== PROJECTS TO FREEZE + COMPLETE (${targetProjects.length} of ${allRecurringIds.length} live recurring) ===`);
for (const p of targetProjects) {
  console.log(
    `  ${p.id}  ${p.status.padEnd(11)} → completed  cycle ${p.cycle_count}  next ${p.next_cycle_at ?? 'null'}  ${p.service_name ?? ''}`,
  );
}

console.log(`\n=== PAYOUTS TO STOP (${stoppable.length}) ===`);
let total = 0;
let invoiceCount = 0;
for (const p of stoppable) {
  total += Number(p.amount);
  invoiceCount += p.invoices;
  console.log(
    `  ${p.id}  ${p.status.padEnd(9)} ${p.currency} ${p.amount.padStart(9)}  ${String(p.invoices).padStart(2)} inv  ${p.beneficiary ?? ''}`,
  );
}
console.log(`  total ${total.toFixed(2)} across ${invoiceCount} linked invoices (their status follows the payout)`);

if (unsafe.length) {
  console.log(`\n=== REFUSED (${unsafe.length}) — money already moved, reconcile by hand ===`);
  for (const p of unsafe) {
    console.log(`  ${p.id}  paid ${p.paid_amount}  txn ${p.transaction_id ?? '-'}  wise ${p.wise_status ?? '-'}`);
  }
}

if (!targetProjects.length && !stoppable.length) {
  console.log('\nNothing to do.');
  await sql.end();
  process.exit(0);
}

if (!APPLY) {
  console.log('\nDRY RUN. Pass --yes to apply.');
  await sql.end();
  process.exit(0);
}

const snapshot: Snapshot = {
  projects: targetProjects.map((p) => ({ id: p.id, next_cycle_at: p.next_cycle_at, status: p.status })),
  payouts: stoppable.map((p) => ({ id: p.id, status: p.status })),
};
// The environment belongs in the name. Keyed on row counts alone, a production
// run silently overwrote the staging snapshot of the same shape, which is the
// one file you need if the run has to be reversed.
const envTag = IS_PROD ? 'production' : IS_STAGE ? 'staging' : 'development';
const snapshotPath = resolve(
  tmpdir(),
  `freeze-recurring-snapshot-${envTag}-${snapshot.projects.length}-${snapshot.payouts.length}.json`,
);
writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
console.log('\nrollback snapshot →', snapshotPath);

await sql.begin(async (tx) => {
  if (snapshot.projects.length) {
    await tx`
      update projects set next_cycle_at = null, status = 'completed', updated_at = now()
      where id = any(${snapshot.projects.map((p) => p.id)})`;
  }
  if (snapshot.payouts.length) {
    await tx`
      update payouts set status = 'stopped', updated_at = now()
      where id = any(${snapshot.payouts.map((p) => p.id)})
        and status = any(${STOPPABLE_FROM})`;
  }
});

const [{ unfrozen }] = await sql`
  select count(*)::int as unfrozen from projects
  where deleted_at is null and service_type = any(${RECURRING_TYPES})
    and (next_cycle_at is not null or status <> 'completed')`;
const [{ open }] = await sql`
  select count(*)::int as open from payouts
  where id = any(${snapshot.payouts.map((p) => p.id)}) and status <> 'stopped'`;
console.log(`\napplied. recurring projects not frozen+completed: ${unfrozen}. payouts not stopped: ${open}.`);
if (unfrozen !== 0 || open !== 0) throw new Error('verification failed');

await sql.end();
