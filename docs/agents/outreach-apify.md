# Outreach — the Apify list-build stage

Companion to [outreach.md](./outreach.md) §11 (List Builder) and §16 (cost model).
Researched 2026-08-11 against `compass/crawler-google-places`.
**Built 2026-08-12** — see §10 for what shipped and what is still open.

**Two things in outreach.md §11 are wrong and are corrected here:**

1. *"Google Maps caps results at roughly 120 per query regardless of how many businesses
   exist, so large regions must be split and deduped across overlapping tiles."* — the cap is
   real but the actor already handles it. We must **not** build our own tiling.
2. *"a list of sub-regions (suburbs/postcodes, not one metro name)"* — suburb-level splitting
   is now actively harmful. The region unit should be an **LGA**, or Greater Sydney whole.

---

## 1. Decisions

1. **One run per (vertical × region). Never overlap regions across runs** — in-run duplicates
   are free, cross-run duplicates are billed twice.
2. **Region unit = LGA** (Greater Sydney has 33), not suburb. Let the actor tile.
3. **Turn on exactly two billable events:** base place scrape + `scrapeContacts`. Everything
   else off. ~$3.00 per 1,000 places.
4. **`website: "only"`** — we bin websiteless places anyway; don't pay to collect them.
5. **`reviewsCount` and `totalScore` come free in the base item.** For a reviews product this
   is the personalisation hook, and it's better than anything the Haiku homepage crawl
   produces. See §5.
6. **Persist the run row before starting the run**, so a Worker crash never re-pays.
7. **Apify Starter ($29/mo).** At our volume the event spend is ~$12–20/mo either way; Starter
   buys the lower per-event rate and concurrency headroom. Verify what prepaid usage Starter
   currently includes before committing.

---

## 2. How the actor actually works

### There is no pagination API

You start a run, it streams results into an Apify **dataset**, you poll the run until it
finishes, then page the dataset:

```
POST /v2/acts/compass~crawler-google-places/runs?token=…   → { data: { id, defaultDatasetId } }
GET  /v2/actor-runs/{runId}?token=…                        → { data: { status } }
GET  /v2/datasets/{datasetId}/items?offset=0&limit=1000    → [ … ]
```

`offset`/`limit` on the dataset is the only paging we implement. It's cheap and repeatable —
re-reading a dataset is not a billable event, so a failed downstream stage can re-read for free.

### The 120 cap, and why it doesn't apply to us

Google returns at most ~120 results for a single map viewport. That limit bites **only when
you pass a bare search string with no structured location** — the actor opens one map screen
and scrolls it to exhaustion.

When you supply a real location (`city` / `state` / `countryCode` / `postalCode` /
`customGeolocation`), the actor geocodes it, lays a grid over the bounding box, and scrapes
each tile separately at an auto-tuned zoom (usually 16):

| Target results | Grid | Max theoretical |
|---|---|---|
| ≤ 50 | 6 × 6 | 4,320 |
| ≤ 100 | 8 × 8 | 7,680 |
| ≤ 200 | 10 × 10 | 12,000 |
| > 200 | 12 × 12 | **17,280** |

Results are deduped by `placeId` before they hit the dataset, so overlapping tiles are not
billed twice. Ceiling per (search term × location) is ~17k places — an order of magnitude
above any single vertical in Greater Sydney, so we never touch it.

**This is why suburb splitting is wrong.** Running 700 Sydney suburbs instead of one Greater
Sydney location gives identical coverage, 700× the run-management overhead, and — because
dedup is per-run — real duplicate billing wherever suburb geocode boxes overlap. Keep LGAs as
the unit only because it makes the run ledger, progress UI and per-region resumability
tractable, not because coverage needs it.

---

## 3. Billing

Pay-per-event. You are billed per event, not for platform compute.

| Event | Free plan | Starter+ | We use it? |
|---|---|---|---|
| Place scraped | $2.00 / 1k | **$1.50 / 1k** | **Yes** |
| Company contacts enrichment (`scrapeContacts`) | $2.00 / 1k | **$1.50 / 1k** | **Yes** |
| Additional place details (`scrapePlaceDetailPage`) | $2.00 / 1k | $1.50 / 1k | No |
| Social media profile enrichment | $100 / 1k | $7.00 / 1k | No |
| Business leads enrichment (`maximumLeadsEnrichmentRecords`) | per record | per record | No |
| Email verification (`verifyLeadsEnrichmentEmails`) | decisive results only | " | **No** — MillionVerifier already is the gate (§11.3). Don't pay twice. |
| Review | $0.50 / 10k | $0.37 / 10k | No |
| Image | — | — | No |

