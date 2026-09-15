import './env-setup.js';
import { createRun, getRun, patchRun } from '@prodesk/server-shared/modules/outreach/list-builder/ledger';
import { regionSearch } from '@prodesk/server-shared/modules/outreach/list-builder/providers/region-search';
import { tick } from '@prodesk/server-shared/modules/outreach/list-builder/run';
import { loadSet } from '@prodesk/server-shared/modules/outreach/list-builder/run';

/**
 * End-to-end exercise of the list-build pipeline against the REAL providers.
 *
 * Drives `tick()` directly rather than enqueueing, so it works whether or not a
 * Worker happens to be running, and so each stage transition is visible here
 * instead of in another process's log.
 *
 * The campaign it pushes into must stay paused: these are real businesses, and
 * nothing in a test justifies cold-emailing them.
 */

// The vertical IS the search term — see regions.ts. Singular, because it also
// ends up as the noun in the opener.
const VERTICAL = process.env.E2E_VERTICAL ?? 'Dentist';
const REGION = process.env.E2E_REGION ?? 'Hunters Hill';
const CAP = Number(process.env.E2E_CAP ?? 120);
const CAMPAIGN = Number(process.env.E2E_CAMPAIGN ?? 3793200);

const t0 = Date.now();
const log = (...a: unknown[]) =>
  console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);

// The region is searched here exactly as the UI searches it, rather than being
// passed straight through as a name. Not ceremony: a run is scraped by its
// BOUNDARY now, and a name that was never resolved carries none — so a script
// that skipped this step would silently exercise the legacy geocode-the-name
// path instead of the one that ships. It also means REGION can be typed
// loosely; what gets stored is whatever OSM calls the thing.
const [match] = await regionSearch().suggest(REGION);
if (!match) {
  console.error(`No region matching "${REGION}". Councils and cities work; suburbs mostly don't.`);
  process.exit(1);
}
const region = await regionSearch().resolve(match.placeId);
log(`region "${REGION}" → ${region.label} (${match.placeId}, ${region.boundary.type})`);

const row = await createRun({
  vertical: VERTICAL,
  region: region.label,
  countryCode: region.countryCode,
  placeId: region.placeId,
  boundary: region.boundary,
  maxRecords: CAP,
  campaignId: CAMPAIGN,
  sendingDomain: null,
  personalise: true,
});
log(`run ${row.id.slice(0, 8)} created — ${VERTICAL} × ${region.label}, cap ${CAP}, personalise on`);

let last = '';
for (let i = 0; i < 240; i++) {
  const result = await tick(row.id);
  const state = `${result.status}/${result.stage}`;
  if (state !== last) {
    log(state, JSON.stringify(result.counts));
    last = state;
  }
  if (result.status === 'failed') {
    const r = await getRun(row.id);
    log('FAILED:', r?.error);
    process.exit(1);
  }
  if (result.status === 'review') break;
  await new Promise((r) => setTimeout(r, result.requeueMs ?? 5_000));
}

const set = (await loadSet(row.id)) ?? [];
const valid = set.filter((c) => c.verdict === 'valid');
log(`review: ${valid.length} sendable of ${set.length} scraped`);
for (const c of valid.slice(0, 8)) {
  log(
    `  ${c.businessName ?? '—'} <${c.email}> · ${c.reviewsCount ?? '—'} reviews` +
      `${c.hook ? ` · hook: "${c.hook}"` : ' · no hook'}${c.detail ? ` · detail: "${c.detail}"` : ''}`,
  );
}

if (process.env.E2E_PUSH === 'true') {
  await patchRun(row.id, { status: 'pushing', stage: 'pushing', autoPushAt: null });
  const pushed = await tick(row.id);
  log('push:', pushed.status, JSON.stringify(pushed.counts));
} else {
  // A run reaching `review` now carries a five-minute deadline and pushes
  // itself. This script stops at review, but a Worker on the same database
  // would not — and these are real businesses. Clearing the deadline is what
  // makes "stopping before push" actually stop.
  await patchRun(row.id, { autoPushAt: null });
  log('held before push (set E2E_PUSH=true to upload to Smartlead)');
}

process.exit(0);
