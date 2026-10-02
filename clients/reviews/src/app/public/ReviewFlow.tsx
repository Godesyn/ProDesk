/* Public review-capture flow (/r/:slug) — the visitor-facing core of the tool.
 * Ported from the Manus export's ReviewFlowPage and rewired to our tRPC. No auth:
 * a customer rates, picks win-tags, gets an AI-written review to paste on the
 * business's chosen platform (5★) or leaves private feedback (≤4★). */
import { useRef, useState } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Star, Loader2, Copy, CheckCircle2, ChevronLeft } from 'lucide-react';
import { useToast } from '../toast';
import { PLATFORMS } from '../lib';
import { LazyImage } from '@shared/components/ui/lazy-image';

/** Owner-supplied links are shown to anonymous visitors — only ever follow http(s). */
const isHttpUrl = (u?: string | null): u is string => !!u && /^https?:\/\//i.test(u);

type Step = 'rating' | 'tags' | 'generating' | 'review' | 'bad-feedback' | 'thanks';

export function ReviewFlowPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';
  // Per-request token from the emailed link (?rr=<token>): ties this capture back
  // to the review request so its status + rating/message show in the request log.
  const rr = new URLSearchParams(window.location.search).get('rr') ?? undefined;
  const trpc = useTRPC();
  const toast = useToast();

  const [step, setStep] = useState<Step>('rating');
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [edited, setEdited] = useState('');
  const [privateFeedback, setPrivateFeedback] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publicConsent, setPublicConsent] = useState(true);

  const { data: location, isLoading, error } = useQuery({
    ...trpc.reviews.public.getLocation.queryOptions({ slug, rr }),
    retry: false,
  });

  const generate = useMutation({
    ...trpc.reviews.public.generateReview.mutationOptions(),
    onSuccess: (data) => {
      setEdited(data.review);
      setStep('review');
    },
    onError: () => {
      toast("Couldn't generate a review. Please try again.");
      setStep('tags');
    },
  });
  const submit = useMutation(trpc.reviews.public.submitReview.mutationOptions());
  const startSubmission = useMutation(trpc.reviews.public.startSubmission.mutationOptions());

  // The star rating is persisted the instant it's tapped (see persistStars), so a
  // rating is captured even if the visitor leaves without finishing. These refs
  // hold the created submission's id and the in-flight create promise so the final
  // submit can wait for the create and UPDATE that same row (never a second one).
  // Refs, not state — this runs silently in the background with no loading UI.
  const submissionIdRef = useRef<string | null>(null);
  const startPromiseRef = useRef<Promise<string | null> | null>(null);

  function persistStars(s: number) {
    if (!location) return;
    const submissionType = s >= 5 ? 'public' : 'private';
    // Chain off any prior create so a fast re-tap updates the existing row instead
    // of racing a second insert. Fire-and-forget: failures never surface to the UI.
    startPromiseRef.current = Promise.resolve(startPromiseRef.current)
      .catch(() => null)
      .then(async () => {
        const res = await startSubmission.mutateAsync({
          locationId: location.id,
          stars: s,
          submissionType,
          requestToken: rr,
          submissionId: submissionIdRef.current ?? undefined,
        });
        submissionIdRef.current = res.submissionId;
        return res.submissionId;
      })
      .catch(() => null);
  }

  /** Wait for the background create to land, then return its id (null if it never
   *  succeeded — the final submit then inserts fresh so nothing is lost). */
  async function ensureStarted(): Promise<string | undefined> {
    try {
      await startPromiseRef.current;
    } catch {
      /* ignore — fall back to insert */
    }
    return submissionIdRef.current ?? undefined;
  }

  function handleStar(s: number) {
    setStars(s);
    persistStars(s);
    setStep(s >= 5 ? 'tags' : 'bad-feedback');
  }

  function handleGenerate() {
    if (!location || selectedTags.length === 0) return;
    setStep('generating');
    generate.mutate({
      locationId: location.id,
      businessName: location.name,
      industry: location.industry,
      selectedTags,
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(edited);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast("Couldn't copy. Please copy manually.");
    }
  }

  async function pickPlatform(p: { platform: string; url: string }) {
    if (!location) return;
    setSubmitting(true);
    try {
      const submissionId = await ensureStarted();
      await submit.mutateAsync({
        locationId: location.id,
        stars,
        selectedTags,
        generatedReview: edited,
        platformClicked: p.platform,
        submissionType: 'public',
        publicConsent,
        requestToken: rr,
        submissionId,
      });
    } catch {
      /* non-blocking */
    }
    if (isHttpUrl(p.url)) window.open(p.url, '_blank', 'noopener,noreferrer');
    setStep('thanks');
    setSubmitting(false);
  }

  /* Fallback when the location has no platform links configured: record the
   * public review straight to our DB (same as a platform click, minus the
   * redirect) so the screen isn't a dead end. */
  async function submitDirect() {
    if (!location) return;
    setSubmitting(true);
    try {
      const submissionId = await ensureStarted();
      await submit.mutateAsync({
        locationId: location.id,
        stars,
        selectedTags,
        generatedReview: edited,
        submissionType: 'public',
        publicConsent,
        requestToken: rr,
        submissionId,
      });
    } catch {
      /* non-blocking */
    }
    setStep('thanks');
    setSubmitting(false);
  }

  async function sendBad() {
    if (!location) return;
    setSubmitting(true);
    try {
      const submissionId = await ensureStarted();
      await submit.mutateAsync({
        locationId: location.id,
        stars,
        selectedTags: [],
        privateFeedback,
        submissionType: 'private',
        origin: window.location.origin,
        requestToken: rr,
        submissionId,
      });
    } catch {
      /* non-blocking */
    }
    setStep('thanks');
    setSubmitting(false);
  }

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );

  if (isLoading) {
    return (
      <div className="verdiict" style={center}>
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error || !location) {
    const inactive = (error as { message?: string } | null)?.message === 'inactive';
    return (
      <div className="verdiict" style={{ ...center, textAlign: 'center', padding: 24 }}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
            {inactive ? "This page isn't active yet" : 'Page not found'}
          </h1>
          <p className="vmuted">
            {inactive
              ? "The business hasn't activated their review subscription yet."
              : "We couldn't find a review page at this link."}
          </p>
        </div>
      </div>
    );
  }

  const platformLinks = location.platforms.filter((p) =>
    PLATFORMS.some((pl) => pl.slug === p.platform),
  );

  return (
    <div className="verdiict" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        style={{
          height: 64,
          borderBottom: '1px solid var(--v-line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {location.logoUrl ? (
          <LazyImage src={location.logoUrl} alt={location.name} style={{ height: 32, maxWidth: 160 }} imgClassName="object-contain" />
        ) : (
          <span style={{ fontWeight: 700, fontSize: 18 }}>{location.name}</span>
        )}
      </header>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '32px 20px' }}>
        <div className="vreveal" style={{ width: '100%', maxWidth: 460 }}>
          {step === 'rating' && (
            <div style={{ textAlign: 'center' }}>
              <h1 style={hTitle}>How was your experience?</h1>
              <p className="veyebrow" style={{ marginBottom: 28 }}>Tap a star · about 15 seconds</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStar(s)}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }}
                    aria-label={`${s} star${s !== 1 ? 's' : ''}`}
                  >
                    <Star
                      size={44}
                      className={s <= (hovered || stars) ? 'fill-current' : ''}
                      style={{ color: 'var(--v-ink)', opacity: s <= (hovered || stars) ? 1 : 0.16 }}
                    />
                  </button>
                ))}
              </div>
              <p className="vmuted">
                {hovered === 5 || stars === 5
                  ? 'Excellent!'
                  : hovered >= 4 || stars >= 4
                    ? 'Great!'
                    : hovered >= 3 || stars >= 3
                      ? 'Good'
                      : hovered >= 2 || stars >= 2
                        ? 'Fair'
                        : hovered >= 1 || stars >= 1
                          ? 'Poor'
                          : ''}
              </p>
            </div>
          )}

          {step === 'tags' && (
            <div>
              <BackBtn onClick={() => setStep('rating')} />
              <h1 style={hTitle}>What did we do well?</h1>
              <p className="vmuted" style={{ marginBottom: 18 }}>Pick a few — we'll do the writing.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                {location.tags.map((tag) => (
                  <button
                    key={tag}
                    className="vchip"
                    data-selected={selectedTags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <button
                className="vbtn vbtn-primary"
                style={{ width: '100%' }}
                disabled={selectedTags.length === 0}
                onClick={handleGenerate}
              >
                Generate my review
              </button>
            </div>
          )}

          {step === 'generating' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <Loader2 className="animate-spin" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Writing your review…</h2>
              <p className="vmuted">This takes just a moment</p>
            </div>
          )}

          {step === 'review' && (
            <div>
              <h1 style={hTitle}>Your review is ready</h1>
              <p className="vmuted" style={{ marginBottom: 14 }}>
                {platformLinks.length > 0
                  ? "It's already copied. Tap a platform below and paste."
                  : 'Give it a quick read, then submit.'}
              </p>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <textarea
                  className="vtextarea"
                  value={edited}
                  onChange={(e) => setEdited(e.target.value)}
                  style={{ minHeight: 140, paddingRight: 44 }}
                />
                <button
                  onClick={copy}
                  style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 0, cursor: 'pointer', color: 'var(--v-muted)' }}
                  aria-label="Copy"
                >
                  {copied ? <CheckCircle2 size={16} color="var(--v-success)" /> : <Copy size={16} />}
                </button>
              </div>
              {copied && (
                <p style={{ color: 'var(--v-success)', fontSize: 12, fontWeight: 500, marginBottom: 12 }}>
                  Copied! Now choose where to post it.
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {platformLinks.length === 0 && (
                  <button
                    className="vbtn vbtn-primary"
                    disabled={submitting}
                    onClick={submitDirect}
                    style={{ padding: '13px', fontSize: 14 }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Submitting…
                      </>
                    ) : (
                      'Submit review'
                    )}
                  </button>
                )}
                {platformLinks.map((p) => {
                  const meta = PLATFORMS.find((pl) => pl.slug === p.platform);
                  if (!meta) return null;
                  return (
                    <button
                      key={p.platform}
                      className="vbtn vbtn-primary"
                      disabled={submitting}
                      onClick={() => {
                        copy();
                        pickPlatform(p);
                      }}
                      style={{ padding: '13px', fontSize: 14 }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          background: 'var(--v-paper)',
                          color: 'var(--v-ink)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {meta.letter}
                      </span>
                      Open {meta.label} & paste
                    </button>
                  );
                })}
              </div>
              <label style={{ display: 'flex', gap: 10, marginTop: 18, cursor: 'pointer', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={publicConsent}
                  onChange={(e) => setPublicConsent(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span className="vmuted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  I'm happy for this review to appear on the{' '}
                  <a href="/directory" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--v-ink)' }}>
                    public directory
                  </a>{' '}
                  so others can find {location.name}.
                </span>
              </label>
              <button
                onClick={() => {
                  setSelectedTags([]);
                  setStep('tags');
                }}
                className="vbtn vbtn-quiet"
                style={{ width: '100%', marginTop: 12 }}
              >
                Regenerate review
              </button>
            </div>
          )}

          {step === 'bad-feedback' && (
            <div>
              <BackBtn onClick={() => setStep('rating')} />
              <h1 style={hTitle}>Sorry to hear that.</h1>
              <p className="vmuted" style={{ marginBottom: 16 }}>
                Your feedback goes directly to the team. What could we have done better?
              </p>
              <textarea
                className="vtextarea"
                placeholder="Tell us what happened…"
                value={privateFeedback}
                onChange={(e) => setPrivateFeedback(e.target.value)}
                style={{ marginBottom: 14 }}
              />
              <button
                className="vbtn vbtn-primary"
                style={{ width: '100%' }}
                onClick={sendBad}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Sending…
                  </>
                ) : (
                  'Send feedback'
                )}
              </button>
            </div>
          )}

          {step === 'thanks' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 20 }}>🙏</div>
              <h1 style={hTitle}>Thank you.</h1>
              <p className="vmuted">
                {stars >= 5
                  ? 'Your review means a lot. We really appreciate you taking the time.'
                  : "Your feedback has been sent to the team. We'll use it to do better."}
              </p>
              {isHttpUrl(location.redirectUrl) && (
                <button
                  className="vbtn"
                  style={{ marginTop: 28 }}
                  onClick={() => (window.location.href = location.redirectUrl!)}
                >
                  Back to website
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <footer style={{ padding: '18px 0', textAlign: 'center' }}>
        <a href="/" className="veyebrow" style={{ textDecoration: 'none' }}>
          ★ Powered by Verdiict
        </a>
      </footer>
    </div>
  );
}

const center: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const hTitle: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 700,
  letterSpacing: '-0.03em',
  margin: '0 0 8px',
};

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="vmuted"
      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 0, cursor: 'pointer', marginBottom: 20, fontSize: 14 }}
    >
      <ChevronLeft size={16} /> Back
    </button>
  );
}
