/**
 * Write-side command cores for Logo Studio. Pure functions over `db`; the router
 * enforces brand access before calling. Status transitions:
 *   brief → concepts → studio → system → complete
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { logoGenerations, logoProjects } from '../../db/schema.js';
import { heuristicUniqueness } from './generation.js';
import { brandSlug, shareTokenFor } from './share-link.js';
import type {
  GeneratedConcept,
  LogoBrief,
  LogoEdit,
  LogoGeneration,
  LogoProject,
  LogoSpec,
} from './types.js';

export type ProjectStatus = 'brief' | 'concepts' | 'studio' | 'system' | 'complete';

/** Advance status only forward (never regress a project on a late save). */
const ORDER: ProjectStatus[] = ['brief', 'concepts', 'studio', 'system', 'complete'];
function maxStatus(a: string, b: ProjectStatus): ProjectStatus {
  const ai = ORDER.indexOf(a as ProjectStatus);
  const bi = ORDER.indexOf(b);
  return ORDER[Math.max(ai, bi)] ?? b;
}

export async function ensureProject(
  db: DB,
  brandId: string,
  name: string,
  userId: string | null,
): Promise<LogoProject> {
  const [existing] = await db
    .select()
    .from(logoProjects)
    .where(eq(logoProjects.brandId, brandId))
    .orderBy(sql`${logoProjects.updatedAt} DESC`)
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(logoProjects)
    .values({ brandId, name, createdByUserId: userId, status: 'brief' })
    .returning();
  return created;
}

export async function createProject(
  db: DB,
  brandId: string,
  name: string,
  userId: string | null,
): Promise<LogoProject> {
  const [created] = await db
    .insert(logoProjects)
    .values({ brandId, name, createdByUserId: userId, status: 'brief' })
    .returning();
  return created;
}

export async function saveBrief(db: DB, projectId: string, brief: LogoBrief): Promise<LogoProject> {
  const [row] = await db.select().from(logoProjects).where(eq(logoProjects.id, projectId)).limit(1);
  const [updated] = await db
    .update(logoProjects)
    .set({
      brief,
      name: brief.businessName || row?.name || 'Untitled',
      status: maxStatus(row?.status ?? 'brief', 'concepts'),
    })
    .where(eq(logoProjects.id, projectId))
    .returning();
  return updated;
}

/** Persist a batch of generated concepts as rows; returns the inserted rows. */
export async function insertGenerations(
  db: DB,
  projectId: string,
  brandId: string,
  concepts: GeneratedConcept[],
  provider: string,
  prompt: string,
): Promise<LogoGeneration[]> {
  if (!concepts.length) return [];
  const values = concepts.map((c) => ({
    projectId,
    brandId,
    provider,
    kind: c.kind,
    name: c.name,
    note: c.note,
    svg: c.svg,
    spec: c.spec as LogoSpec,
    uniqueness: heuristicUniqueness(c),
    prompt,
    saved: false,
  }));
  return db.insert(logoGenerations).values(values).returning();
}

/** Insert a single iterated generation with a parent lineage link. */
export async function insertIteration(
  db: DB,
  projectId: string,
  brandId: string,
  parentId: string,
  concept: GeneratedConcept,
  provider: string,
  instruction: string,
): Promise<LogoGeneration> {
  const [row] = await db
    .insert(logoGenerations)
    .values({
      projectId,
      brandId,
      parentId,
      provider,
      kind: concept.kind,
      name: concept.name,
      note: concept.note,
      svg: concept.svg,
      spec: concept.spec as LogoSpec,
      uniqueness: heuristicUniqueness(concept),
      prompt: instruction,
      saved: false,
    })
    .returning();
  return row;
}

export async function toggleSaved(db: DB, generationId: string, saved: boolean): Promise<void> {
  await db.update(logoGenerations).set({ saved }).where(eq(logoGenerations.id, generationId));
}

/** Commit to a concept: set it chosen + advance the project to the studio stage. */
export async function chooseGeneration(
  db: DB,
  projectId: string,
  generationId: string,
): Promise<LogoProject> {
  const [row] = await db.select().from(logoProjects).where(eq(logoProjects.id, projectId)).limit(1);
  const [updated] = await db
    .update(logoProjects)
    .set({ chosenGenerationId: generationId, status: maxStatus(row?.status ?? 'concepts', 'studio') })
    .where(eq(logoProjects.id, projectId))
    .returning();
  return updated;
}

/**
 * Persist editor edits to a generation (SVG / spec / name), optionally recording
 * the inspector journal alongside them.
 *
 * Spec and journal move in ONE statement on purpose: they are two halves of the
 * same fact, and a spec that saved without its journal entry is a change undo can
 * no longer reverse.
 */
