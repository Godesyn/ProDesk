import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Heart, Loader2 } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { Eyebrow, PigmentButton } from './primitives';
import { SvgMark, recolorSvg } from './SvgMark';

/**
 * The contact sheet answers "which form?"; this panel answers "does it hold up?".
 * Picking a direction shows the real derived lockups beside it — set with the
 * brand's name, committed to the palette's colour, dropped onto that colour, and
 * reversed out of ink — so a choice is made against how the mark will actually be
 * used rather than against a bare glyph on a grid.
 *
 * Every specimen is the SAME server-composed lockup the editor and the exports
 * use (`logo.studio.get`), only repainted client-side via `currentColor`. Nothing
 * here is a mock-up of the result — colour just isn't committed yet.
 */

type Slot =
  | 'primary'
  | 'stacked'
  | 'mark'
  | 'wordmark'
  | 'mono'
  | 'reversed'
  | 'color'
  | 'colorReversed';

export interface PreviewConcept {
  id: string;
  name: string;
  kind: string;
  note: string;
  svg: string;
  uniqueness: number | null;
  saved: boolean;
  spec?: { palette?: { role: string; name: string; hex: string }[] };
}

const INK = '#0E0E0C';
const PAPER = '#F4F1EA';

/** Roles that are structure, not brand colour — never offered as the mark's ink. */
const NON_BRAND_ROLES = new Set(['ink', 'background', 'paper', 'rule']);

/** WCAG relative luminance — decides whether ink or paper reads on a colour. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return Number.isFinite(v) ? (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : 0;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The ink that survives on a given ground. */
const inkOn = (hex: string) => (luminance(hex) > 0.42 ? INK : PAPER);

