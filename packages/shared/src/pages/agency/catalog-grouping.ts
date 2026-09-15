import { INFIN8_STAGES } from './constants';

/** A titled run of services. `heading === null` is the leading, label-less run. */
export type CatalogGroup<T> = { heading: string | null; items: T[] };

const STAGES = INFIN8_STAGES as readonly string[];

/** Infin8 sort: stage order → sub-stage (alpha) → custom sort order. */
export function sortByInfin8<T extends { stage?: string | null; subStage?: string | null; sortOrder?: number | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const sa = STAGES.indexOf(a.stage ?? ''),
      sb = STAGES.indexOf(b.stage ?? '');
    if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    const subCmp = (a.subStage ?? '').localeCompare(b.subStage ?? '');
    if (subCmp !== 0) return subCmp;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
}

/** Group infin8-sorted services into `stage – subStage` headed runs. */
export function catalogGroups<T extends { stage?: string | null; subStage?: string | null }>(
  rows: T[],
): { heading: string; items: T[] }[] {
  const out: { heading: string; items: T[] }[] = [];
  let current: { heading: string; items: T[] } | null = null;
  for (const s of rows) {
    const stage = (s.stage ?? '').trim();
    const subStage = (s.subStage ?? '').trim();
    const heading =
      !stage && !subStage
        ? 'Other'
        : !stage
          ? `Other – ${subStage}`
          : !subStage
            ? `${stage} – Other`
            : `${stage} – ${subStage}`;
    if (!current || current.heading !== heading) {
      current = { heading, items: [] };
      out.push(current);
    }
    current.items.push(s);
  }
  return out;
}

/**
 * Interleave services and user-defined section headings by the shared sortOrder.
 * A heading opens a new titled section; services before the first heading sit in
 * a leading untitled section (heading === null). When searching, empty heading
 * sections are dropped so results aren't cluttered with bare labels.
 */
export function organizedGroups<T extends { sortOrder?: number | null }>(
  services: T[],
  headings: { text: string; sortOrder?: number | null }[],
  searching: boolean,
): CatalogGroup<T>[] {
  const items = [
    ...services.map((s) => ({ kind: 'service' as const, sortOrder: s.sortOrder ?? 0, data: s })),
    ...headings.map((h) => ({ kind: 'heading' as const, sortOrder: h.sortOrder ?? 0, data: h })),
  ].sort((a, b) => a.sortOrder - b.sortOrder);

  const groups: CatalogGroup<T>[] = [{ heading: null, items: [] }];
  for (const it of items) {
    if (it.kind === 'heading') groups.push({ heading: it.data.text, items: [] });
    else groups[groups.length - 1].items.push(it.data);
  }
  // Always keep sections with services. Empty sections: the leading untitled one
  // (heading === null) is always dropped; empty heading sections are kept so the
  // agency sees its structure, but dropped while searching to avoid bare labels.
  return groups.filter((g) => g.items.length > 0 || (g.heading !== null && !searching));
}