export async function updateGeneration(
  db: DB,
  generationId: string,
  patch: { svg?: string; spec?: LogoSpec; name?: string; note?: string; edits?: LogoEdit[] },
): Promise<LogoGeneration> {
  const [updated] = await db
    .update(logoGenerations)
    .set(patch)
    .where(eq(logoGenerations.id, generationId))
    .returning();
  return updated;
}

export async function setUniqueness(db: DB, generationId: string, score: number): Promise<void> {
  await db.update(logoGenerations).set({ uniqueness: score }).where(eq(logoGenerations.id, generationId));
}

export async function setProjectStatus(db: DB, projectId: string, status: ProjectStatus): Promise<void> {
  const [row] = await db.select().from(logoProjects).where(eq(logoProjects.id, projectId)).limit(1);
  await db
    .update(logoProjects)
    .set({ status: maxStatus(row?.status ?? 'brief', status) })
    .where(eq(logoProjects.id, projectId));
}

export async function stampRightsAssigned(db: DB, projectId: string): Promise<void> {
  await db.update(logoProjects).set({ rightsAssignedAt: new Date() }).where(eq(logoProjects.id, projectId));
}

export async function setStyleLock(
  db: DB,
  projectId: string,
  styleLock: LogoProject['styleLock'],
): Promise<void> {
  await db.update(logoProjects).set({ styleLock }).where(eq(logoProjects.id, projectId));
}

/**
 * Mark a project as the brand's active one. "Active" is defined as the
 * most-recently-updated project (see queries.getActiveProject), so opening one is
 * a touch of `updatedAt` — the selection then survives a refresh and follows the
 * user across devices without a second source of truth.
 */
export async function renameProject(db: DB, projectId: string, name: string): Promise<void> {
  await db.update(logoProjects).set({ name }).where(eq(logoProjects.id, projectId));
}

export async function touchProject(db: DB, projectId: string): Promise<LogoProject | null> {
  const [row] = await db
    .update(logoProjects)
    .set({ updatedAt: new Date() })
    .where(eq(logoProjects.id, projectId))
    .returning();
  return row ?? null;
}

/* ── guidelines sharing ─────────────────────────────────────────────────── */

/**
 * Ensure the project has a public guidelines link, returning it.
 *
 * The token is the credential AND the URL, so it is deliberately readable:
 * `acme-coffee/v2` is something you can say out loud to a printer. Versions are
 * per SLUG, not per brand, which does double duty — a brand's second rulebook is
 * naturally v2, and two brands that reduce to the same words still get distinct
 * links instead of colliding.
 *
 * Idempotent: a project that already has a link keeps it. Nothing here revokes —
 * a shared rulebook stays shared (see the router's `share` procedure).
 *
 * TRADE-OFF, stated plainly: a readable token is a guessable one. This page is a
 * read-only brand rulebook meant to be handed around, and it exposes nothing
 * about the account, but it is no longer secret-by-entropy. The unique index from
 * migration 0078 is what stops two concurrent presses minting the same version;
 * the retry below turns that race into the next free number.
 */
export async function ensureGuidelinesShare(
  db: DB,
  projectId: string,
  brandName: string,
): Promise<string> {
  const [existing] = await db
    .select({ shareToken: logoProjects.shareToken })
    .from(logoProjects)
    .where(eq(logoProjects.id, projectId))
    .limit(1);
  if (existing?.shareToken) return existing.shareToken;

  const slug = brandSlug(brandName);
  const taken = await db
    .select({ shareToken: logoProjects.shareToken })
    .from(logoProjects)
    .where(like(logoProjects.shareToken, `${slug}/v%`));
  let next = 1;
  for (const row of taken) {
    const n = Number(row.shareToken?.slice(slug.length + 2));
    if (Number.isInteger(n) && n >= next) next = n + 1;
  }

  // A handful of attempts covers a concurrent press; past that, fall back to an
  // opaque token so sharing never hard-fails on a naming collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = shareTokenFor(slug, next + attempt);
    try {
      await db.update(logoProjects).set({ shareToken: token }).where(eq(logoProjects.id, projectId));
      return token;
    } catch {
      // Unique violation — someone else took this version. Try the next one.
    }
  }
  const fallback = `${slug}/v${randomBytes(3).toString('hex')}`;
  await db.update(logoProjects).set({ shareToken: fallback }).where(eq(logoProjects.id, projectId));
  return fallback;
}

/**
 * Stamp the rights assignment the first time a brand downloads finished assets.
 * "You own it when you download" (DESIGN.md 06) is a real commitment, so record
 * WHEN it happened — and never overwrite the original timestamp.
 */
export async function stampRightsOnce(db: DB, projectId: string): Promise<void> {
  await db
    .update(logoProjects)
    .set({ rightsAssignedAt: new Date() })
    .where(and(eq(logoProjects.id, projectId), isNull(logoProjects.rightsAssignedAt)));
}