export function DirectionPreview({
  concept,
  wordmarkFallback,
  onChoose,
  onToggleSave,
  choosing = false,
}: {
  concept: PreviewConcept | null;
  /** Shown while the lockups load, so the panel never reads as empty. */
  wordmarkFallback: string;
  onChoose: () => void;
  onToggleSave: () => void;
  choosing?: boolean;
}) {
  const trpc = useTRPC();
  const [colorHex, setColorHex] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  const studioQuery = useQuery(
    trpc.logo.studio.get.queryOptions(
      { generationId: concept?.id ?? '' },
      { enabled: !!concept, staleTime: 60_000 },
    ),
  );
  const lockups = (studioQuery.data?.lockups ?? {}) as Partial<Record<Slot, string>>;
  const wordmark = studioQuery.data?.wordmark ?? wordmarkFallback;

  // A brand colour to try the mark in. Follows the concept's own palette until the
  // user picks another swatch; re-derived per concept so it never carries over.
  const palette = useMemo(() => {
    const all = concept?.spec?.palette ?? [];
    const brand = all.filter((c) => !NON_BRAND_ROLES.has(c.role.toLowerCase()) && /^#/.test(c.hex));
    return brand.length ? brand : all.filter((c) => /^#/.test(c.hex)).slice(0, 1);
  }, [concept?.spec?.palette]);
  useEffect(() => setColorHex(null), [concept?.id]);
  /**
   * The colour the coloured lockups are already baked in — the palette's Primary,
   * resolved exactly as the server's `primaryHexOf` does, so the tile's ground
   * matches the artwork's own ground instead of drifting a shade off it.
   */
  const bakedHex =
    palette.find((c) => c.role.toLowerCase() === 'primary')?.hex ?? palette[0]?.hex ?? '#2E9E58';
  // Specs never render a CSS var here: the hex is shown, and rasterised on export.
  const color = colorHex ?? bakedHex;
  /** Auditioning a different swatch — only then do we repaint the real lockups. */
  const tryingColor = colorHex !== null && colorHex !== bakedHex;

  // On a phone the panel sits under the sheet — bring it into view when a
  // direction is picked, otherwise the selection appears to do nothing.
  useEffect(() => {
    if (!concept?.id) return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    anchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [concept?.id]);

  if (!concept) {
    return (
      <aside className="rounded-[var(--radius-lg)] border border-dashed border-[var(--hair-2)] p-6">
        <Eyebrow>In place</Eyebrow>
        <p className="mt-3 text-sm font-semibold text-[var(--ink)]">Pick a direction.</p>
        <p className="mt-1.5 text-sm text-[var(--ink-2)]">
          You’ll see it set with your name, in colour, on colour, and reversed — before you commit
          to refining it.
        </p>
      </aside>
    );
  }

  const loading = studioQuery.isLoading || !lockups.primary;
  const score = concept.uniqueness ?? 0;

  return (
    <aside
      ref={anchor}
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] scroll-mt-20"
    >
      {/* who we're looking at */}
      <div className="flex items-start gap-3 border-b border-[var(--hair)] p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)]">
          <SvgMark svg={concept.svg} tone="pigment" className="h-6 w-6" title={concept.name} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">{concept.name}</p>
          <p className="spec truncate" style={{ fontSize: 10 }}>
            {concept.kind} · {score}% unique
          </p>
        </div>
        <button
          onClick={onToggleSave}
          className="press grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--hair-2)] transition"
          aria-label={concept.saved ? 'Remove from saved' : 'Save direction'}
          aria-pressed={concept.saved}
        >
          <Heart
            className="h-4 w-4"
            style={{
              color: concept.saved ? 'var(--pigment)' : 'var(--ink-3)',
              fill: concept.saved ? 'var(--pigment)' : 'none',
            }}
          />
        </button>
      </div>

      {loading ? (
        <div className="grid h-56 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-3)]" />
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <Specimen label="Primary lockup" note={wordmark}>
            <Tile ground="paper">
              <Art svg={lockups.primary} ink={INK} />
            </Tile>
          </Specimen>

          <Specimen label="Stacked">
            <Tile ground="paper">
              <Art svg={lockups.stacked} ink={INK} tall />
            </Tile>
          </Specimen>

          {/*
            The two coloured lockups the studio actually ships — `color` and
            `colorReversed` are real slots with their own baked colour contract,
            not this panel recolouring the primary and hoping the export agrees.
            The swatches below still let you audition another palette entry
            before the direction is committed.
          */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <Eyebrow>In colour</Eyebrow>
              <span className="spec tnum" style={{ fontSize: 9 }}>
                {color.toUpperCase()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile ground="paper">
                <Art svg={lockups.color} ink={tryingColor ? color : undefined} />
              </Tile>
              <Tile ground={color}>
                <Art svg={lockups.colorReversed} ink={tryingColor ? inkOn(color) : undefined} />
              </Tile>
            </div>
            {palette.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {palette.map((c) => (
                  <button
                    key={c.hex + c.role}
                    onClick={() => setColorHex(c.hex)}
                    title={`${c.name} · ${c.role}`}
                    aria-label={`Preview in ${c.name}`}
                    aria-pressed={c.hex === color}
                    className="press h-6 w-6 rounded-full border-2 transition"
                    style={{
                      background: c.hex,
                      borderColor: c.hex === color ? 'var(--ink)' : 'var(--hair-2)',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <Specimen label="Reversed">
            {/* The reversed lockup carries its own ink ground and white ink. */}
            <Tile ground={INK}>
              <Art svg={lockups.reversed} />
            </Tile>
          </Specimen>

          <Specimen label="Small sizes" note="Favicon · avatar">
            <Tile ground="paper">
              <div className="flex items-center justify-center gap-5">
                <SvgMark
                  svg={recolorSvg(lockups.mark ?? '', INK)}
                  className="shrink-0"
                  style={{ width: 16, height: 16 }}
                  title="16px"
                />
                <SvgMark
                  svg={recolorSvg(lockups.mark ?? '', INK)}
                  className="shrink-0"
                  style={{ width: 28, height: 28 }}
                  title="28px"
                />
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
                  style={{ background: color }}
                >
                  <SvgMark
                    svg={recolorSvg(lockups.mark ?? '', inkOn(color))}
                    style={{ width: 22, height: 22 }}
                    title="Avatar"
                  />
                </span>
              </div>
            </Tile>
          </Specimen>

          <PigmentButton className="mt-1 w-full" onClick={onChoose}>
            {choosing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Refine in editor <ArrowRight className="h-4 w-4" />
          </PigmentButton>
          <p className="spec text-center" style={{ fontSize: 9 }}>
            Colour, weight, and spacing stay editable
          </p>
        </div>
      )}
    </aside>
  );
}

function Specimen({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        {note && (
          <span className="spec min-w-0 truncate" style={{ fontSize: 9 }}>
            {note}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** A specimen ground: paper (the dotted stage), or any brand colour. */
function Tile({ ground, children }: { ground: string; children: React.ReactNode }) {
  const paper = ground === 'paper';
  return (
    <div
      className={`grid place-items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)] px-4 py-4 ${
        paper ? 'stage-grid' : ''
      }`}
      style={paper ? undefined : { background: ground }}
    >
      {children}
    </div>
  );
}

/** A lockup, repainted for the ground it sits on. */
function Art({ svg, ink, tall = false }: { svg?: string; ink?: string; tall?: boolean }) {
  if (!svg) return <div className="h-8" />;
  return (
    <SvgMark
      svg={ink ? recolorSvg(svg, ink) : svg}
      className={`w-full ${tall ? 'h-20' : 'h-9'}`}
    />
  );
}