**Our unit cost: ~$3.00 per 1,000 places** (base + contacts, Starter rate).

Everything we deliberately leave off is a separate event. `scrapePlaceDetailPage` is the
tempting one — it costs the same as the base scrape and returns opening hours, Q&A and review
distribution. None of that reaches a cold email. Leave it off.

---

## 4. The input

```jsonc
{
  "searchStringsArray": ["dentist"],        // ONE term per run. See below.
  "customGeolocation": {                     // the region's OSM boundary. NOT its name — §4a
    "type": "Polygon",                       // [longitude, latitude], first pair repeated last
    "coordinates": [[[151.112, -33.934], /* … */ [151.112, -33.934]]]
  },
  "language": "en",

  "maxCrawledPlacesPerSearch": 3000,         // hard budget ceiling, per term

  "website": "only",                         // ← the biggest single cost lever
  "skipClosedPlaces": true,
  "scrapeContacts": true,                    // emails from the business website

  // explicitly off — each is a separate billable event
  "scrapePlaceDetailPage": false,
  "maxReviews": 0,
  "maxImages": 0,
  "maxQuestions": 0,
  "scrapeSocialMediaProfiles": {},
  "maximumLeadsEnrichmentRecords": 0,
  "verifyLeadsEnrichmentEmails": false,
  "enableCompetitorAnalysis": false,
  "scrapeDirectories": false,
  "includeWebResults": false,
  "scrapeTableReservationProvider": false,
  "scrapeOrderOnline": false
}
```

**One search term per run.** `["dentist", "dental clinic"]` in one run is fine (deduped), but
the moment those terms live in *different* runs you pay twice for the same practice. One term,
one region, one run, one ledger row — that invariant is what keeps the cost model honest.

**The vertical IS the search term** (2026-08-17, migration 0101). `outreach_list_runs` carried
both a display label ("Cafés & restaurants") and the query ("restaurant"). That looked cosmetic
and was a hole in the invariant directly above: the uniqueness indexes key on `vertical`, so two
labels resolving to one term were two ledger rows and two bills for the same businesses. It also
bought nothing — one label mapped to exactly one term in `regions.ts`, and the
`(vertical, region_key)` index already refused a second run of the same label, so a label
spanning two terms was unreachable anyway. Collapsed to one column, backfilled onto the query
side so old and new rows share a namespace. Knock-on: the canonical verticals are now singular
noun phrases that have to work as a Maps query, a Smartlead campaign name **and** the noun
`buildHooks` drops mid-sentence into a stranger's inbox, so compounds are split (Restaurant /
Cafe, Hair salon / Beauty salon, Gym / Personal trainer, Physiotherapist / Chiropractor) and
"car repair" became "Mechanic" — only one of those survives "the typical ___ in Inner West".
The `/s$/i` strip in `buildHooks` is gone with them; it produced "real estate agencie".

**Pass the region's BOUNDARY, never its name** (2026-08-17, migration 0102). The location went
out as `city: "<region label>"`, and the actor resolves that through Nominatim's *structured*
lookup — `?city=…&country=…` — which only matches populated places: city, town, village. An
Australian LGA is a `boundary=administrative` relation, so the official names our own region
search returns are unreachable through it. Verified against Nominatim:

| structured lookup | result |
|---|---|
| `city=Sydney` | ✓ 1 row |
| `city=Inner West Council` | ✗ 0 rows — run dies `LOCATION NOT FOUND` |
| `city=City of Parramatta` | ✗ 0 rows |
| `city=Willoughby City Council` | ✗ 0 rows |
| `county=Inner West Council` | ✗ 0 rows |
| `city=Brisbane City` | ⚠️ 1 row — **the postcode-4000 CBD, not the 1,300 km² council** |

That last row is the reason this is a §1-class bug rather than a papercut. It resolves, the run
succeeds, it scrapes a few square kilometres, and the region reports as covered — the same
failure `isCapped` exists to prevent, arriving by a different door. Note also that the old
free-text region field worked by accident: `city=Inner West` matches a `borough`, so the very
act of making region identity authoritative (§7, Place IDs) is what surfaced this.

