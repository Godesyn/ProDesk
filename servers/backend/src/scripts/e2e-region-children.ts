import './env-setup.js';
import { regionSearch } from '@prodesk/server-shared/modules/outreach/list-builder/providers/region-search';
import { childRegionsOf } from '@prodesk/server-shared/modules/outreach/list-builder/providers/region-hierarchy';
import { contains } from '@prodesk/server-shared/lib/geometry';

/**
 * Exercises the coverage map's denominator against the real services.
 *
 * This is the pair of facts the whole rewrite rests on, and neither can be
 * checked by a unit test: that OpenStreetMap will tell us what is inside a
 * region, and that what it tells us is right. Run it after touching
 * region-hierarchy.ts, and read the council list — if Blue Mountains appears
 * under Sydney, containment has broken, because it is not in that polygon.
 *
 *   bun run --conditions development src/scripts/e2e-region-children.ts
 */
const provider = regionSearch();

for (const query of ['Sydney', 'Inner West Council']) {
  const [top] = await provider.suggest(query);
  if (!top) {
    console.log(`\n"${query}" → no region found`);
    continue;
  }
  const region = await provider.resolve(top.placeId);
  console.log(
    `\n${region.label} (${region.placeId}, admin_level ${region.adminLevel ?? 'none'}, ${region.countryCode})`,
  );

  const found = await childRegionsOf({
    osmId: region.placeId,
    boundary: region.boundary,
    adminLevel: region.adminLevel,
  });
  if (!found) {
    console.log('   nothing inside it that OSM decomposes into');
    continue;
  }
  console.log(
    `   admin_level ${found.adminLevel}: ${found.children.length} kept of ${found.candidates} returned`,
  );
  for (const c of found.children) console.log(`     ${c.osmId.padEnd(10)} ${c.label}`);

  // The other direction, and the one that refuses a run: a child resolved in
  // full must test as contained in its parent. A false negative here is a
  // council scraped twice.
  const [first] = found.children;
  if (first) {
    const child = await provider.resolve(first.osmId);
    console.log(
      `   containment: ${child.label} inside ${region.label} → ${contains(
        region.boundary,
        child.boundary,
      )}`,
    );
  }
}
process.exit(0);
