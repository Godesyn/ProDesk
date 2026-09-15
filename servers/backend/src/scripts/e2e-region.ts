import './env-setup.js';
import { regionSearch } from '@prodesk/server-shared/modules/outreach/list-builder/providers/region-search';

/** Exercises the region-search seam itself — the code the tRPC procedure calls. */
const provider = regionSearch();
console.log(`provider: ${provider.name} (${provider.attribution})`);

for (const query of ['inner west', 'moreland', 'wollongong', 'hamilton new zealand']) {
  const results = await provider.suggest(query);
  console.log(`\n"${query}" → ${results.length}`);
  for (const r of results.slice(0, 3)) console.log(`   ${r.placeId}  ${r.label} — ${r.context}`);
  if (results[0]) {
    const resolved = await provider.resolve(results[0].placeId);
    console.log(`   resolve → ${resolved.label} (${resolved.countryCode})`);
  }
}
process.exit(0);