So the boundary itself now travels with the run, in `customGeolocation`, and the geocoder
leaves the loop entirely. It is stored on the ledger row rather than re-fetched, and that is a
money property, not a cache: `input_hash` is derived from the actor input and orphan adoption
rebuilds it from the row, so a re-fetch that returned an edited polygon would hash differently,
fail to match a run already paid for, and start a second one. Rows predating the column fall
back to the name path so their hash still reproduces byte-for-byte.

Knock-ons:

- **Region search is OpenStreetMap only.** Google Places reads informal names better but
  returns a rectangular `viewport` for a region, never its shape, and a rectangle over a
  council spills into its neighbours — duplicate billing in the one place the design exists to
  prevent. It was the better namer and couldn't do the job that now matters.
- **Boundaries are simplified at `polygon_threshold=0.001`** (~110 m). Raw OSM is far finer
  than a map scrape can use and the polygon is not a throwaway — it goes into the actor input,
  the ledger row, and a hash recomputed for up to 25 candidates on every adoption check. Inner
  West Council: 1,673 pts / 43 KB → 64 pts / 1.7 KB. New South Wales: 79,450 pts / 2.0 MB →
  6,291 pts / 161 KB. 110 m sits inside a single z17 tile, the finest the actor tiles at, so no
  tile can be lost to it. Not a knob to raise: at 0.005° the same council collapses to 17
  points and visibly cuts corners off a harbour boundary.
- **A region we can name but not draw is refused** at resolve time, where the operator is
  standing in front of the error and nothing has been billed.

**`categoryFilterWords` — don't.** The actor's own docs call it dangerous: Google's category
labels are inconsistent and it produces silent false negatives. Filter on `categoryName`
server-side after the fact, where a mistake is visible and free to fix.

---

## 5. Field mapping, and the free personalisation hook

The base item (no detail page) already carries everything we need:

| Apify field | Our column |
|---|---|
| `placeId` | `outreach_prospect_state.place_id` *(new — see §7)* |
| `title` | business name |
| `website` | website |
| `emails[0]` | email (from `scrapeContacts`) |
| `phone` | phone |
| `address`, `city`, `postalCode`, `state` | address |
| `categoryName` | vertical |
| `totalScore`, `reviewsCount` | **personalisation** |
| `permanentlyClosed`, `temporarilyClosed` | drop |

**`reviewsCount` and `totalScore` are in the base item at no extra cost.** For Verdiict this
is the whole pitch in two integers — "you're on 11 reviews at 4.2; the three dentists closest
to you average 180" is a sharper, more credible, more *relevant* opener than any named service
Haiku can pull off a homepage.

That means §11 step 4 (Haiku homepage crawl for a personalisation detail) may be redundant.
It's ~$8–10/mo, plus a rate-limited crawler, plus robots.txt exposure, plus a null-detail
fallback path in every template — for a hook that is weaker than one we already have for free.
**Recommendation: build the review-count hook first, ship a campaign on it, and only add the
Haiku crawl if reply rates say it's needed.** Sequencing decision, not a scope cut — the seam
in §11 stays.

Second-order: `reviewsCount` is also the best prospect *score* we'll ever get. A business on
8 reviews needs the product; one on 900 doesn't. Sort the push queue by it.

**Region identity is a Place ID, not a string** (2026-08-12, migration 0094). `region_key` was
written verbatim while `vertical` was normalised, so the uniqueness index was case-sensitive on
one side only — "Inner West" and "inner west" were two ledger rows and two Apify bills for one
council. It is now normalised, with `region_label` carrying the readable form. On top of that,
a region picked through Google Places search stores its `place_id`, and a second partial unique
index on `(vertical, place_id)` catches what a name cannot: one council spelled three ways.
Google is used ONLY to name an area — it returns no emails, caps text search at 60 results, and
its terms restrict retaining place data, so it is not a scraper. `GOOGLE_PLACES_API_KEY` is
optional; unset, OpenStreetMap answers the search instead, which needs no key at all.

**And search is now the only way to name one** (2026-08-17). The region field was a dropdown of
the 38 curated names with search as an escape hatch. Wrong default twice: it fronted Sydney's 33
councils when the point of the search provider is that anywhere is reachable, and — the part
that cost money — a curated name carries no `place_id`, so the `(vertical, place_id)` index
applied only to the runs that happened to come in through the escape hatch. With the dropdown
gone, every run started from the UI carries an id and the exact-identity index always applies;
`startListRun` requires `placeId` and resolves the name and country from it rather than trusting
anything the client sends. `EXPANSION_METROS` outlived this by one revision and is now gone too
— see "The coverage map" in §14 for what replaced it and why the hand-written denominator was
worse than no denominator.

