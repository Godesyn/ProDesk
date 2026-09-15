import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useLogoContext } from './use-context';

/**
 * Shared studio state that spans the pipeline pages: which design project is
 * open, and which concept is being refined right now. Lives above the routed
 * <Switch> so navigating Create → Concepts → Editor keeps the selection.
 *
 * The DB is the source of truth for the work itself; this only tracks the
 * *working selection*. The chosen project id is mirrored into localStorage per
 * brand so a refresh (or a trip out to Stripe and back) returns you to the
 * project you were actually working on rather than the most recent one.
 */
interface StudioState {
  brandId: string | null;
  projectId: string | null;
  /** The generation open in the editor (falls back to the project's chosen one). */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Switch to an existing project (also makes it the brand's active one). */
  openProject: (id: string) => void;
  /** Start a brand-new mark and land on its brief. */
  startNewProject: () => Promise<string | null>;
  isStartingProject: boolean;
  /** The Studio-home overview query (project + chosen mark + entitlement). */
  overview: ReturnType<typeof useOverviewQuery>;
}

const Ctx = createContext<StudioState | null>(null);

const storageKey = (brandId: string) => `logo:project:${brandId}`;

function readStoredProject(brandId: string | null | undefined): string | null {
  if (!brandId) return null;
  try {
    return window.localStorage.getItem(storageKey(brandId));
  } catch {
    return null; // private mode / storage disabled
  }
}

function writeStoredProject(brandId: string | null, projectId: string | null): void {
  if (!brandId) return;
  try {
    if (projectId) window.localStorage.setItem(storageKey(brandId), projectId);
    else window.localStorage.removeItem(storageKey(brandId));
  } catch {
    /* non-fatal */
  }
}

function useOverviewQuery(projectId: string | null) {
  const trpc = useTRPC();
  const { brandId } = useLogoContext();
  return useQuery(
    trpc.logo.overview.queryOptions(
      { brandId: brandId!, projectId: projectId ?? undefined },
      { enabled: !!brandId },
    ),
  );
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { brandId } = useLogoContext();

  const [projectId, setProjectId] = useState<string | null>(() => readStoredProject(brandId));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const overview = useOverviewQuery(projectId);
  const ensure = useMutation(trpc.logo.project.ensure.mutationOptions());
  const create = useMutation(trpc.logo.project.create.mutationOptions());
  const open = useMutation(trpc.logo.project.open.mutationOptions());

  // Switching brands must not carry the previous brand's project across.
  useEffect(() => {
    setProjectId(readStoredProject(brandId));
    setSelectedId(null);
  }, [brandId]);

  // Adopt the server's active project, or create one on first ever entry.
  useEffect(() => {
    if (!brandId || projectId) return;
    if (overview.data?.project) {
      setProjectId(overview.data.project.id);
      writeStoredProject(brandId, overview.data.project.id);
      return;
    }
    if (overview.isSuccess && !overview.data.project && !ensure.isPending) {
      ensure.mutate(
        { brandId },
        {
          onSuccess: (p) => {
            setProjectId(p.id);
            writeStoredProject(brandId, p.id);
          },
        },
      );
    }
  }, [brandId, projectId, overview.data, overview.isSuccess, ensure]);

  // Default the editor selection to the committed concept of the open project.
  const chosenId = overview.data?.chosen?.id ?? null;
  useEffect(() => {
    if (chosenId) setSelectedId((prev) => prev ?? chosenId);
  }, [chosenId]);

  const openProject = useCallback(
    (id: string) => {
      if (id === projectId) return;
      setProjectId(id);
      setSelectedId(null);
      writeStoredProject(brandId ?? null, id);
      // Make it the brand's active project too, so other surfaces agree.
      open.mutate({ projectId: id }, { onSettled: () => void qc.invalidateQueries() });
    },
    [projectId, brandId, open, qc],
  );

  const startNewProject = useCallback(async () => {
    if (!brandId) return null;
    const created = await create.mutateAsync({ brandId });
    setProjectId(created.id);
    setSelectedId(null);
    writeStoredProject(brandId, created.id);
    await qc.invalidateQueries();
    return created.id;
  }, [brandId, create, qc]);

  const value = useMemo<StudioState>(
    () => ({
      brandId: brandId ?? null,
      projectId,
      selectedId,
      setSelectedId,
      openProject,
      startNewProject,
      isStartingProject: create.isPending,
      overview,
    }),
    [brandId, projectId, selectedId, openProject, startNewProject, create.isPending, overview],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudio(): StudioState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStudio must be used within <StudioProvider>');
  return ctx;
}
