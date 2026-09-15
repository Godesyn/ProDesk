import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';

/**
 * Shared header for the onboarding / create screens (role-selection → create-*).
 * Editorial house style: a mono eyebrow, a section-title with an optional
 * serif-italic accent word, and a muted description. Works both standalone
 * (onboarding, on the paper body) and inside MainLayout (editing later).
 *
 * Always renders an icon back affordance: navigates to `backTo` when given,
 * otherwise falls back to the browser history (matches the profile screen).
 */
export function OnboardingHeader({
  eyebrow,
  title,
  titleAccent,
  description,
  backTo,
  backLabel = 'Back',
}: {
  eyebrow: string;
  title: string;
  titleAccent?: string;
  description?: string;
  backTo?: string;
  backLabel?: string;
}) {
  const [, navigate] = useLocation();
  const goBack = () => (backTo ? navigate(backTo) : window.history.back());

  return (
    <div className="mb-8">
      <button
        type="button"
        onClick={goBack}
        aria-label={backLabel}
        title={backLabel}
        className="press mb-5 -ml-1 inline-flex text-ink-60 transition-colors hover:text-ink-100"
      >
        <ArrowLeft className="h-7 w-7" />
      </button>
      <div className="text-eyebrow mb-3 text-accent">{eyebrow}</div>
      <h1 className="text-section-title text-ink-100">
        {title}
        {titleAccent ? <> <span className="text-serif-italic text-accent">{titleAccent}</span></> : null}
      </h1>
      {description && <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-ink-60">{description}</p>}
    </div>
  );
}