**Never let a run truncate** (2026-08-12). `maxRecords` is a spend ceiling, not a target — billing
is per place found, so a cap far above a region's real size costs nothing. A cap that *bites* is
expensive in a way that can't be undone: the actor tiles the whole region, so its results are
spread across the entire area, and any later run over that ground re-scrapes and re-bills the
same businesses. Our `placeId` dedupe runs after Apify has already charged, so it prevents the
second email, never the second charge. There is therefore **no cheap continuation of a capped
run** — not by council, not by re-running at a higher cap. Prevention is the only lever:
default the cap above the vertical's estimate, allow it up to `MAPS_RESULT_CEILING`, and flag
capped runs (`isCapped`) so a truncated region can't pass as an exhausted one on the coverage map.

**And gate the crawl on it** (2026-08-12). When `personalise` is on, the homepage crawl runs
only over rows that earned a hook — i.e. those below `HOOK_RATIO` of their area's median. A
business at or above typical is receiving the fallback opener and is the least likely contact
in the run to buy a reviews product; a fetch plus an LLM call on them is the worst-value spend
in the pipeline. Note the coupling this creates: no benchmark (a peer set under `MIN_PEER_SET`)
means no hooks, which now also means no personalisation at all. The `hooked` and `enriched`
counts on the run make that visible rather than silent.

---

## 6. Cost-efficiency rules, ranked by actual impact

1. **Never scrape the same (vertical, region) twice.** The only way to genuinely waste money
   here. Enforced by the run ledger (§7), not by discipline.
2. **`website: "only"`** — cuts the billed set by roughly 35–45% in AU local verticals.
   *Needs a probe to confirm the filter is applied before the billing event, not after.*
3. **Leave every optional event off.** Turning on social enrichment alone would be ~2.3× the
   entire rest of the pipeline.
4. **`maxCrawledPlacesPerSearch` as the budget ceiling.** Run cost estimate shown in the UI
   before start = `terms × cap × $3.00/1000`. This is the number §11 asks for.
5. **Monthly cadence at most.** Google Maps business churn is ~1–2%/month; re-scraping a
   region weekly buys nothing and pays full price for it.
6. **Store the dataset id, not a copy of the dataset.** Re-reading an Apify dataset is free, so
   the resumable stages in §11 should re-read rather than mirror.

**Reality check on all of this:** one vertical across all of Greater Sydney costs about **$5**
(see §8). At the planned 6,000 businesses/month the Apify line is **$15–20/month**, against
~$150 for Workspace and $94 for Smartlead. Rule 1 is worth enforcing because double-scraping
is a symptom of a broken ledger, not because of the dollars. Do not trade contact quality or
coverage for cost here — there is nothing to win.

---

## 7. Implementation

**Seam:** `packages/server-shared/src/modules/outreach/list-builder/providers/{apify,outscraper}.ts`

```ts
interface MapsProvider {
  startRun(spec: ScrapeSpec): Promise<{ runId: string; datasetId: string }>
  pollRun(runId: string): Promise<{ status: 'running' | 'succeeded' | 'failed'; datasetId?: string }>
  fetchPage(datasetId: string, offset: number, limit: number): Promise<RawPlace[]>
}
```

**The send queue — scraping is parallel, sending is not.** Several regions may scrape at once;
there is no reason to make anyone wait on one to start the next, and the scrape is where the
money goes, not where the risk is. Sending is the opposite: every run pushes into the same one
campaign (outreach.md §8), so *which region hears from us first* is a real decision.

`queue_position` is that decision, written down. It spans every run, sent and unsent, so a
finished run keeps the position it sent in and the list reads as a history as well as a plan.
A new run goes to the back.

The order is **strict**: `blockedBy()` refuses to let a run move `review → pushing` while
anything ahead of it is unsent — *including a run that is merely still scraping*. An order that
applied only to whoever finished scraping first would not be an order. `skipped_at` is what
makes strictness liveable: a skipped run is passed over and, crucially, does not block the runs
behind it. It keeps its position, so unskipping restores it rather than appending it.

