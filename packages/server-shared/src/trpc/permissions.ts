import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { agencies, brands, staff, brandAgencyConnections } from '../db/schema.js';
import type { Context } from './context.js';

/**
 * Permission vocabularies, split by org context. Every staff permission belongs
 * to exactly one of these (some names are shared — e.g. `documents`, `proposals`,
 * `staffManagement` — because each org legitimately has that capability for ITS
 * OWN data, and the check always runs against that org's staff row).
 *
 * These types are the structural guard the rest of the file relies on: a brand
 * access check (`assertBrandAccess` / the `brandPermission` of
 * `assertBrandViewAccess`) can ONLY be handed a `BrandPermission`, and an agency
 * check ONLY an `AgencyPermission`. Passing the wrong context's permission is a
 * compile error — which is exactly how the overloaded `businessInfo` bug (an
 * agency managing a client's Info Hub was wrongly gated on a brand permission)
 * is prevented from ever recurring. See docs/permissions.md.
 */
export type AgencyPermission =
  | 'agencyDashboard'
  | 'agencyProjects' | 'addBrief' | 'allocatePeople' | 'approveDeliverable'
  | 'catalog' | 'clients' | 'proposals'
  | 'manageResources' | 'manageContractors' | 'staffManagement' | 'documents' | 'resources'
  | 'chatWithContractors' | 'chatWithStaffs' | 'chatWithBrands'
  | 'rolesAndCommissions' | 'invoice' | 'subscriptions' | 'bankAccount'
  | 'agencyInfo' | 'agencyBusinessInfo' | 'infin8';

export type BrandPermission =
  | 'brandDashboard' | 'brandProjects' | 'infin8'
  | 'brandBusinessInfo' | 'brandGuidelines' | 'documents' | 'resources'
  | 'links' | 'linksViewer' | 'payments' | 'paymentsViewer' | 'subscriptions'
  | 'reviews' | 'reviewsViewer'
  | 'signatures'
  | 'logo'
  | 'staffManagement' | 'proposals' | 'chatWithStaffs';

/**
 * Resolve a user's access to an AGENCY.
 * Owners get everything. Active staff are checked against their permission list.
 */
export async function assertAgencyAccess(
  ctx: Context,
  agencyId: string,
  permission?: AgencyPermission,
): Promise<{ isOwner: boolean }> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (ctx.user.isSuperAdmin) return { isOwner: true };

  const agency = (await ctx.db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0];
  if (!agency) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agency not found' });
  if (agency.ownerId === ctx.user.id) return { isOwner: true };

  const member = (
    await ctx.db
      .select()
      .from(staff)
      .where(and(eq(staff.agencyId, agencyId), eq(staff.userId, ctx.user.id), eq(staff.status, 'active')))
      .limit(1)
  )[0];

  if (!member) {
    // A brand's derived "shadow" agency (agencies.derived_from_brand_id) is managed
    // by the brand's OWN members, not separate agency staff: the brand owner already
    // matched above (they own the derived agency), and this admits active brand staff
    // too — the brand's catalogue needs no agency-level permission. See
    // ensureDerivedAgency / docs on derived agencies.
    if (agency.derivedFromBrandId) {
      await assertBrandAccess(ctx, agency.derivedFromBrandId);
      return { isOwner: false };
    }
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this agency' });
  }
  if (permission) {
    const effective = expandAgencyPermissions(member.permissions, agency, ctx.user.id);
    if (!effective.has(permission)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Missing permission: ${permission}` });
    }
  }
  return { isOwner: false };
}

/** Resolve a user's access to a BRAND (owner or active staff). */
export async function assertBrandAccess(
  ctx: Context,
  brandId: string,
  permission?: BrandPermission,
): Promise<{ isOwner: boolean }> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (ctx.user.isSuperAdmin) return { isOwner: true };

  const brand = (await ctx.db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
  if (!brand) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
  if (brand.ownerId === ctx.user.id) return { isOwner: true };

  const member = (
    await ctx.db
      .select()
      .from(staff)
      .where(and(eq(staff.brandId, brandId), eq(staff.userId, ctx.user.id), eq(staff.status, 'active')))
      .limit(1)
  )[0];

  if (!member) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this brand' });
  if (permission && !hasPermission(member.permissions, permission)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Missing permission: ${permission}` });
  }
  return { isOwner: false };
}

/**
 * Like `assertBrandAccess`, but admits a staff member holding ANY ONE of the
 * given permissions (owner/super-admin always pass). Used where a read is allowed
 * for several roles — e.g. short links are viewable by both `links` (editor) and
 * `linksViewer` staff.
 */
