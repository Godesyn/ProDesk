/**
 * Naming things, and the lists that used to be here.
 *
 * This file held two hand-written tables — 38 region names and 13 verticals
 * with estimated listing counts — and both were load-bearing: the regions were
 * the coverage map's denominator, the verticals were its cost seed and the run
 * form's suggestions. Both are gone. What is left is one string function,
 * because the thing that replaced them is data.
 *
 * **The regions were wrong three ways at once.** They matched on strings, so a
 * whole-metro run — the cheapest way to cover a city — filled one square and
 * left the 33 councils it had just paid for looking unscraped. Their spellings
 * disagreed with OpenStreetMap's ("Inner West" against "Inner West Council"),
 * so a council picked from region search landed in an unnamed bucket while the
 * square bearing its nickname stayed empty. And they asserted a Greater Sydney
 * containing Blue Mountains, Hawkesbury and Wollondilly, none of which are
 * inside the polygon a Sydney run is actually scraped against — three councils
 * the map would have reported as bought that no run had touched.
 *
 * Coverage is computed from the boundaries we already store, and what is inside
 * what comes from OSM. See coverage.ts, gazetteer.ts and migration 0104.
 *
 * **The verticals went with them**, on the same principle. The suggestions now
 * come from the ledger — the verticals we have actually run — so the list is
 * short and true on day one instead of long and aspirational forever. The cap
 * is what it always really was: a spend ceiling the operator sets, defaulting
 * high because billing is per place found and over-capping costs nothing.
 *
 * ── A vertical IS the search term ─────────────────────────────────────────
 *
 * Worth keeping, because it is the reason there is no second column anywhere in
 * this feature. There used to be a display label ("Cafés & restaurants") beside
 * the query ("restaurant"), and carrying both bought nothing while costing:
 *
 *  1. The uniqueness index guarded the LABEL, not the spend. "Dentists" and
 *     "Dental clinics" both searching `dentist` over Sydney were two ledger
 *     rows and two Apify bills for one set of businesses. Rule 1 of the cost
 *     model can only be enforced on the string Google actually gets.
 *  2. It was never a real degree of freedom. One label mapped to one term, and
 *     the (vertical × region) index already refused a second run of the same
 *     label — so a label spanning two terms was unreachable anyway.
 *  3. The labels were the worse half for copy. `buildHooks` puts this noun
 *     mid-sentence in an email to a stranger, and plural compounds produced
 *     "the typical cafés & restaurant" and "the typical real estate agencie".
 *
 * So the canonical form is a SINGULAR noun phrase that is simultaneously a good
 * Google Maps query, a readable Smartlead campaign name, and a sentence-safe
 * noun. "Mechanic" rather than "car repair": only one of them survives "the
 * typical ___ in Inner West".
 */

/** Case- and space-insensitive, because it is half of a uniqueness key. */
export function normaliseKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