Skip replaced Hold. Hold cleared `auto_push_at` so a run waited for a person indefinitely, which
is still exactly what happens — but a held run at the front of a strict queue would hold up
everything behind it, so it now steps out of the line as well. Two controls for one intention
was the alternative, and "hold" versus "skip" is not a distinction anyone keeps straight at the
moment they are deciding who gets emailed tomorrow.

A blocked run polls every 20s; reordering and skipping also nudge the new head directly, so the
queue visibly moves when it is changed rather than up to twenty seconds later.

**Resumability — the money-losing failure mode.** Apify has no idempotency key on run start.
If the Worker dies between `startRun` and persisting the id, a retry pays for the whole scrape
a second time. So:

1. Insert the ledger row `status: 'starting'` **before** calling Apify.
2. Start the run, stamp `run_id` + `dataset_id`, move to `running`.
3. On Worker resume, a row stuck in `starting` must **adopt an orphan** — list Apify runs for
   the actor started after the row's `created_at` and match on input — before ever starting a
   new one.

**Table — a deliberate fifth table, and a new column.** outreach.md §5 fixes the model at four
tables, on the criteria *Smartlead has no field for it*, *must be queried across all campaigns*,
or *losing it loses work*. A scrape ledger meets the third: losing it means re-paying, and
worse, re-emailing.

- `outreach_prospect_state.place_id` (text, unique) — cross-run dedupe key, and the only stable
  identity Google gives us. Business names and emails both change; `placeId` doesn't.
- `outreach_list_runs` — provider, actor id, vertical, region key, region boundary, input hash,
  `run_id`, `dataset_id`, status, stage, counts (found / no-email / duplicate / suppressed /
  unverified / pushed), cost estimate, cost actual, `queue_position`, `skipped_at`, timestamps.
  `unique(vertical, region_key)`
  so the UI can refuse a repeat outright rather than warn about it.

Migration is hand-written SQL + a `meta/_journal.json` entry — never `db:generate`, never
`db:push`.

**Env:** `APIFY_TOKEN`, `APIFY_MAPS_ACTOR_ID` (default `compass~crawler-google-places`).
Env files are the sole config source.

---

## 8. How big is Sydney?

Two different questions, and only the second one matters operationally.

### (a) Every business in Greater Sydney, all categories

| Step | Figure |
|---|---|
| Actively trading businesses, Australia (ABS, 30 Jun 2025) | 2,729,648 |
| NSW share (~32%) | ~875,000 |
| Greater Sydney share of NSW (~75%) | **~650,000 ABN-registered** |
| …of which employing (~37%), Maps-listed at ~75% | ~180,000 |
| …of which non-employing (~63%), Maps-listed at ~12% | ~50,000 |
| Non-ABN POIs Google carries (chain sites, schools, govt, clinics-within-clinics) | ~30,000–60,000 |

**≈ 230,000 – 290,000 Google Maps place entries. Call it 250,000.**

Cost to actually pull that: ~$375 base, ~$750 with contacts — and it would take 50+ distinct
search terms across 33 LGAs to reach, because the per-term ceiling is ~17k. **Don't.** The
number is here to size the market, not to be a plan.

### (b) One vertical across Greater Sydney — the number we actually run against

Estimates, not sourced counts. Calibrate with a probe (§9).

| Vertical | Maps listings, Greater Sydney |
|---|---|
| Cafés / restaurants | 9,000 – 12,000 *(the outlier)* |
| Hair & beauty salons | 4,000 – 5,000 |
| Auto repair / mechanics | 2,500 – 3,500 |
| Plumbers | 2,000 – 3,500 |
| Electricians | 2,000 – 3,000 |
| Dentists | 1,800 – 2,500 |
| Real estate agencies | 1,500 – 2,000 |
| Gyms / PT studios | 1,200 – 1,800 |
| Physio / chiro | 1,200 – 1,800 |

**Rule of thumb: a mainstream local-service vertical across Greater Sydney is 1,500–4,000
listings.** Food is the exception at 3–4×.

### The funnel, worked through on dentists

| Stage | Count | Rate |
|---|---|---|
| Listings, `dentist`, Greater Sydney | 2,000 | — |
| `website: "only"` | 1,300 | 65% |
| Email found by `scrapeContacts` | 780 | 60% |
| Survives dedupe + suppression | 740 | 95% |
| MillionVerifier `valid` | **~590** | 80% |

**Cost: ~$4–5. Yield: ~590 sendable contacts.**

This corroborates outreach.md §16 — 6,000 businesses pulled → ~2,000 contacts is about right
(my model lands at ~1,700–2,000).

