import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '@shared/lib/trpc';
import type { RouterOutputs } from '@server/trpc/router';
import {
  COMPONENT_SLOTS,
  LOCKUP_SLOTS,
  SLOT_LABELS,
  toneColor,
  type LockupSlot,
} from '@server/modules/logo/layout';
import { PageHeader, Eyebrow, PigmentButton } from '../components/primitives';
import { SvgMark } from '../components/SvgMark';
import { useStudio } from '../app/studio-context';

/**
 * The suite is read from the engine's own slot list rather than a copy of it, so
 * a lockup added there (the coloured pair) shows up here instead of quietly
 * missing from the identity this page claims to be complete.
 */
const SUITE_SLOTS: LockupSlot[] = [...LOCKUP_SLOTS, ...COMPONENT_SLOTS];

const SUITE = [
  { app: 'Signatures', use: 'Email signatures' },
  { app: 'Payments', use: 'Invoices & proposals' },
  { app: 'Reviews', use: 'Review pages & embeds' },
  { app: 'Links', use: 'Short links & QR' },
  { app: 'Websites', use: 'Landing pages' },
];

export function BrandSystem() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { projectId, overview } = useStudio();

  const chosen = overview.data?.chosen ?? null;
  const brandName = overview.data?.brandName ?? 'Your brand';
  const applied =
    (overview.data?.project?.status ?? '') === 'system' ||
    (overview.data?.project?.status ?? '') === 'complete';

  const studioQuery = useQuery(
    trpc.logo.studio.get.queryOptions(
      { generationId: chosen?.id ?? '' },
      { enabled: !!chosen },
    ),
  );
  const derive = useMutation(trpc.logo.system.derive.mutationOptions());
  const apply = useMutation(trpc.logo.system.pushToSuite.mutationOptions());
  const [system, setSystem] = useState<
    RouterOutputs['logo']['system']['derive'] | null
  >(null);

  // Preview the derived system as soon as we have a chosen mark + project.
  useEffect(() => {
    if (!projectId || !chosen || system || derive.isPending) return;
    derive.mutate(
      { projectId },
      { onSuccess: (s) => setSystem(s), onError: () => undefined },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chosen]);

  const lockups = (studioQuery.data?.lockups ?? {}) as Partial<
    Record<LockupSlot, string>
  >;
  const palette = system?.palette ?? chosen?.spec.palette ?? [];
  const fonts =
    system?.fonts ??
    (chosen
      ? {
          ...chosen.spec.fonts,
          mono: chosen.spec.fonts.mono ?? "'JetBrains Mono', monospace",
        }
      : null);

  const onApply = () => {
    if (!projectId || apply.isPending) return;
    apply.mutate(
      { projectId },
      {
        onSuccess: () => {
          toast.success(
            `${brandName}'s identity is now live across the suite.`,
          );
          qc.invalidateQueries({ queryKey: trpc.logo.overview.queryKey() });
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  if (!chosen) {
    return (
      <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
        <PageHeader
          index="04"
          eyebrow="Brand system"
          title="Choose a mark first."
          lede="Pick a concept in the studio, then we derive the whole identity from it."
        />
        <PigmentButton className="mt-8" onClick={() => navigate('/concepts')}>
          See concepts <ArrowUpRight className="h-4 w-4" />
        </PigmentButton>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <PageHeader
        index="04"
        eyebrow="Brand system"
        title={
          <>
            One mark,{' '}
            <span className="quill" style={{ color: 'var(--pigment)' }}>
              a whole identity.
            </span>
          </>
        }
        lede="The studio derives every lockup, colour, and type role from your chosen mark — then makes them the single source of truth for the rest of Prodesk."
        action={
          <PigmentButton onClick={onApply}>
            {apply.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpRight className="h-4 w-4" />
            )}
            {applied ? 'Re-push to the suite' : 'Push to the suite'}
          </PigmentButton>
        }
      />

      {/* Logo suite */}
      <section className="mt-10">
        <Eyebrow>Logo suite · {SUITE_SLOTS.length} lockups</Eyebrow>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          {SUITE_SLOTS.map((slot) => {
            // Each lockup declares the ground it belongs on; the tile reads it
            // from the same contract rather than special-casing "reversed".
            const ground = toneColor(slot, palette).ground;
            return (
              <div
                key={slot}
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
              >
                <div
                  className={`grid h-32 place-items-center px-4 ${ground ? '' : 'stage-grid'}`}
                  style={ground ? { background: ground } : undefined}
                >
                  {lockups[slot] ? (
                    <SvgMark svg={lockups[slot]} className="h-16 w-full" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-3)]" />
                  )}
                </div>
                <div className="flex items-center justify-between bg-[var(--card)] px-4 py-2.5">
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    {SLOT_LABELS[slot]}
                  </span>
                  <span className="spec" style={{ fontSize: 9 }}>
                    {COMPONENT_SLOTS.includes(slot) ? 'Component' : 'Lockup'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Palette + type */}
      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
          <div className="flex items-center justify-between">
            <Eyebrow>Palette</Eyebrow>
            {derive.isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-3)]" />
            )}
          </div>
          <div className="mt-5 space-y-2.5">
            {palette.map((s, i) => (
              <div key={i} className="flex items-center gap-3.5">
                <span
                  className="swatch h-11 w-11 shrink-0 rounded-[var(--radius-md)]"
                  style={{ background: s.hex }}
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {s.name}
                  </p>
                  <p className="spec" style={{ fontSize: 10 }}>
                    {s.role}
                  </p>
                </div>
                <span className="spec tnum">{s.hex.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
          <Eyebrow>Typography</Eyebrow>
          <div className="mt-5 space-y-5">
            {fonts &&
              [
                {
                  role: 'Heading',
                  family: fonts.heading,
                  specimen: 'Find your north.',
                },
                {
                  role: 'Body',
                  family: fonts.body,
                  specimen:
                    'A brand system that scales from favicon to billboard.',
                },
                {
                  role: 'Detail',
                  family: fonts.mono,
                  specimen: 'CLEARSPACE 1.0×  ·  MIN 24PX',
                },
              ].map((t) => (
                <div
                  key={t.role}
                  className="border-b border-[var(--hair)] pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="spec">{t.role}</span>
                    <span className="spec" style={{ fontSize: 10 }}>
                      {t.family?.replace(/['"]/g, '').split(',')[0]}
                    </span>
                  </div>
                  <p
                    className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)]"
                    style={{
                      fontFamily: t.family,
                      ...(t.role === 'Detail'
                        ? { fontSize: 15, letterSpacing: '0.06em' }
                        : {}),
                    }}
                  >
                    {t.specimen}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* The moat — inheritance across the suite */}
      <section className="mt-12 rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--ink)] p-5 sm:p-8">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow className="!text-[var(--rail-ink-3)]">
              Powers your suite
            </Eyebrow>
            <h2 className="mt-2 text-h3 text-[var(--rail-ink)]">
              {brandName}’s identity, everywhere it works.
            </h2>
          </div>
          <SvgMark
            svg={chosen.svg}
            tone="pigment"
            className="hidden h-14 w-14 md:block"
          />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {SUITE.map((s) => (
            <div
              key={s.app}
              className="rounded-[var(--radius-md)] border border-[var(--rail-line)] bg-white/[0.04] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-white/[0.06]">
                  <SvgMark svg={chosen.svg} tone="paper" className="h-4 w-4" />
                </span>
                {applied && (
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full"
                    style={{ background: 'var(--pigment)' }}
                  >
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm font-semibold text-[var(--rail-ink)]">
                {s.app}
              </p>
              <p className="text-xs text-[var(--rail-ink-3)]">{s.use}</p>
              <p
                className="spec mt-2"
                style={{
                  fontSize: 9,
                  color: applied ? 'var(--pigment)' : 'var(--rail-ink-3)',
                }}
              >
                {applied ? 'Applied' : 'Apply →'}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