export async function assertBrandAccessAny(
  ctx: Context,
  brandId: string,
  permissions: readonly BrandPermission[],
): Promise<{ isOwner: boolean }> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (ctx.user.isSuperAdmin) return { isOwner: true };

  const brand = (await ctx.db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
  if (!brand) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
  if (brand.ownerId === ctx.user.id) return { isOwner: true };

  const member = (
    await ctx.db
      .select()
      .from(staff)
      .where(and(eq(staff.brandId, brandId), eq(staff.userId, ctx.user.id), eq(staff.status, 'active')))
      .limit(1)
  )[0];

  if (!member) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this brand' });
  if (permissions.length && !permissions.some((p) => hasPermission(member.permissions, p))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Missing permission: ${permissions.join(' or ')}` });
  }
  return { isOwner: false };
}

/**
 * Resolve a user's access to VIEW (and, depending on the procedure, manage) a
 * brand, allowing three identities:
 *   1. the brand owner,
 *   2. active brand staff (checked against `brandPermission`), and
 *   3. an owner / active staff member of an agency CONNECTED to the brand
 *      (checked against `agencyPermission`).
 *
 * This is the server counterpart of the Flutter route-access rule that lets an
 * agency open a connected brand's Billing / Subscriptions / Info Hub screens
 * (`/payments/:brandId`, `/subscriptions/:brandId`, client_detail_screen.dart).
 * `assertBrandAccess` deliberately stays brand-only; use this where a connected
 * agency is also allowed in.
 *
 * Returns `viaAgencyId` = the connected agency the access was granted through
 * (null when the viewer is the brand itself / a super-admin), so callers can
 * scope results to that agency.
 */
export async function assertBrandViewAccess(
  ctx: Context,
  brandId: string,
  opts: {
    brandPermission?: BrandPermission;
    agencyPermission?: AgencyPermission;
    /**
     * The agency the caller is explicitly acting as (e.g. from a client's hub on
     * the agency Clients screen). When set and valid, this identity WINS — the
     * action is owned by that agency (`viaAgencyId`), not by an incidental
     * brand-staff/brand-owner membership the same user may also hold. This is what
     * keeps an agency-built section tagged to the agency even when the operator is
     * also a member of the brand.
     */
    actingAgencyId?: string;
  } = {},
): Promise<{ isOwner: boolean; viaAgencyId: string | null }> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (ctx.user.isSuperAdmin) return { isOwner: true, viaAgencyId: null };
  const userId = ctx.user.id;

  const brand = (await ctx.db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
  if (!brand) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });

  // Agencies connected to this brand (the only agencies whose members may act on it).
  const conns = await ctx.db
    .select({ agencyId: brandAgencyConnections.agencyId })
    .from(brandAgencyConnections)
    .where(eq(brandAgencyConnections.brandId, brandId));
  const connectedAgencyIds = conns.map((c) => c.agencyId);

  // Can the current user act for a given connected agency (owner, or active staff
  // holding `agencyPermission`)? Used both for the explicit acting-agency identity
  // and the fallback scan below.
  const canActForAgency = async (agencyId: string): Promise<boolean> => {
    if (!connectedAgencyIds.includes(agencyId)) return false;
    const ag = (await ctx.db.select({ ownerId: agencies.ownerId }).from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0];
    if (ag && ag.ownerId === userId) return true;
    const m = (
      await ctx.db
        .select()
        .from(staff)
        .where(and(eq(staff.agencyId, agencyId), eq(staff.userId, userId), eq(staff.status, 'active')))
        .limit(1)
    )[0];
    return !!m && (!opts.agencyPermission || hasPermission(m.permissions, opts.agencyPermission));
  };

  // This is an EITHER/OR gate: the user is admitted if ANY of their identities
  // qualifies. A failing identity FALLS THROUGH to the next — never short-circuits
  // — so a user who is e.g. both brand staff (without the brand permission) AND the
  // connected agency's owner is not wrongly denied.

  // 0. Explicit acting-agency identity wins when valid (see opts.actingAgencyId).
  if (opts.actingAgencyId && (await canActForAgency(opts.actingAgencyId))) {
    return { isOwner: false, viaAgencyId: opts.actingAgencyId };
  }

  // 1. Brand owner.
  if (brand.ownerId === userId) return { isOwner: true, viaAgencyId: null };

  // 2. Active brand staff WITH the brand permission.
  const brandMember = (
    await ctx.db
      .select()
      .from(staff)
      .where(and(eq(staff.brandId, brandId), eq(staff.userId, userId), eq(staff.status, 'active')))
      .limit(1)
  )[0];
  if (brandMember && (!opts.brandPermission || hasPermission(brandMember.permissions, opts.brandPermission))) {
    return { isOwner: false, viaAgencyId: null };
  }

  // 3. Any connected agency the user can act for.
  for (const aId of connectedAgencyIds) {
    if (await canActForAgency(aId)) return { isOwner: false, viaAgencyId: aId };
  }

  throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this brand' });
}

export function hasPermission(permissions: readonly string[], needed: string): boolean {
  return permissions.includes(needed);
}

/** The agency workflow permissions that each imply project-board view access. */
const AGENCY_WORKFLOW_PERMS = ['addBrief', 'allocatePeople', 'approveDeliverable'] as const;

/**
 * Expand a staff member's stored permissions with implied ones for an agency.
 *
 * Holding any Project Management permission — or being assigned a workflow role
 * designee (Briefing / Allocation / Internal approval, set in Roles & Commissions) —
 * implies `agencyProjects` (View Projects), so those people see the projects tab
 * without it being ticked separately. See docs/kanban-permissions.md.
 */
export function expandAgencyPermissions(
  permissions: readonly string[],
  agency: { briefingDesigneeId: string | null; allocationDesigneeId: string | null; approvalDesigneeId: string | null } | null,
  userId: string,
): Set<string> {
  const set = new Set(permissions);
  const isDesignee =
    !!agency &&
    (agency.briefingDesigneeId === userId ||
      agency.allocationDesigneeId === userId ||
      agency.approvalDesigneeId === userId);
  if (isDesignee || AGENCY_WORKFLOW_PERMS.some((p) => set.has(p))) set.add('agencyProjects');
  return set;
}