### The consequence worth acting on

Across ~25 target verticals, Greater Sydney holds roughly **45,000–60,000 listings →
12,000–18,000 verified contacts.** At the planned 2,000 new contacts/month, **Sydney is
exhausted in 6–9 months.**

So geography is a depleting resource, and the List Builder should be built knowing it:

- The run ledger doubles as a **coverage map** — which (vertical × region) pairs remain. That
  should be a visible surface, not an implementation detail. It's the thing that tells the
  operator when to open Melbourne.
- Expansion order by business density: Sydney → Melbourne (~90% of Sydney) → Brisbane (~45%)
  → Perth (~35%) → Adelaide (~20%). Melbourne roughly doubles the runway.
- Re-scraping an exhausted region yields ~1–2%/month of genuinely new businesses. That's a
  small monthly top-up run, not a re-run — and `place_id` dedupe is what makes it cheap.

---

## 9. Settle these with one $5 probe before building stage 1

One run: `searchStringsArray: ["dentist"]`, `customGeolocation: <Sydney's boundary>` (§4),
`maxCrawledPlacesPerSearch: 3000`, `website: "only"`, `scrapeContacts: true`. Then read the
run's billing breakdown in the Apify console.

| Question | Why it matters |
|---|---|
| Is `website: "only"` applied **before** the billing event? | If after, the filter saves nothing on the base event and rule 6.2 is halved. |
| Does `scrapeContacts` require `scrapePlaceDetailPage`? | If yes, our unit cost is $4.50/1k, not $3.00/1k. |
| Is `scrapeContacts` billed per place **attempted** or per place **with an email found**? | Swings the contacts event by ~40%. |
| Actual listing count for a known vertical | Calibrates the whole of §8(b). Store it and have the estimator learn from actuals rather than these guesses. |
| Email fill rate on `emails[]` | Validates the 60% assumption that the entire yield model rests on. |
| Does Starter's prepaid usage cover our monthly event spend? | Decides Free+PAYG vs Starter. |

Record the answers back into this doc — §3 and §8 are the numbers everything downstream is
sized against.

**The code is built to learn these rather than wait for them.** Every run stores
`cost_actual_usd`, read off the provider on each poll, next to the `cost_estimate_usd` it was
sold on. Once a handful of real runs exist, the estimate in
`list-builder/providers/index.ts` should be corrected from the ledger rather than from a
console screenshot — and the Runs table already shows the two side by side, so a
systematically wrong estimate is visible without anyone going looking.

---

## 10. What shipped (2026-08-12)

Migration `0093_outreach_list_runs`. Code under
`packages/server-shared/src/modules/outreach/list-builder/`.

### The seam, as §7 specified it

`providers/types.ts` defines `startRun` / `pollRun` / `fetchPage` / `findRunsByInput`, with
`apify.ts` and `outscraper.ts` behind it and `verifier.ts` alongside. The shape matters more
than the split: the previous implementation was one blocking `fetchRegion()` that started a
run, polled it for up to 45 minutes and drained the dataset, which held a Worker for the whole
window and could not survive a restart without risking a second charge.

### Resumability — the money-losing failure mode, closed

1. The ledger row is inserted `starting` **before** Apify is called.
2. `beginScrape` adopts an orphan first, always: it lists the actor's recent runs, reads each
   one's `INPUT` record out of its key-value store, hashes it the same way ours was hashed,
   and binds a match. Only if nothing matches does it start a new run.
3. A `starting` row older than an hour with no visible match **refuses to auto-start** and
   asks a human to check the console. Blocking a run is recoverable in a minute; a duplicate
   scrape is not recoverable at all.
4. Outscraper reports `supportsAdoption: false` — there is no way to ask it the question — so a
   stalled run on that provider will not auto-resume. That is a real safety property lost in
   the swap, and it belongs in any future provider comparison.
5. The pipeline is a state machine: each Worker tick does the smallest amount of work that ends
   in a durable state and returns how long to wait before the next one. A
   `list-build-resume` job at boot and every 10 minutes picks up anything a deploy stranded.

### One run, one pair — enforced, not advised

`unique(vertical, region_key) where status not in ('failed','superseded')`, plus the same rule on
`(vertical, place_id)`, plus a containment check that no index can express — see "The coverage
map" below. The UI refuses the repeat before the mutation and the mutation refuses it again on a
`CONFLICT`. `superseded` is the deliberate escape hatch for the ~1–2%/month top-up, behind a
confirm that states the cost. Region is searched, one at a time — there is no multi-region field,
because there is no cheap way to use one.

