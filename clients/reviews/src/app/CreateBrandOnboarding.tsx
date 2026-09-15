/* Two-step post-signup onboarding for the Reviews (Verdiict) app. Matches the
 * original review-request-tool OnboardingPage: Step 1 asks for business name,
 * Step 2 asks for industry. On completion both the brand AND the first review
 * location (with industry-specific win tags) are created so the user lands in
 * their workspace ready to go. Uses the Verdiict scoped design system (v-prefixed
 * classes from styles/verdiict.css). */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Building2, ChevronRight, Loader2, Check, X } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { VerdiictLogo } from './VerdiictLogo';
import { useConfirm } from './confirm';

type Step = 'business' | 'industry';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * The two-step create-brand form (business name → industry) shared by the
 * full-page signup onboarding and the in-app "New brand" dialog. It owns the
 * create brand + first-location mutations; the caller supplies navigation:
 *  - `onComplete` runs after both records are created, immediately BEFORE the
 *    brands.mine / auth.me invalidation (so the caller can navigate first — the
 *    signup flow relies on this ordering to remount on '/').
 *  - `onCancel`, when provided, renders a Cancel button on step 1 (dialog use).
 */
export function CreateBrandFlow({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('business');
  const [businessName, setBusinessName] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Brand id from a previous attempt whose location step failed — retrying must
  // not re-create the brand (the name is now taken by the user's own brand).
  const [createdBrandId, setCreatedBrandId] = useState<string | null>(null);

  // Live business-name availability check (debounced).
  const debouncedName = useDebounced(businessName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName }),
    enabled: debouncedName.trim().length > 1,
  });
  const nameTaken = !!businessName.trim() && nameCheck.data && !nameCheck.data.available;

  // Fetch industry list from the reviews API (DB-backed, falls back to seed).
  const { data: industries } = useQuery(trpc.reviews.industries.list.queryOptions());

  // Step 1 → Step 2
  function handleNext() {
    setError(null);
    const name = businessName.trim();
    if (!name) {
      setError('Please enter your business name.');
      return;
    }
    if (nameTaken) {
      setError(nameCheck.data?.reason ?? 'This business name is already taken.');
      return;
    }
    setStep('industry');
  }

  // Step 2 → create brand + first location.
  const createBrand = useMutation(trpc.brands.create.mutationOptions());
  const createLocation = useMutation(trpc.reviews.locations.create.mutationOptions());
  const isSubmitting = createBrand.isPending || createLocation.isPending;

  async function handleComplete() {
    setError(null);
    if (!selectedIndustry) {
      setError('Please select your industry.');
      return;
    }
    try {
      const name = businessName.trim();
      // 1. Create the brand (sets role + selected brand). Skipped on retry when
      //    the brand already exists from a failed location attempt.
      let brandId = createdBrandId;
      if (!brandId) {
        const brand = await createBrand.mutateAsync({ businessName: name });
        brandId = brand.id;
        setCreatedBrandId(brand.id);
      }
      // 2. Create the first review location under the new brand.
      await createLocation.mutateAsync({
        brandId,
        name,
        industry: selectedIndustry,
      });
      // Let the caller navigate BEFORE invalidating auth — the signup flow needs
      // ReviewsApp to mount on '/' before it gains a role from the refreshed me().
      onComplete();
      await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <>
          {/* Progress indicator (step 1 / 2) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
            {(['business', 'industry'] as Step[]).map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    transition: 'all 0.2s',
                    background:
                      step === s || (s === 'business' && step === 'industry')
                        ? 'var(--v-ink)'
                        : 'var(--v-paper-2)',
                    color:
                      step === s || (s === 'business' && step === 'industry')
                        ? 'var(--v-paper)'
                        : 'var(--v-muted)',
                  }}
                >
                  {i + 1}
                </div>
                {i < 1 && (
                  <div
                    style={{
                      height: 1,
                      width: 32,
                      transition: 'background 0.2s',
                      background: step === 'industry' ? 'var(--v-ink)' : 'var(--v-line)',
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 1 — Business name */}
          {step === 'business' && (
            <div>
              <div style={{ marginBottom: 28 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: 'var(--v-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Building2 size={24} color="var(--v-accent-ink)" />
                </div>
                <h1
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    letterSpacing: '-0.035em',
                    margin: '0 0 8px',
                  }}
                >
                  What's your business called?
                </h1>
                <p className="vmuted" style={{ margin: 0, fontSize: 14 }}>
                  This will appear on your customer-facing review page.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="vfield" style={{ marginBottom: 0 }}>
                  <label className="vlabel" htmlFor="bizname">
                    Business name
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="bizname"
                      className="vinput"
                      placeholder="e.g. Sunrise Plumbing Co."
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                      autoFocus
                    />
                    {debouncedName.trim().length > 1 && (
                      <span
                        style={{
                          position: 'absolute',
                          right: 12,
                          top: '50%',
                          transform: 'translateY(-50%)',
                        }}
                      >
                        {nameCheck.isFetching ? (
                          <Loader2
                            size={16}
                            className="animate-spin"
                            style={{ color: 'var(--v-muted)' }}
                          />
                        ) : nameCheck.data?.available ? (
                          <Check size={16} style={{ color: 'var(--v-success)' }} />
                        ) : nameCheck.data ? (
                          <X size={16} style={{ color: 'var(--v-danger)' }} />
                        ) : null}
                      </span>
                    )}
                  </div>
                  {nameTaken && nameCheck.data?.reason && (
                    <div className="verror">{nameCheck.data.reason}</div>
                  )}
                </div>
                {error && <div className="verror">{error}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                  {onCancel && (
                    <button className="vbtn" onClick={onCancel}>
                      Cancel
                    </button>
                  )}
                  <button
                    className="vbtn vbtn-primary"
                    onClick={handleNext}
                    style={{ flex: 1, gap: 8 }}
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Industry selection */}
          {step === 'industry' && (
            <div>
              <div style={{ marginBottom: 28 }}>
                <h1
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    letterSpacing: '-0.035em',
                    margin: '0 0 8px',
                  }}
                >
                  What industry are you in?
                </h1>
                <p className="vmuted" style={{ margin: 0, fontSize: 14 }}>
                  We'll pre-load relevant review tags for{' '}
                  <strong style={{ color: 'var(--v-ink)' }}>{businessName}</strong> based on your
                  selection. You can edit them anytime.
                </p>
              </div>

              {!industries && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '32px 0',
                    marginBottom: 24,
                  }}
                >
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--v-muted)' }} />
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 10,
                  marginBottom: 24,
                }}
              >
                {(industries ?? []).map((industry) => (
                  <button
                    key={industry.slug}
                    className="vselcard"
                    data-selected={selectedIndustry === industry.slug}
                    onClick={() => setSelectedIndustry(industry.slug)}
                  >
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{industry.label}</div>
                    <div className="vmuted" style={{ fontSize: 12, marginTop: 3 }}>
                      {industry.description}
                    </div>
                  </button>
                ))}
              </div>

              {error && <div className="verror" style={{ marginBottom: 12 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="vbtn"
                  onClick={() => {
                    setStep('business');
                    setError(null);
                  }}
                >
                  Back
                </button>
                <button
                  className="vbtn vbtn-primary"
                  style={{ flex: 1, gap: 8 }}
                  onClick={handleComplete}
                  disabled={isSubmitting || !selectedIndustry}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Setting up...
                    </>
                  ) : (
                    <>
                      Set up my account <ChevronRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
    </>
  );
}

/**
 * Full-page post-signup onboarding wrapper. Renders the shared CreateBrandFlow
 * inside the Verdiict onboarding chrome (logo header + sign-out, centered card).
 * On completion it navigates home before auth invalidation so the newly-role'd
 * user lands inside ReviewsApp on '/'.
 */
export function CreateBrandOnboarding() {
  const { data: user } = useCurrentUser();
  const [, navigate] = useLocation();
  const confirm = useConfirm();
  const handleSignOut = async () => {
    if (await confirm({
      title: 'Sign out?',
      description: 'You’ll need to log in again to get back in.',
      confirmLabel: 'Sign out',
      destructive: true,
    })) void signOut();
  };
  return (
    <div className="verdiict" data-tool="reviews-onboarding">
      {/* Lightweight header (matches review-request-tool onboarding) */}
      <div
        style={{
          borderBottom: '1px solid var(--v-line-soft)',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
        }}
      >
        <VerdiictLogo height={18} />
        <button
          className="vbtn vbtn-quiet vbtn-sm"
          onClick={() => void handleSignOut()}
          style={{ fontSize: 12, opacity: 0.7 }}
        >
          {user?.email ? `${user.email} · Sign out` : 'Sign out'}
        </button>
      </div>

      {/* Centered content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          minHeight: 'calc(100vh - 64px)',
        }}
      >
        <div className="vreveal" style={{ width: '100%', maxWidth: 520 }}>
          <CreateBrandFlow onComplete={() => navigate('/')} />
        </div>
      </div>
    </div>
  );
}
