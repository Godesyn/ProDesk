/**
 * Read-side query cores for Logo Studio. Pure functions over `db` (no ctx/auth) so
 * both the tRPC router and any AI read-tools can share them. Auth stays in callers.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { logoGenerations, logoProjects } from '../../db/schema.js';
import type { ConceptView, LogoGeneration, LogoProject, LogoSpec } from './types.js';

const EMPTY_SPEC: LogoSpec = {
  palette: [],
  fonts: { heading: "'Inter Tight', system-ui, sans-serif", body: "'Inter Tight', system-ui, sans-serif" },
  geometry: '',
  rationale: '',
  elements: ['mark'],
};

/** Flatten a generation row into the client view (spec always present). */
export function toConceptView(row: LogoGeneration): ConceptView {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    name: row.name,
    kind: row.kind,
    note: row.note ?? '',
    svg: row.svg,
    spec: row.spec ?? EMPTY_SPEC,
    uniqueness: row.uniqueness,
    thumbUrl: row.thumbUrl,
    saved: row.saved,
    provider: row.provider,
    createdAt: row.createdAt.toISOString(),
    edits: row.edits ?? [],
  };
}

/** The most-recently-updated project for a brand, or null. */
export async function getActiveProject(db: DB, brandId: string): Promise<LogoProject | null> {
  const [row] = await db
    .select()
    .from(logoProjects)
    .where(eq(logoProjects.brandId, brandId))
    .orderBy(desc(logoProjects.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function getProject(db: DB, projectId: string): Promise<LogoProject | null> {
  const [row] = await db.select().from(logoProjects).where(eq(logoProjects.id, projectId)).limit(1);
  return row ?? null;
}

export async function listProjects(db: DB, brandId: string): Promise<LogoProject[]> {
  return db
    .select()
    .from(logoProjects)
    .where(eq(logoProjects.brandId, brandId))
    .orderBy(desc(logoProjects.updatedAt));
}

/**
 * Projects for a brand, each with its own chosen mark + concept count. The studio
 * home lists these; without the per-project mark every row would have to render
 * the ACTIVE project's mark, which is simply the wrong logo next to the wrong name.
 */
export async function listProjectSummaries(
  db: DB,
  brandId: string,
): Promise<
  {
    project: LogoProject;
    chosenSvg: string | null;
    conceptCount: number;
  }[]
> {
  const projects = await listProjects(db, brandId);
  if (!projects.length) return [];

  const ids = projects.map((p) => p.id);
  const rows = await db
    .select({
      id: logoGenerations.id,
      projectId: logoGenerations.projectId,
      svg: logoGenerations.svg,
    })
    .from(logoGenerations)
    .where(inArray(logoGenerations.projectId, ids));

  const counts = new Map<string, number>();
  const svgById = new Map<string, string>();
  for (const r of rows) {
    counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
    svgById.set(r.id, r.svg);
  }
  return projects.map((project) => ({
    project,
    chosenSvg: project.chosenGenerationId ? svgById.get(project.chosenGenerationId) ?? null : null,
    conceptCount: counts.get(project.id) ?? 0,
  }));
}

/** Look a project up by its public share token (NULL tokens never match). */
export async function getProjectByShareToken(
  db: DB,
  token: string,
): Promise<LogoProject | null> {
  if (!token.trim()) return null;
  const [row] = await db
    .select()
    .from(logoProjects)
    .where(eq(logoProjects.shareToken, token))
    .limit(1);
  return row ?? null;
}

/**
 * The iteration lineage for a generation: every ancestor back to the original,
 * oldest first, then the generation itself. Drives the editor's version history
 * and its undo (step to `parentId`).
 */
export async function getLineage(db: DB, generationId: string): Promise<ConceptView[]> {
  const chain: LogoGeneration[] = [];
  const seen = new Set<string>();
  let cursor: string | null = generationId;
  // Bounded walk — a corrupted parent cycle must not hang the request.
  while (cursor && !seen.has(cursor) && chain.length < 64) {
    seen.add(cursor);
    const row: LogoGeneration | null = await getGeneration(db, cursor);
    if (!row) break;
    chain.push(row);
    cursor = row.parentId;
  }
  return chain.reverse().map(toConceptView);
}

/** Direct children of a generation (the refinements made from it), newest first. */
export async function listChildren(db: DB, generationId: string): Promise<ConceptView[]> {
  const rows = await db
    .select()
    .from(logoGenerations)
    .where(eq(logoGenerations.parentId, generationId))
    .orderBy(desc(logoGenerations.createdAt));
  return rows.map(toConceptView);
}

/** All generations for a project, newest first. */
export async function listGenerations(db: DB, projectId: string): Promise<ConceptView[]> {
  const rows = await db
    .select()
    .from(logoGenerations)
    .where(eq(logoGenerations.projectId, projectId))
    .orderBy(desc(logoGenerations.createdAt));
  return rows.map(toConceptView);
}

export async function getGeneration(db: DB, generationId: string): Promise<LogoGeneration | null> {
  const [row] = await db
    .select()
    .from(logoGenerations)
    .where(eq(logoGenerations.id, generationId))
    .limit(1);
  return row ?? null;
}

/** The chosen (committed) concept of a project, if any. */
export async function getChosenGeneration(db: DB, project: LogoProject): Promise<LogoGeneration | null> {
  if (!project.chosenGenerationId) return null;
  return getGeneration(db, project.chosenGenerationId);
}

/** Count of generations across a brand — used for the studio snapshot + billing. */
export async function countGenerations(db: DB, brandId: string): Promise<number> {
  const rows = await db
    .select({ id: logoGenerations.id })
    .from(logoGenerations)
    .where(eq(logoGenerations.brandId, brandId));
  return rows.length;
}

/** Guard: a generation must belong to the given brand (used after brand access check). */
export async function generationInBrand(
  db: DB,
  generationId: string,
  brandId: string,
): Promise<LogoGeneration | null> {
  const [row] = await db
    .select()
    .from(logoGenerations)
    .where(and(eq(logoGenerations.id, generationId), eq(logoGenerations.brandId, brandId)))
    .limit(1);
  return row ?? null;
}