### The free hook, built first

`place_id`, `reviews_count`, `rating` and `review_hook` are on `outreach_prospect_state`.
The opener is composed at list-build time against **the median of that run's own scrape** — the
same term, the same region — so the claim is true by construction rather than by assertion, and
it is stored rather than recomputed so the template preview shows the sentence that was actually
sent. It refuses to speak when it can't: fewer than 20 peers with reviews, or a business that
isn't actually behind, produces `null` and the template falls back. Pinned by
`list-builder/run.test.ts`.

`{{hook}}`, `{{reviews}}` and `{{rating}}` join `{{detail}}` as merge tags. The Haiku homepage
crawl is now **opt-in per run**, off by default, exactly as §5 recommends — the seam stays, the
default doesn't.

`reviews_count` also orders the push queue, fewest first. A campaign's daily cap means the tail
of a long list may not be reached for weeks, so push order *is* the prioritisation.

### The coverage map

`outreach.listCoverage` derives it from the ledger — never stored separately, because a coverage
number maintained apart from the runs it summarises is one that will eventually disagree with
them. Rendered as a grid of regions per (vertical × parent region) under the run form, with a
Runs table beneath it totalling actual spend and saying plainly how many runs haven't reported a
cost yet.

**It is computed from geometry now, not from names** (2026-08-17, migration 0104). The
denominator used to be `EXPANSION_METROS`, 38 region names written by hand, and it was wrong in
three ways at once:

1. **It matched on strings.** A whole-metro run — the cheapest way to cover a city — filled one
   square and left the 33 councils it had just paid for looking unscraped. Nothing in the map
   understood that one area can be inside another.
2. **Its strings didn't match.** Region search returns OSM's official names, so "Inner West
   Council" never equalled our "Inner West": the run fell into the loose bucket while the square
   bearing its nickname stayed empty. Most searched LGAs missed their intended cell.
3. **It asserted things that were false.** Our Greater Sydney contained Blue Mountains,
   Hawkesbury and Wollondilly. OSM's Sydney polygon — the shape a Sydney run is actually scraped
   against — contains none of them. The map would have reported three councils as bought that no
   run had touched.

