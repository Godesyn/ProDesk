import { z } from 'zod';
import { and, eq, isNull, isNotNull, or, count, asc, desc, inArray, ilike, arrayContains, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { files, folders, brandAgencyConnections, agencies } from '../db/schema.js';
import { assertBrandAccess, assertAgencyAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';

/**
 * Document Locker tabs (document_locker_screen.dart):
 *  - agency:  files scoped to an agency (agencyId set, not private)
 *  - public:  brand-owned public assets (no agency) OR an agency file flagged
 *             public (e.g. a published Info Hub section, shown with its agency
 *             name) — i.e. `agencyId IS NULL OR isPublic`, not private
 *  - private: brand private documents (isPrivate = true)
 */
const tab = z.enum(['agency', 'public', 'private']);

export const filesRouter = router({
  /** Files in a brand's document locker (optionally within a folder / tab / agency). */
  list: protectedProcedure
    .input(
      paginationInput.extend({
        brandId: z.string().uuid(),
        folderId: z.string().uuid().nullable().optional(),
        tab: tab.optional(),
        agencyId: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'documents');
      const filters = [eq(files.brandId, input.brandId), isNull(files.deletedAt)];
      if (input.folderId !== undefined) filters.push(input.folderId ? eq(files.folderId, input.folderId) : isNull(files.folderId));

      // Tab scoping. `agency` may further filter by a specific agencyId chip.
      if (input.tab === 'private') {
        filters.push(eq(files.isPrivate, true));
      } else if (input.tab === 'public') {
        filters.push(eq(files.isPrivate, false), or(isNull(files.agencyId), eq(files.isPublic, true))!);
      } else if (input.tab === 'agency') {
        // Agency Documents are owned by an agency. Without the agencyId guard a
        // brand-owned public asset (agencyId null, not private) would leak here.
        filters.push(eq(files.isPrivate, false), isNotNull(files.agencyId));
        // The chip matches a file that belongs to that agency — primary OR a
        // member of its multi-agency set (group-chat docs span several).
        if (input.agencyId !== undefined && input.agencyId !== null) {
          filters.push(or(eq(files.agencyId, input.agencyId), arrayContains(files.agencyIds, [input.agencyId]))!);
        }
      }

      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(files).where(where).orderBy(asc(files.sortOrder), desc(files.uploadedAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(files).where(where),
      ]);
      return page(rows, total, input);
    }),

  /**
   * Agency-side view of a connected client's locker (Clients → brand → Files),
   * folder-aware. Shows ONLY the brand's public assets + THIS agency's own
   * documents — never the brand's private docs or another agency's documents.
   *
   * Folder visibility rule: a brand-created folder is shown to the agency only
   * if it (or a descendant) contains at least one file owned by THIS agency.
   * Ancestors of such a folder are included so the agency can navigate to it.
   * Authorized via agency `clients` permission + an active connection.
   */
  clientView: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid(), folderId: z.string().uuid().nullable().optional() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'clients');
      const conn = (
        await ctx.db
          .select({ id: brandAgencyConnections.id })
          .from(brandAgencyConnections)
          .where(and(eq(brandAgencyConnections.brandId, input.brandId), eq(brandAgencyConnections.agencyId, input.agencyId)))
          .limit(1)
      )[0];
      if (!conn && !ctx.user.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not connected to this client' });
      const level = input.folderId ?? null;

      // Files this agency may see anywhere in the locker — either is true:
      //  - PUBLIC: a brand-owned asset (agencyId null) or any file flagged
      //    isPublic, regardless of which agency owns it (public brand assets are
      //    visible to every connected agency);
      //  - OURS: a doc this agency owns (primary agency or a member of the
      //    file's multi-agency set).
      const visibleFiles = await ctx.db
        .select()
        .from(files)
        .where(
          and(
            eq(files.brandId, input.brandId),
            isNull(files.deletedAt),
            eq(files.isPrivate, false),
            or(
              isNull(files.agencyId),
              eq(files.isPublic, true),
              eq(files.agencyId, input.agencyId),
              arrayContains(files.agencyIds, [input.agencyId]),
            )!,
          ),
        )
        .orderBy(asc(files.sortOrder), desc(files.uploadedAt));

      // Folders visible to this agency = those that (directly) hold a file this
      // agency may see — either one of its own docs OR a public brand asset —
      // plus every ancestor on the way to them. (visibleFiles is exactly that
      // set, so any of them with a folder reveals it.)
      const allFolders = await ctx.db.select().from(folders).where(eq(folders.brandId, input.brandId));
      const parentOf = new Map(allFolders.map((f) => [f.id, f.parentId ?? null]));
      const visibleFolderIds = new Set<string>();
      for (const f of visibleFiles) {
        if (f.folderId) {
          let cur: string | null = f.folderId;
          while (cur && !visibleFolderIds.has(cur)) {
            visibleFolderIds.add(cur);
            cur = parentOf.get(cur) ?? null;
          }
        }
      }
      const visibleFolders = allFolders.filter((f) => visibleFolderIds.has(f.id));

      // Files surface at root, or inside a visible folder once navigated into it.
      const items = visibleFiles.filter((f) => (f.folderId ?? null) === level && (level === null || visibleFolderIds.has(level)));
      const childFolders = visibleFolders.filter((f) => (f.parentId ?? null) === level);
      return { items, folders: childFolders, tree: visibleFolders };
    }),

  /**
   * Global search across a brand's WHOLE locker — every tab and folder at once
   * (Agency Documents + Public Brand Assets + Private). Matches the file name,
   * the project title it came from, AND the owning agency's name. Backs the
   * search box above the tabs.
   */
  search: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'documents');
      const q = `%${input.query}%`;
      return ctx.db
        .select()
        .from(files)
        .where(
          and(
            eq(files.brandId, input.brandId),
            isNull(files.deletedAt),
            or(
              ilike(files.name, q),
              ilike(files.projectTitle, q),
              // Any owning agency's name (primary or a member of the set).
              sql`EXISTS (SELECT 1 FROM ${agencies} a WHERE (a.id = ${files.agencyId} OR a.id = ANY(${files.agencyIds})) AND a.business_name ILIKE ${q})`,
            )!,
          ),
        )
        .orderBy(asc(files.sortOrder), desc(files.uploadedAt))
        .limit(100);
    }),

  /**
   * Folders for a brand, scoped to a tab (the client builds the tree +
   * breadcrumbs). Folders are brand-created with a "home" tab via
   * isPrivate/isPublic, BUT a folder also surfaces in the Public tab when it
   * holds a public-visible file — even if its home is Agency Documents. That is
   * what lets a doc that is both agency-owned and public stay reachable under
   * Public Brand Assets when it's filed inside an agency folder (the same folder
   * then shows in both tabs; no duplicate folder is created).
   */
  folders: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), tab: tab.optional(), agencyId: z.string().uuid().nullable().optional() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'documents');
      const all = await ctx.db.select().from(folders).where(eq(folders.brandId, input.brandId)).orderBy(folders.name);
      if (!input.tab) return all;

      const parentOf = new Map(all.map((f) => [f.id, f.parentId ?? null]));
      // Expand a set of seed folder ids to include every ancestor (so a deep
      // folder stays navigable from the root).
      const withAncestors = (seeds: Iterable<string | null>) => {
        const out = new Set<string>();
        for (const s of seeds) {
          let cur: string | null = s;
          while (cur && !out.has(cur)) {
            out.add(cur);
            cur = parentOf.get(cur) ?? null;
          }
        }
        return out;
      };

      if (input.tab === 'private') return all.filter((f) => f.isPrivate);

      if (input.tab === 'agency') {
        const home = all.filter((f) => !f.isPrivate && !f.isPublic);
        if (!input.agencyId) return home;
        // Chip: keep only agency folders whose subtree holds that agency's files.
        const agencyFiles = await ctx.db
          .select({ folderId: files.folderId })
          .from(files)
          .where(
            and(
              eq(files.brandId, input.brandId),
              isNull(files.deletedAt),
              isNotNull(files.folderId),
              or(eq(files.agencyId, input.agencyId), arrayContains(files.agencyIds, [input.agencyId]))!,
            ),
          );
        const vis = withAncestors(agencyFiles.map((f) => f.folderId));
        return home.filter((f) => vis.has(f.id));
      }

      // public: brand-created public folders + any folder (incl. an agency one)
      // holding a public-visible file in its subtree, plus ancestors.
      const publicFiles = await ctx.db
        .select({ folderId: files.folderId })
        .from(files)
        .where(
          and(
            eq(files.brandId, input.brandId),
            isNull(files.deletedAt),
            eq(files.isPrivate, false),
            isNotNull(files.folderId),
            or(isNull(files.agencyId), eq(files.isPublic, true))!,
          ),
        );
      const homePublic = all.filter((f) => !f.isPrivate && f.isPublic).map((f) => f.id);
      const visible = withAncestors([...homePublic, ...publicFiles.map((f) => f.folderId)]);
      return all.filter((f) => visible.has(f.id));
    }),

  /**
   * Create a folder. Folders are always BRAND-owned organisational containers —
   * agencies never create folders in a brand's locker (they only upload files
   * from the Clients screen). The tab is captured via isPrivate/isPublic.
   */
  createFolder: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        name: z.string().min(1),
        parentId: z.string().uuid().optional(),
        isPrivate: z.boolean().optional(),
        isPublic: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Brand-only: assertBrandAccess admits the brand owner/staff (with the
      // `documents` permission) and super-admin. An agency member viewing a
      // client's files has no brand `documents` access, so this throws for them
      // — agencies can never create folders in a brand's locker.
      await assertBrandAccess(ctx, input.brandId, 'documents');
      const [f] = await ctx.db
        .insert(folders)
        .values({
          brandId: input.brandId,
          name: input.name,
          parentId: input.parentId,
          isPrivate: input.isPrivate ?? false,
          isPublic: input.isPublic ?? false,
          createdBy: ctx.user.id,
        })
        .returning();
      return f;
    }),

  /** Persist an OS-style drag-to-reorder of files (full id list in new order). */
  reorder: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'documents');
      await Promise.all(
        input.orderedIds.map((id, i) =>
          ctx.db.update(files).set({ sortOrder: i }).where(and(eq(files.id, id), eq(files.brandId, input.brandId))),
        ),
      );
      return { ok: true };
    }),

  /** Register a file row after the client uploads to Supabase Storage. */
  register: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        name: z.string(),
        url: z.string().url(),
        size: z.number().optional(),
        type: z.string().optional(),
        category: z.string().optional(),
        folderId: z.string().uuid().optional(),
        agencyId: z.string().uuid().optional(),
        isPrivate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'documents');
      // TODO(by ai): the actual binary upload to Supabase Storage happens on the
      // client; this records the resulting object URL + metadata.
      const note = input.agencyId ? 'Uploaded by the agency' : ctx.user.isSuperAdmin ? 'Uploaded by an admin' : 'Uploaded by the brand';
      const [f] = await ctx.db
        .insert(files)
        .values({ ...input, uploadedBy: ctx.user.id, source: input.agencyId ? 'agency' : 'brand', note })
        .returning();
      return f;
    }),

  /** Rename a file (the locker file name shown everywhere — including the viewer header). */
  rename: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const f = (await ctx.db.select({ brandId: files.brandId }).from(files).where(eq(files.id, input.id)).limit(1))[0];
      if (!f?.brandId) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      await assertBrandAccess(ctx, f.brandId, 'documents');
      const [updated] = await ctx.db.update(files).set({ name: input.name }).where(eq(files.id, input.id)).returning();
      return updated;
    }),

  /**
   * Copy an agency document to Public Brand Assets as an INDEPENDENT duplicate.
   * The source file keeps its agency ownership and folder untouched; a brand-owned
   * copy (agencyId null, isPublic) is filed at the SAME path under the Public tab,
   * mirroring the source's folder chain by name and creating any missing public
   * folders on the way. Because the copy is its own row in its own folder set,
   * deleting it (or the agency original) never affects the other. The same storage
   * object is shared by URL — both rows soft-delete independently, so the binary
   * survives until both are gone. Idempotent: re-copying returns the existing copy.
   */
  copyToPublic: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const src = (await ctx.db.select().from(files).where(eq(files.id, input.id)).limit(1))[0];
      if (!src?.brandId) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      await assertBrandAccess(ctx, src.brandId, 'documents');
      const brandId = src.brandId;

      // Already copied? Return the existing public copy (same storage object, no
      // agency owner) so the still-visible button can't spawn duplicate rows.
      const existing = (
        await ctx.db
          .select()
          .from(files)
          .where(and(eq(files.brandId, brandId), eq(files.url, src.url), eq(files.isPublic, true), isNull(files.agencyId), isNull(files.deletedAt)))
          .limit(1)
      )[0];
      if (existing) return existing;

      // Resolve the source's folder chain (root → … → its folder) by name.
      const all: (typeof folders.$inferSelect)[] = await ctx.db.select().from(folders).where(eq(folders.brandId, brandId));
      const byId = new Map(all.map((f) => [f.id, f]));
      const chain: string[] = [];
      let cur = src.folderId ?? null;
      while (cur) {
        const f = byId.get(cur);
        if (!f) break;
        chain.unshift(f.name);
        cur = f.parentId ?? null;
      }

      // Mirror the chain under the Public tab: at each level find or create a
      // public folder (isPublic, !isPrivate) with the same name. These are a
      // separate folder set from the agency ones, so they delete independently.
      let parentId: string | null = null;
      for (const name of chain) {
        const found = all.find((f) => (f.parentId ?? null) === parentId && f.name === name && f.isPublic && !f.isPrivate);
        if (found) {
          parentId = found.id;
        } else {
          const created: typeof folders.$inferSelect = (
            await ctx.db
              .insert(folders)
              .values({ brandId, name, parentId: parentId ?? undefined, isPublic: true, isPrivate: false, createdBy: ctx.user.id })
              .returning()
          )[0];
          all.push(created);
          parentId = created.id;
        }
      }

      // Insert the independent brand-owned copy into the mirrored public folder.
      const [copy] = await ctx.db
        .insert(files)
        .values({
          brandId,
          name: src.name,
          url: src.url,
          size: src.size,
          type: src.type,
          category: src.category,
          folderId: parentId ?? undefined,
          isPublic: true,
          isPrivate: false,
          source: 'brand',
          uploadedBy: ctx.user.id,
          note: 'Copied to Public Brand Assets',
        })
        .returning();
      return copy;
    }),

  /** Rename a folder. */
  renameFolder: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const f = (await ctx.db.select({ brandId: folders.brandId }).from(folders).where(eq(folders.id, input.id)).limit(1))[0];
      if (!f?.brandId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
      await assertBrandAccess(ctx, f.brandId, 'documents');
      const [updated] = await ctx.db.update(folders).set({ name: input.name }).where(eq(folders.id, input.id)).returning();
      return updated;
    }),

  /** Move a file into a different folder (or to the root when folderId is null). */
  move: protectedProcedure
    .input(z.object({ id: z.string().uuid(), folderId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const f = (await ctx.db.select({ brandId: files.brandId }).from(files).where(eq(files.id, input.id)).limit(1))[0];
      if (!f?.brandId) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      await assertBrandAccess(ctx, f.brandId, 'documents');
      const [updated] = await ctx.db.update(files).set({ folderId: input.folderId }).where(eq(files.id, input.id)).returning();
      return updated;
    }),

  remove: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const f = (await ctx.db.select({ brandId: files.brandId }).from(files).where(eq(files.id, input.id)).limit(1))[0];
    if (f?.brandId) await assertBrandAccess(ctx, f.brandId, 'documents');
    await ctx.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, input.id));
    return { id: input.id };
  }),

  /**
   * Recursively delete a folder, its descendant folders, and soft-delete all
   * contained files. Ports document_locker_controller._deleteFolderRecursive.
   */
  removeFolder: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const root = (await ctx.db.select().from(folders).where(eq(folders.id, input.id)).limit(1))[0];
      if (!root?.brandId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
      await assertBrandAccess(ctx, root.brandId, 'documents');

      // Collect the full subtree (BFS over parentId).
      const all = await ctx.db.select({ id: folders.id, parentId: folders.parentId }).from(folders).where(eq(folders.brandId, root.brandId));
      const toDelete = new Set<string>([input.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of all) {
          if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
            toDelete.add(f.id);
            grew = true;
          }
        }
      }
      const ids = [...toDelete];
      await ctx.db.update(files).set({ deletedAt: new Date() }).where(inArray(files.folderId, ids));
      await ctx.db.delete(folders).where(inArray(folders.id, ids));
      return { ids };
    }),
});
