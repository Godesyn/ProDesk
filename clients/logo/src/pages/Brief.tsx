import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Loader2, MessageSquare, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '@shared/lib/trpc';
import { Eyebrow, PageHeader, PigmentButton } from '../components/primitives';
import { useLogoContext } from '../app/use-context';
import { useStudio } from '../app/studio-context';

/** UI axis labels, in the brief's personality order. */
const AXES = [
  { key: 'classicModern', left: 'Classic', right: 'Modern' },
  { key: 'seriousPlayful', left: 'Serious', right: 'Playful' },
  { key: 'minimalExpressive', left: 'Minimal', right: 'Expressive' },
  { key: 'geometricOrganic', left: 'Geometric', right: 'Organic' },
] as const;

const KIND_OPTIONS = [
  { label: 'Monogram', value: 'monogram' },
  { label: 'Geometric', value: 'geometric' },
  { label: 'Combination', value: 'combination' },
  { label: 'Wordmark', value: 'wordmark' },
  { label: 'Surprise me', value: 'surprise' },
] as const;

const KEYWORD_SUGGESTIONS = ['precise', 'guidance', 'ascent', 'trust', 'momentum', 'clarity', 'bold', 'warm'];

type MarkType = (typeof KIND_OPTIONS)[number]['value'];

interface Personality {
  classicModern: number;
  seriousPlayful: number;
  minimalExpressive: number;
  geometricOrganic: number;
}

/** The full brief the page edits — shared by BOTH modes so switching is lossless. */
interface BriefState {
  businessName: string;
  tagline: string;
  industry: string;
  keywords: string[];
  personality: Personality;
  markType: MarkType;
  monochromeFirst: boolean;
  initials: string;
  notes: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const OPENING_TURN =
  'Tell me about the brand in your own words — what it does, who it’s for, and how it should feel.';

function Slider({
  left,
  right,
  value,
  onChange,
}: {
  left: string;
  right: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className="spec w-16 shrink-0 text-right sm:w-20">{left}</span>
      <div className="flex flex-1 items-center justify-between gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          /* The visible pill stays hairline-thin, but the BUTTON carries vertical
             padding so the tap target is ~28px — a 4px-tall control is unusable
             on a touch screen. */
          <button
            key={i}
            onClick={() => onChange(i)}
            aria-label={`${left} to ${right}: ${i}`}
            aria-pressed={i === value}
            className="press flex flex-1 items-center py-3"
          >
            <span
              className="block w-full rounded-full transition"
              style={{
                background: i === value ? 'var(--pigment)' : 'var(--hair-2)',
                height: i === value ? 8 : 4,
              }}
            />
          </button>
        ))}
      </div>
      <span className="spec w-16 shrink-0 sm:w-20">{right}</span>
    </div>
  );
}