So the taxonomy comes from OSM, which is where the boundaries we scrape already come from.
`outreach_regions` caches what is inside what; `lib/geometry.ts` answers containment against the
polygons already on the ledger rows. A cell is **scraped** (its own run), **covered** (inside a
bigger run's polygon), or empty — three states where there used to be two, because a council
bought as part of a metro and a council with its own line on the bill lead to different
decisions.

The gazetteer is **vertical-agnostic**: "these 30 councils are inside Sydney" is a fact about
geography, so one vertical pays the Overpass round trip and every vertical reads the answer.
That is what makes "dentist: 2 of 30 councils" answerable without a dentist run ever having
named Sydney.

**Containment also closes the last billing hole.** The two unique indexes catch a region scraped
twice under one name and under two names for one OSM object. Neither can see a council scraped
after the metro containing it — two different regions, two different ids, database happy, and
Apify bills for every business again before `dedupe()` silently drops all of them as known. The
run "succeeds", pushes nothing, and the money is gone. `findCoveringRun` now refuses it
(`RegionCoveredError`), and the form says so before the button is pressed.

#### What the live services actually do (verified 2026-08-17)

- **"Sydney" is `place=city` with no `admin_level`** (R5750005) — Australia has no metropolitan
  tier between state (4) and council (6). It carries a 970-point polygon, so it is scrapeable,
  and Overpass's `map_to_area` works on it. A parent with no admin level is normal.
- **Overpass over-returns.** `rel(area.a)` matches any relation with a node in the area, so
  neighbours that share a border come back too. Sydney at level 6: 64 relations. Our own
  containment test on each candidate's point is what cuts it to 30.
- **Level 6 is mostly not councils.** Of those 64, 33 are; the other 31 are wharves, islands,
  marinas and a museum. 30 carry `boundary_type=unincorporated area`; the last, "Walsh Bay
  Wharves", has no tags at all beyond its outline. Both rules are in `isRegion`.
- **`overpass-api.de` is frequently saturated**, answering 504 in under ten seconds.
  `OVERPASS_URLS` is a mirror list, kumi.systems first. A failed enumeration is recorded as an
  error and retried on a six-hour cooldown — never reported as "this region contains nothing".
  Discovery gives up after four minutes for the same reason; a bad afternoon must not hold a
  Worker slot for an hour.
- **Containment needs an absolute tolerance, not a proportional one.** Boundaries are simplified
  to 0.001° (~110m) independently of each other, so along a shared border a child pokes out of its
  parent by up to twice that. On a metro that is nothing; on a 1km suburb it is a tenth of the
  width, and a proportional 2% slack (20m) said Annandale was not inside Inner West Council.
  `BOUNDARY_TOLERANCE_DEGREES` is 0.003 (~330m) — three times the simplification, to cover corners
  cut on both sides at once. Measured against Inner West afterwards: Annandale, Marrickville and
  Balmain East all score a containment ratio of 1.000, and neighbouring Waverley Council scores
  0.000. There is no real population of regions between those two numbers to be wrong about.
- `bun run --conditions development src/scripts/e2e-region-children.ts` exercises the whole path
  against the real services. If Blue Mountains ever appears under Sydney, containment has broken.

### Who is in a run (2026-08-19, migration 0109)

The panel behind a queue row showed a run's contacts as a flat list of the first 200, six fields
wide, and only while the run sat at `review`. After it sent, the roster stopped existing on this
screen entirely: the only way to look at a business we had emailed was to leave for Prospects and
search for it by name, one business out of four hundred.

`outreach.runBusinesses` is the run's roster instead — every field we hold, paginated, plus the
Smartlead thread on the ones that have been emailed. `modules/outreach/list-builder/businesses.ts`,
rendered by `pages/super-admin/outreach/run-businesses.tsx`.

**It reads two different lists, and the difference is not incidental.** Before the push the
contacts are the candidate set in Redis, which is the FULL one — rejects included — so it is the
only thing that can answer "who did verification throw out", a question that stops existing the
moment the run is done. After the push they are `outreach_prospect_state` rows and the set is
dropped; those rows carry what the set could not know yet — lead id, what was sent, what came
back, how it was read, whether an account was created. So the cuts differ by half of a run's life:
**All / Will send / Can't send** before, **All / Replied / Said yes** after.

**Paging is by offset here and by cursor next door, on purpose.** The Prospects list is keyset-
paginated because it grows while you page through it. A run's roster is the opposite — fixed the
moment the run finishes — so offset paging is safe, and it is also better, because the number that
matters while sweeping a region is "142 of 380" and a cursor cannot tell you that.

That only holds if the sort is TOTAL. It is the run's own send order (fewest reviews first,
`byNeed`) **plus a tiebreak on email**, which `byNeed` does not need and this does: a region
routinely holds a dozen businesses on 3 reviews, and two rows a comparator calls equal are free to
swap between two fetches — at which point one is on both pages and another is on neither, and
nobody ever finds out. `businesses.test.ts` pages a set of identical review counts and asserts the
concatenated pages are the whole set, once each.

**The ordinal is the same device the queue uses, one level down.** The queue numbers runs 1, 2, 3
in the order they will send; the roster numbers businesses the same way, in the order they will be
emailed. So run 1 / business 1 is the next stranger who hears from us, and the number carries the
same meaning at both resolutions.

**Migration 0109 stores `phone`.** It was already being uploaded to Smartlead's `phone_number`
field and dropped on the way — the same gap 0106 closed for `address`, with the same consequence:
a value the campaign holds that we cannot read back. No backfill is possible for anything already
sent, because the candidate set it came from is gone.

Two things the roster is deliberately not. It is a **reading** surface — deleting, suppressing and
re-classifying stay on the screens built for them, and it shows a classification without offering
to change it. And it does **not** recompute the review-count median: the hook is stored precisely
because the comparison was made against a run's own scrape, a number that exists nowhere else once
the run is gone, and a recomputed median would put a different sentence on screen from the one that
was actually sent.

### Still open

- The §9 probe. Nothing here depends on its answers, but §3 and §8 remain estimates until it runs.
- `estimateCostUsd` still uses the $3.00/1k figure from §3. Correct it from `cost_actual_usd`
  once real runs exist.
- A council-level run produces a **suburb** grid: Inner West decomposes at admin_level 9 into 19
  of them. Truthful, and every cell is covered by construction, so it is legibility rather than
  runway. If those grids turn out to be noise, stop descending below the level a region was
  scraped at rather than reintroducing a list of which levels matter.
