/**
 * Services catalog — shared read/query helpers used by BOTH the tRPC
 * `servicesRouter` and the AI chatbot's brand-services tools (ai/tools/services.ts).
 *
 * Functions take an already-resolved `agencyId` (for the chatbot this is the
 * brand's derived shadow agency) and perform NO auth — the caller gates first
 * (tRPC via assertAgencyAccess, the tool via the brand-bound shadow agency).
 */
import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { services } from '../../db/schema.js';

export interface BrandServiceListOpts {
  search?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

/** Shared WHERE for the catalog: agency-scoped, non-deleted, active unless asked,
 * with an optional name/description substring match. */
function brandServiceFilters(agencyId: string, opts: BrandServiceListOpts): SQL[] {
  const filters: SQL[] = [eq(services.agencyId, agencyId), isNull(services.deletedAt)];
  if (!opts.includeInactive) filters.push(eq(services.isActive, true));
  const search = opts.search?.trim();
  if (search) {
    const q = `%${search}%`;
    filters.push(or(ilike(services.name, q), ilike(services.description, q))!);
  }
  return filters;
}

/** An agency's catalog rows in catalog order (sortOrder, name). Callers project. */
export async function listBrandServices(db: DB, agencyId: string, opts: BrandServiceListOpts = {}) {
  const where = and(...brandServiceFilters(agencyId, opts));
  let q = db.select().from(services).where(where).orderBy(asc(services.sortOrder), asc(services.name)).$dynamic();
  if (opts.limit !== undefined) q = q.limit(opts.limit);
  if (opts.offset !== undefined) q = q.offset(opts.offset);
  return q;
}

/** Total catalog rows matching the same filters (for paginated callers). */
export async function countBrandServices(db: DB, agencyId: string, opts: BrandServiceListOpts = {}): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(services)
    .where(and(...brandServiceFilters(agencyId, opts)));
  return Number(value);
}

/**
 * Every non-deleted service name in this agency's catalog (id + name), incl.
 * inactive/draft rows. Used by the chatbot to spot a SIMILAR existing service
 * before proposing a new one (see findSimilarByName in ai/tools/helpers.ts).
 */
export async function listBrandServiceNames(db: DB, agencyId: string) {
  return db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.agencyId, agencyId), isNull(services.deletedAt)))
    .limit(500);
}

/**
 * One catalog service, tenancy-guarded to the agency and excluding soft-deleted
 * rows (unlike the public `services.byId`, which fetches any row by UUID).
 */
export async function getBrandService(db: DB, agencyId: string, serviceId: string) {
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.agencyId, agencyId), isNull(services.deletedAt)))
    .limit(1);
  return row ?? null;
}