export function Brief() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const { activeBrand } = useLogoContext();
  const { projectId, overview, setSelectedId } = useStudio();

  const existing = overview.data?.project?.brief ?? null;
  const brandName = overview.data?.brandName ?? activeBrand?.businessName ?? 'My brand';
  const aiEnabled = overview.data?.aiEnabled !== false;

  const [mode, setMode] = useState<'guided' | 'chat'>('guided');
  const [brief, setBrief] = useState<BriefState>(() => ({
    businessName: existing?.businessName || brandName,
    tagline: existing?.tagline ?? '',
    industry: existing?.industry ?? '',
    keywords: existing?.keywords ?? ['guidance', 'ascent'],
    personality:
      existing?.personality ?? {
        classicModern: 3,
        seriousPlayful: 2,
        minimalExpressive: 1,
        geometricOrganic: 1,
      },
    markType: (existing?.markType as MarkType) ?? 'geometric',
    monochromeFirst: existing?.monochromeFirst ?? true,
    initials: existing?.initials ?? '',
    notes: existing?.notes ?? '',
  }));

  // Adopt a brief that arrives after first paint (or when the project changes).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}:${existing ? 'y' : 'n'}`;
    if (!existing || loadedFor.current === key) return;
    loadedFor.current = key;
    setBrief((prev) => ({
      ...prev,
      businessName: existing.businessName || prev.businessName,
      tagline: existing.tagline ?? '',
      industry: existing.industry ?? '',
      keywords: existing.keywords ?? [],
      personality: existing.personality ?? prev.personality,
      markType: (existing.markType as MarkType) ?? prev.markType,
      monochromeFirst: existing.monochromeFirst ?? true,
      initials: existing.initials ?? '',
      notes: existing.notes ?? '',
    }));
  }, [existing, projectId]);

  const [turns, setTurns] = useState<ChatTurn[]>([{ role: 'assistant', content: OPENING_TURN }]);
  const [chatInput, setChatInput] = useState('');
  const [chatReady, setChatReady] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const save = useMutation(trpc.logo.brief.save.mutationOptions());
  const generate = useMutation(trpc.logo.concepts.generate.mutationOptions());
  const converse = useMutation(trpc.logo.brief.converse.mutationOptions());
  const busy = save.isPending || generate.isPending;

  // Keep the newest message in view.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, converse.isPending]);

  const patch = (p: Partial<BriefState>) => setBrief((prev) => ({ ...prev, ...p }));

  const toggleKeyword = (k: string) =>
    setBrief((prev) => ({
      ...prev,
      keywords: prev.keywords.includes(k)
        ? prev.keywords.filter((x) => x !== k)
        : [...prev.keywords, k],
    }));

  /** The payload the server persists — trimmed and with empties dropped. */
  const payload = useMemo(
    () => ({
      businessName: brief.businessName.trim() || brandName,
      tagline: brief.tagline.trim() || undefined,
      industry: brief.industry.trim() || undefined,
      keywords: brief.keywords,
      personality: brief.personality,
      markType: brief.markType,
      monochromeFirst: brief.monochromeFirst,
      initials: brief.initials.trim() || undefined,
      notes: brief.notes.trim() || undefined,
    }),
    [brief, brandName],
  );

  const sendTurn = () => {
    const text = chatInput.trim();
    if (!projectId || !text || converse.isPending) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setChatInput('');
    converse.mutate(
      { projectId, turns: next.filter((t) => t.content !== OPENING_TURN) },
      {
        onSuccess: (res) => {
          setTurns((prev) => [...prev, { role: 'assistant', content: res.reply }]);
          // The studio's structured read of the conversation drives the form too,
          // so switching to Guided shows exactly what it heard.
          setBrief((prev) => ({
            ...prev,
            businessName: res.brief.businessName || prev.businessName,
            tagline: res.brief.tagline ?? prev.tagline,
            industry: res.brief.industry ?? prev.industry,
            keywords: res.brief.keywords?.length ? res.brief.keywords : prev.keywords,
            personality: res.brief.personality ?? prev.personality,
            markType: (res.brief.markType as MarkType) ?? prev.markType,
            monochromeFirst: res.brief.monochromeFirst ?? prev.monochromeFirst,
            initials: res.brief.initials ?? prev.initials,
            notes: res.brief.notes ?? prev.notes,
          }));
          setChatReady(res.ready);
        },
        onError: (e) => {
          setTurns((prev) => [
            ...prev,
            { role: 'assistant', content: 'Something went wrong there — say that again?' },
          ]);
          toast.error(e.message);
        },
      },
    );
  };

  const onGenerate = async () => {
    if (!projectId || busy) return;
    try {
      await save.mutateAsync({ projectId, brief: payload });
      const res = await generate.mutateAsync({ projectId, count: 6 });
      setSelectedId(res.concepts[0]?.id ?? null);
      if (res.fallback) toast.message('Generated with the built-in engine (AI is off in this environment).');
      navigate('/concepts');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate concepts');
    }
  };

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <PageHeader
        index="01"
        eyebrow="Create"
        title={
          <>
            Describe the brand.{' '}
            <span className="quill" style={{ color: 'var(--pigment)' }}>
              We draw the mark.
            </span>
          </>
        }
        lede="Give the studio a sense of the brand's character. The more it knows, the more distinctive the concepts."
        action={
          <div className="flex rounded-[var(--radius-pill)] border border-[var(--hair-2)] p-1">
            {(['guided', 'chat'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                data-active={mode === m}
                className="flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-semibold transition data-[active=true]:bg-[var(--ink)] data-[active=true]:text-white sm:px-3.5"
                style={{ color: mode === m ? '#fff' : 'var(--ink-2)' }}
              >
                {m === 'guided' ? (
                  <Sparkles className="h-3.5 w-3.5" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5" />
                )}
                {m === 'guided' ? 'Guided brief' : 'Conversation'}
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {mode === 'chat' ? (
          /* ── Conversation mode ───────────────────────────────────────────── */
          <div className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)]">
            <div className="border-b border-[var(--hair)] px-5 py-4">
              <Eyebrow>Talk it through</Eyebrow>
              <p className="spec mt-1" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
                {aiEnabled
                  ? 'The studio fills in the brief as you talk — switch to Guided any time to see it.'
                  : 'The AI engine is off in this environment; your notes are still kept.'}
              </p>
            </div>

            <div ref={transcriptRef} className="max-h-[52vh] min-h-[280px] flex-1 space-y-4 overflow-y-auto p-5">
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="max-w-[85%] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm leading-relaxed"
                    style={
                      t.role === 'user'
                        ? { background: 'var(--ink)', color: '#fff' }
                        : { background: 'var(--stage)', color: 'var(--ink)' }
                    }
                  >
                    {t.content}
                  </div>
                </div>
              ))}
              {converse.isPending && (
                <div className="flex justify-start">
                  <div className="rounded-[var(--radius-md)] bg-[var(--stage)] px-3.5 py-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-3)]" />
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendTurn();
              }}
              className="flex items-center gap-2 border-t border-[var(--hair)] px-3 py-3 sm:px-4"
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="e.g. Calm skincare for new mums…"
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-[var(--stage)] px-4 text-sm text-[var(--ink)] outline-none focus:border-[var(--pigment)]"
                aria-label="Your message"
              />
              <button
                type="submit"
                disabled={converse.isPending || !chatInput.trim()}
                className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-white disabled:opacity-50"
                style={{ background: 'var(--pigment)' }}
                aria-label="Send"
              >
                {converse.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </div>
        ) : (
          /* ── Guided brief ────────────────────────────────────────────────── */
          <div className="space-y-8 lg:space-y-9">
            <Field label="Brand name">
              <input
                value={brief.businessName}
                onChange={(e) => patch({ businessName: e.target.value })}
                className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] px-4 text-lg font-semibold text-[var(--ink)] outline-none focus:border-[var(--pigment)]"
              />
            </Field>

            <Field label="What the brand does" hint="One plain sentence — no jargon.">
              <input
                value={brief.tagline}
                onChange={(e) => patch({ tagline: e.target.value })}
                placeholder="e.g. Navigation for modern teams"
                className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] px-4 text-base text-[var(--ink)] outline-none focus:border-[var(--pigment)]"
              />
            </Field>

            <Field label="Industry" hint="Helps the studio avoid the clichés of your field.">
              <input
                value={brief.industry}
                onChange={(e) => patch({ industry: e.target.value })}
                placeholder="e.g. Outdoor equipment"
                className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] px-4 text-base text-[var(--ink)] outline-none focus:border-[var(--pigment)]"
              />
            </Field>

            <Field label="Personality" hint="Nudge each dial toward the brand's character.">
              <div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] p-4 sm:p-5">
                {AXES.map((a) => (
                  <Slider
                    key={a.key}
                    left={a.left}
                    right={a.right}
                    value={brief.personality[a.key]}
                    onChange={(v) =>
                      patch({ personality: { ...brief.personality, [a.key]: v } })
                    }
                  />
                ))}
              </div>
            </Field>

            <Field label="Keywords" hint="What should the mark evoke?">
              <div className="flex flex-wrap gap-2">
                {[...new Set([...brief.keywords, ...KEYWORD_SUGGESTIONS])].map((k) => {
                  const on = brief.keywords.includes(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggleKeyword(k)}
                      className="press flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3.5 py-2 text-sm font-medium transition"
                      style={{
                        borderColor: on ? 'var(--pigment)' : 'var(--hair-2)',
                        background: on ? 'var(--pigment-soft)' : 'transparent',
                        color: on ? 'var(--pigment)' : 'var(--ink-2)',
                      }}
                    >
                      {k}
                      {on && <X className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Mark type">
              <div className="flex flex-wrap gap-2">
                {KIND_OPTIONS.map((k) => (
                  <button
                    key={k.value}
                    onClick={() => patch({ markType: k.value })}
                    className="press rounded-[var(--radius-pill)] border px-4 py-2 text-sm font-semibold transition"
                    style={{
                      borderColor: brief.markType === k.value ? 'var(--ink)' : 'var(--hair-2)',
                      background: brief.markType === k.value ? 'var(--ink)' : 'transparent',
                      color: brief.markType === k.value ? '#fff' : 'var(--ink-2)',
                    }}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </Field>

            {/* Only a monogram needs letters, so only ask when it's chosen. */}
            {brief.markType === 'monogram' && (
              <Field label="Initials" hint="Defaults to the brand name's initials.">
                <input
                  value={brief.initials}
                  onChange={(e) => patch({ initials: e.target.value.slice(0, 4) })}
                  placeholder="e.g. MP"
                  maxLength={4}
                  className="h-12 w-28 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] px-4 text-lg font-semibold uppercase tracking-wide text-[var(--ink)] outline-none focus:border-[var(--pigment)]"
                />
              </Field>
            )}

            <Field label="Colour" hint="A studio principle — get the form right in black & white, add colour last.">
              <button
                onClick={() => patch({ monochromeFirst: !brief.monochromeFirst })}
                className="flex w-full items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] px-4 py-3.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--ink)]">
                    Design in black &amp; white first
                  </span>
                  <span className="spec" style={{ fontSize: 10 }}>
                    Recommended · colour becomes a decision in the editor
                  </span>
                </span>
                <span
                  className="relative h-6 w-11 shrink-0 rounded-full transition"
                  style={{ background: brief.monochromeFirst ? 'var(--pigment)' : 'var(--hair-2)' }}
                >
                  <span
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                    style={{ left: brief.monochromeFirst ? 22 : 2 }}
                  />
                </span>
              </button>
            </Field>
          </div>
        )}

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-6">
            <Eyebrow>The brief</Eyebrow>
            <p className="mt-3 text-base leading-relaxed text-[var(--ink)]">
              A <b>{brief.markType === 'surprise' ? 'distinctive' : brief.markType}</b> mark for{' '}
              <b>{brief.businessName || brandName}</b>, evoking{' '}
              {brief.keywords.length ? brief.keywords.join(', ') : 'clarity'} —{' '}
              {brief.monochromeFirst ? 'monochrome first' : 'in colour'}.
            </p>
            <div className="mt-5 space-y-2 border-t border-[var(--hair)] pt-4">
              <Row k="Concepts" v="6 directions" />
              <Row k="Format" v="Editable SVG" />
              <Row k="Engine" v={aiEnabled ? 'Studio · Claude' : 'Studio · built-in'} />
              <Row k="Est. time" v="~20 seconds" />
            </div>
            <PigmentButton className="mt-6 w-full" onClick={() => void onGenerate()}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  Generate concepts <ArrowRight className="h-4 w-4" />
                </>
              )}
            </PigmentButton>
            {mode === 'chat' && !chatReady && (
              <p className="spec mt-3 text-center" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
                Keep chatting, or generate now with what the studio has.
              </p>
            )}
            <p className="spec mt-3 text-center" style={{ fontSize: 10 }}>
              You only pay when you download — designing is free
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label className="text-sm font-semibold text-[var(--ink)]">{label}</label>
        {hint && (
          <span className="spec" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="spec shrink-0">{k}</span>
      <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">{v}</span>
    </div>
  );
}
