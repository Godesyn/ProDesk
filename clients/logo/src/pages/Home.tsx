import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Check, Loader2, Plus } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { SvgMark } from '../components/SvgMark';
import {
  Eyebrow,
  PigmentButton,
  InkButton,
  Stat,
} from '../components/primitives';
import { useStudio } from '../app/studio-context';

/** Pipeline steps, mapped onto the project's status for done/current state. */
const STEPS = [
  { step: '01', label: 'Create', href: '/create', status: 'brief' },
  { step: '02', label: 'Concepts', href: '/concepts', status: 'concepts' },
  { step: '03', label: 'Editor', href: '/studio', status: 'studio' },
  { step: '04', label: 'Brand system', href: '/brand', status: 'system' },
  { step: '05', label: 'Guidelines', href: '/guidelines', status: 'system' },
  { step: '06', label: 'Assets', href: '/assets', status: 'complete' },
] as const;
const ORDER = ['brief', 'concepts', 'studio', 'system', 'complete'];

const ROLE_LABELS = ['Primary', 'Accent', 'Ink', 'Paper', 'Rule'];

export function Home() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const {
    brandId,
    projectId,
    overview,
    openProject,
    startNewProject,
    isStartingProject,
  } = useStudio();

  const projectsQuery = useQuery(
    trpc.logo.project.list.queryOptions(
      { brandId: brandId! },
      { enabled: !!brandId },
    ),
  );

  const data = overview.data;
  const chosen = data?.chosen ?? null;
  const name = data?.brandName ?? 'your brand';
  const status = data?.project?.status ?? 'brief';
  const statusIdx = ORDER.indexOf(status);
  const palette = chosen?.spec.palette ?? [];
  const primaryHex = palette[0]?.hex ?? '#2E9E58';

  const onNewMark = async () => {
    await startNewProject();
    navigate('/create');
  };

  if (overview.isLoading) {
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-[var(--ink-3)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      {/* Hero */}
      <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
        <div className="rise">
          <Eyebrow>
            Studio{data?.aiEnabled === false ? ' · built-in engine' : ''}
          </Eyebrow>
          <h1 className="mt-4 text-display leading-[0.95] text-[var(--ink)]">
            The mark for{' '}
            <span className="quill" style={{ color: 'var(--pigment)' }}>
              {name}
            </span>
          </h1>
          <p className="mt-5 max-w-md text-body-lg text-[var(--ink-2)]">
            {chosen
              ? 'One idea, rendered every way it will ever be seen — favicon to billboard, in ink and in colour. Refine it in the editor, or ask the studio for a new direction.'
              : 'Describe your brand and the studio draws original, editable marks — then turns your favourite into a whole identity that powers the rest of Prodesk.'}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {chosen ? (
              <Link href="/studio">
                <PigmentButton>
                  Open the editor <ArrowRight className="h-4 w-4" />
                </PigmentButton>
              </Link>
            ) : (
              <Link href="/create">
                <PigmentButton>
                  Design your logo <ArrowRight className="h-4 w-4" />
                </PigmentButton>
              </Link>
            )}
            <InkButton onClick={() => void onNewMark()}>
              {isStartingProject ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Start a new mark
            </InkButton>
          </div>
          <div className="mt-10 flex flex-wrap gap-8 sm:gap-10">
            <Stat
              value={String(data?.generationCount ?? 0)}
              label="Concepts explored"
            />
            <Stat
              value={
                chosen?.uniqueness != null ? String(chosen.uniqueness) : '—'
              }
              label="Uniqueness"
              accent
            />
            <Stat value={String(data?.assetCount ?? 0)} label="Assets ready" />
          </div>
        </div>

        {/* Specimen stage */}
        <div className="specimen stage-grid pop grid aspect-[4/3] place-items-center rounded-[var(--radius-lg)] p-6 sm:p-10">
          {chosen ? (
            <SvgMark
              svg={chosen.svg}
              animate
              className="h-28 w-28 drop-shadow-sm sm:h-40 sm:w-40"
              title={`${name} mark`}
            />
          ) : (
            <button
              onClick={() => navigate('/create')}
              className="grid h-28 w-28 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--hair-2)] px-3 text-center text-sm font-semibold text-[var(--ink-3)] transition hover:border-[var(--pigment)] hover:text-[var(--pigment)] sm:h-40 sm:w-40"
            >
              Design a mark
            </button>
          )}
          <div className="pointer-events-none absolute inset-4 flex flex-col justify-between sm:inset-6">
            <div className="flex justify-between">
              <span className="spec">1:1 · MARK</span>
              <span className="spec hidden sm:block">CLEARSPACE 1.0×</span>
            </div>
            <div className="flex justify-between">
              <span className="spec">{primaryHex.toUpperCase()}</span>
              <span className="spec">SVG · VECTOR</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="mt-14 lg:mt-16">
        <Eyebrow>Your pipeline</Eyebrow>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {STEPS.map((p) => {
            const idx = ORDER.indexOf(p.status);
            const done = statusIdx > idx;
            const current = statusIdx === idx;
            return (
              <Link key={p.step} href={p.href}>
                <div
                  className="group flex h-full cursor-pointer flex-col justify-between rounded-[var(--radius-md)] border p-4 transition hover:-translate-y-0.5"
                  style={{
                    borderColor: current ? 'var(--pigment)' : 'var(--hair-2)',
                    background: current ? 'var(--pigment-soft)' : 'var(--card)',
                    minHeight: 118,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="spec"
                      style={{
                        color: current ? 'var(--pigment)' : 'var(--ink-3)',
                      }}
                    >
                      {p.step}
                    </span>
                    {done ? (
                      <span
                        className="grid h-5 w-5 place-items-center rounded-full"
                        style={{ background: 'var(--pigment)' }}
                      >
                        <Check className="h-3 w-3 text-white" />
                      </span>
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-[var(--ink-3)] opacity-0 transition group-hover:opacity-100" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {p.label}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink-3)]">
                      {done
                        ? 'Complete'
                        : current
                          ? 'In progress'
                          : 'Not started'}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Snapshot + recent */}
      <section className="mt-14 grid grid-cols-1 gap-6 lg:mt-16 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Brand snapshot</Eyebrow>
            <Link
              href="/brand"
              className="-my-2 py-2 text-xs font-semibold text-[var(--pigment)] hover:underline"
            >
              Open brand system
            </Link>
          </div>
          {palette.length ? (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              {palette.slice(0, 5).map((s, i) => (
                <div key={i} className="text-center">
                  <div
                    className="swatch h-12 w-12 rounded-[var(--radius-md)]"
                    style={{ background: s.hex }}
                    title={`${s.name} · ${s.hex}`}
                  />
                  <span className="spec mt-1.5 block" style={{ fontSize: 9 }}>
                    {s.role || ROLE_LABELS[i]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--ink-3)]">
              Choose a concept to see its palette and type.
            </p>
          )}
          {chosen && (
            <div className="mt-6 space-y-3 border-t border-[var(--hair)] pt-5">
              <TypeRow
                role="Heading"
                family={chosen.spec.fonts.heading}
                specimen={name}
              />
              <TypeRow
                role="Body"
                family={chosen.spec.fonts.body}
                specimen="A brand system that scales from favicon to billboard."
              />
            </div>
          )}
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Recent projects</Eyebrow>
            <button
              onClick={() => void onNewMark()}
              className="-my-2 flex items-center gap-1 py-2 text-xs font-semibold text-[var(--pigment)] hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          <ul className="mt-4 space-y-1">
            {(projectsQuery.data ?? []).slice(0, 6).map((p) => (
              <li key={p.id}>
                {/* Each row shows its OWN committed mark, not the active project's. */}
                <button
                  onClick={() => openProject(p.id)}
                  data-active={p.id === projectId}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5 text-left transition hover:bg-[var(--stage-2)] data-[active=true]:bg-[var(--stage-2)]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)]">
                    {p.chosenSvg ? (
                      <SvgMark svg={p.chosenSvg} className="h-5 w-5" />
                    ) : (
                      <span className="h-3 w-3 rounded bg-[var(--hair-2)]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">
                      {p.name}
                    </span>
                    <span className="spec" style={{ fontSize: 10 }}>
                      {p.conceptCount} concept{p.conceptCount === 1 ? '' : 's'}{' '}
                      · {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span
                    className="spec shrink-0"
                    style={{ fontSize: 10, color: 'var(--pigment)' }}
                  >
                    {p.status}
                  </span>
                </button>
              </li>
            ))}
            {!projectsQuery.data?.length && (
              <li className="px-2 py-3 text-sm text-[var(--ink-3)]">
                No projects yet.
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

function TypeRow({
  role,
  family,
  specimen,
}: {
  role: string;
  family: string;
  specimen: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="spec w-16 shrink-0">{role}</span>
      <span
        className="min-w-0 flex-1 truncate text-lg font-semibold text-[var(--ink)]"
        style={{ fontFamily: family }}
      >
        {specimen}
      </span>
    </div>
  );
}
