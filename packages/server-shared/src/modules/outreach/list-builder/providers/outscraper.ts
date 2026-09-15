import { createHash } from 'node:crypto';
import { env } from '../../../../lib/env.js';
import {
  MAPS_RESULT_CEILING,
  num,
  str,
  type MapsProvider,
  type RawPlace,
  type ScrapeSpec,
} from './types.js';

/**
 * Outscraper — the declared drop-in alternative (§15).
 *
 * It exists to keep the seam honest: if this file could not be written against
 * the same interface, the interface would be an Apify wrapper wearing a
 * costume. It is not the provider we run on, and two things are worth knowing
 * before it ever becomes so:
 *
 *  • Its async API returns a request id, not a dataset — the mapping below
 *    treats that id as both the run and the dataset handle, which is fine
 *    because the pipeline never interprets either.
 *  • It cannot support orphan adoption. There is no way to ask "did I already
 *    start this exact request?", so `supportsAdoption` is false and the ledger
 *    refuses to auto-recover a `starting` row on this provider rather than
 *    risking a second charge. That is a deliberate loss of a safety property,
 *    and it belongs in the comparison if the provider is ever switched.
 */

const BASE = 'https://api.outscraper.cloud';

function key(): string {
  if (!env.OUTSCRAPER_API_KEY) throw new Error('Outscraper is not configured.');
  return env.OUTSCRAPER_API_KEY;
}

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'X-API-KEY': key() } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Outscraper returned ${res.status}. ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function toRawPlace(item: Record<string, unknown>): RawPlace {
  const emails = Array.isArray(item.emails) ? item.emails : [];
  const email = str(emails[0]) ?? str(item.email_1) ?? str(item.email);
  return {
    placeId: str(item.place_id) ?? str(item.google_id),
    name: str(item.name),
    email: email ? email.toLowerCase() : null,
    website: str(item.site) ?? str(item.website),
    phone: str(item.phone),
    address: str(item.full_address) ?? str(item.address),
    category: str(item.type) ?? str(item.category),
    rating: num(item.rating),
    reviewsCount: num(item.reviews),
    permanentlyClosed: item.business_status === 'CLOSED_PERMANENTLY',
  };
}

function query(spec: ScrapeSpec): string {
  const url = new URL(`${BASE}/maps/search-v3`);
  url.searchParams.set('query', `${spec.searchTerm}, ${spec.region}`);
  url.searchParams.set('limit', String(Math.min(spec.maxRecords, MAPS_RESULT_CEILING)));
  url.searchParams.set('region', spec.countryCode.toUpperCase());
  url.searchParams.set('dropDuplicates', 'true');
  url.searchParams.set('async', 'true');
  return `${url.pathname}${url.search}`;
}

export const outscraperProvider: MapsProvider = {
  name: 'outscraper',
  supportsAdoption: false,

  get configured() {
    return !!env.OUTSCRAPER_API_KEY;
  },

  inputHash(spec) {
    return createHash('sha256').update(`outscraper:${query(spec)}`).digest('hex').slice(0, 32);
  },

  async startRun(spec) {
    const body = await call<{ id: string }>(query(spec));
    // One handle serves as both: the pipeline never inspects either value.
    return { runId: body.id, datasetId: body.id };
  },

  async pollRun(runId) {
    const body = await call<{ status?: string; data?: unknown }>(`/requests/${runId}`);
    const status = (body.status ?? '').toUpperCase();
    return {
      status:
        status === 'SUCCESS' ? 'succeeded' : status === 'FAILURE' ? 'failed' : 'running',
      datasetId: runId,
      // Outscraper doesn't report per-request spend on the results endpoint.
      costUsd: null,
      detail: body.status ?? null,
    };
  },

  async fetchPage(datasetId, offset, limit) {
    const body = await call<{ data?: Record<string, unknown>[][] }>(`/requests/${datasetId}`);
    const rows = body.data?.[0] ?? [];
    return rows.slice(offset, offset + limit).map(toRawPlace);
  },

  /** No such API. See the note at the top of this file. */
  async findRunsByInput() {
    return [];
  },
};
