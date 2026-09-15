import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { env } from '../lib/env.js';

/**
 * Google Places address autocomplete — proxied through the backend so the API
 * key (GOOGLE_MAPS_API_KEY) never reaches the browser. The SPA calls these
 * procedures instead of loading the Maps JS SDK with an embedded key.
 *
 * Uses the Places API (New) REST endpoints:
 *   - POST https://places.googleapis.com/v1/places:autocomplete
 *   - GET  https://places.googleapis.com/v1/places/{placeId}
 *
 * A `sessionToken` (a client-generated UUID reused across the keystrokes of one
 * lookup and the final details call) lets Google bill autocomplete + details as
 * a single session. It's optional but recommended.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }>;
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}
interface DetailsResponse {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: AddressComponent[];
}

/** Structured address parts parsed from Google's addressComponents, for filling a
 *  multi-field form (houseNumber/line1/city/state/postcode/country). */
export interface ParsedAddress {
  houseNumber: string;
  line1: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

function parseComponents(components: AddressComponent[] = []): ParsedAddress {
  const find = (type: string, short = false): string => {
    const c = components.find((x) => x.types?.includes(type));
    return (short ? c?.shortText : c?.longText) ?? '';
  };
  // House/street number is its own form field, so line1 carries only the street
  // name (route). Falls back to the number if a route is somehow missing.
  const houseNumber = find('street_number');
  const route = find('route');
  return {
    houseNumber,
    line1: route || houseNumber,
    city:
      find('locality') ||
      find('postal_town') ||
      find('administrative_area_level_2'),
    state: find('administrative_area_level_1', true),
    postcode: find('postal_code'),
    country: find('country'),
  };
}

function requireKey(): string {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Address autocomplete is not configured (GOOGLE_MAPS_API_KEY is unset).',
    });
  }
  return key;
}

export const placesRouter = router({
  /** Whether the server has a Places key configured (lets the UI fall back to a plain input). */
  enabled: protectedProcedure.query(() => ({ enabled: !!env.GOOGLE_MAPS_API_KEY })),

  /** Address predictions for a partial query. Returns [] for trivially short input. */
  autocomplete: protectedProcedure
    .input(
      z.object({
        input: z.string().max(200),
        sessionToken: z.string().max(100).optional(),
      }),
    )
    .query(async ({ input }) => {
      const query = input.input.trim();
      if (query.length < 3) return { predictions: [] as { placeId: string; description: string }[] };
      const key = requireKey();

      const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
        },
        body: JSON.stringify({
          input: query,
          ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Places autocomplete failed (${res.status}). ${detail.slice(0, 300)}`,
        });
      }

      const data = (await res.json()) as AutocompleteResponse;
      const predictions = (data.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
        .map((p) => ({ placeId: p.placeId!, description: p.text?.text ?? '' }));
      return { predictions };
    }),

  /** Resolve a placeId to a formatted address + coordinates. */
  details: protectedProcedure
    .input(
      z.object({
        placeId: z.string().min(1).max(300),
        sessionToken: z.string().max(100).optional(),
      }),
    )
    .query(async ({ input }) => {
      const key = requireKey();
      const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(input.placeId)}`);
      if (input.sessionToken) url.searchParams.set('sessionToken', input.sessionToken);

      const res = await fetch(url, {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
        },
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Place details failed (${res.status}). ${detail.slice(0, 300)}`,
        });
      }

      const data = (await res.json()) as DetailsResponse;
      return {
        placeId: data.id ?? input.placeId,
        address: data.formattedAddress ?? '',
        lat: data.location?.latitude,
        lng: data.location?.longitude,
        // Structured parts for multi-field forms (reward shipping address, etc.).
        parsed: parseComponents(data.addressComponents),
      };
    }),
});
