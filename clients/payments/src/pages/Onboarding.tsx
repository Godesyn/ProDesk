import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useTRPC } from '@shared/lib/trpc';
import { useBrandId } from '@/lib/payments-trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  INDUSTRIES,
  TEAM_SIZES,
  MONTHLY_VOLUMES,
  PROPOSAL_THEMES,
} from '@/lib/types';
import {
  createDefaultBlocks,
  applyBrandKitToBlocks,
  type BrandKit,
} from '@/lib/blocks';
import {
  Building2,
  Palette,
  CreditCard,
  FileText,
  Send,
  Check,
  ChevronRight,
  Upload,
  Zap,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';

/** Debounced mirror of a value — used for the live business-name availability check. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const STEPS = [
  {
    id: 1,
    key: 'profile',
    label: 'Business Profile',
    icon: Building2,
    desc: 'Tell us about your business',
  },
  {
    id: 2,
    key: 'brand',
    label: 'Brand Kit',
    icon: Palette,
    desc: 'Upload your logo and set colours',
  },
  {
    id: 3,
    key: 'stripe',
    label: 'Get Paid',
    icon: CreditCard,
    desc: 'Connect Stripe to accept payments',
  },
  {
    id: 4,
    key: 'tier',
    label: 'Choose Your Plan',
    icon: Zap,
    desc: 'Pick the tier that fits your business',
  },
  {
    id: 5,
    key: 'template',
    label: 'First Template',
    icon: FileText,
    desc: 'Create your proposal template',
  },
  {
    id: 6,
    key: 'sent',
    label: 'All Done',
    icon: Send,
    desc: 'Start sending proposals',
  },
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  // A role-less signup (or a role'd user with no brand) reaches this wizard with
  // NO brand yet — Step 1 creates it. Keep the created id locally and treat it as
  // the active brand for the rest of the wizard, so brand creation mid-flow
  // doesn't need a context refresh (which would remount the tree).
  const ctxBrandId = useBrandId();
  const [createdBrandId, setCreatedBrandId] = useState<string | null>(null);
  const brandId = ctxBrandId ?? createdBrandId;
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1 state
  const [businessName, setBusinessName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [abn, setAbn] = useState('');
  const [industry, setIndustry] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [monthlyVolume, setMonthlyVolume] = useState('');

  // ToS agreement
  const [tosAgreed, setTosAgreed] = useState(false);

  // Step 2 state
  const [primaryColor, setPrimaryColor] = useState('#0E0E0C');
  const [accentColor, setAccentColor] = useState('#D9F542');
  const [selectedTheme, setSelectedTheme] = useState<
    'agency' | 'digital' | 'luxury'
  >('digital');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const getUploadUrl = useMutation(
    trpc.payments.accounts.getAssetUploadUrl.mutationOptions(),
  );
  const recordAsset = useMutation(
    trpc.payments.accounts.recordAssetUpload.mutationOptions(),
  );

  const handleLogoUpload = useCallback(
    async (file: File) => {
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Logo must be under 2MB');
        return;
      }
      if (!brandId) {
        toast.error('No active brand');
        return;
      }
      setLogoUploading(true);
      try {
        // Signed Supabase Storage upload (replaces the export's /api/assets/upload route)
        const target = await getUploadUrl.mutateAsync({
          brandId,
          filename: file.name,
          contentType: file.type,
          assetType: 'logo_light',
        });
        const res = await fetch(target.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!res.ok) throw new Error('Upload failed');
        setLogoUrl(target.publicUrl);
        // Mirror into the brand's Document Locker — the bytes went
        // browser→storage, so this confirm is how the server learns it landed.
        recordAsset.mutate({
          brandId,
          key: target.key,
          publicUrl: target.publicUrl,
          filename: file.name,
          assetType: 'logo_light',
          size: file.size,
        });
        toast.success('Logo uploaded');
      } catch {
        toast.error('Failed to upload logo');
      } finally {
        setLogoUploading(false);
      }
    },
    [brandId, getUploadUrl, recordAsset],
  );

  // Step 4 — tier selection
  const [selectedTier, setSelectedTier] = useState<
    'send' | 'close' | 'recover'
  >('send');
  const changeTier = useMutation(
    trpc.payments.billing.changeTier.mutationOptions(),
  );

  const handleStep4Tier = useCallback(async () => {
    if (!brandId) {
      toast.error('No active brand');
      return;
    }
    setSaving(true);
    try {
      await changeTier.mutateAsync({
        brandId,
        tier: selectedTier,
        initiatedVia: 'settings',
      });
      await updateAccount.mutateAsync({ brandId, onboardingState: 'template' });
      setStep(5);
    } catch (e) {
      toast.error('Failed to save tier selection');
    } finally {
      setSaving(false);
    }
  }, [selectedTier, brandId]);

  // Step 5 state
  const [templateName, setTemplateName] = useState('My First Template');

  // tRPC mutations
  const createAccount = useMutation(
    trpc.payments.accounts.create.mutationOptions(),
  );
  const updateAccount = useMutation(
    trpc.payments.accounts.update.mutationOptions(),
  );
  const updateBrandKit = useMutation(
    trpc.payments.accounts.updateBrandKit.mutationOptions(),
  );
  const createTemplate = useMutation(
    trpc.payments.templates.create.mutationOptions(),
  );

  // ── Brand bootstrap (merged from the old standalone create-brand screen) ──
  const createBrand = useMutation(trpc.brands.create.mutationOptions());
  const updateBrand = useMutation(trpc.brands.update.mutationOptions());

  // Live business-name availability — unique across the brand+agency namespace.
  // Only relevant before the brand exists (i.e. the first run of Step 1).
  const debouncedName = useDebounced(businessName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({
      businessName: debouncedName,
    }),
    enabled: !brandId && debouncedName.trim().length > 1,
  });
  const nameTaken =
    !brandId &&
    !!businessName.trim() &&
    !!nameCheck.data &&
    !nameCheck.data.available;

  // Resume at the step implied by saved progress. If the role/brand context
  // resolves mid-wizard (window-focus refetch, reload) the tree can remount —
  // land the user back where they were instead of restarting at Step 1.
  const { data: existingAccount } = useQuery({
    ...trpc.payments.accounts.me.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || createdBrandId || !existingAccount) return;
    resumedRef.current = true;
    const s = (existingAccount as { onboardingState?: string }).onboardingState;
    const stepFor: Record<string, number> = {
      brand: 2,
      stripe: 3,
      template: 4,
      sent: 6,
    };
    const target = s ? stepFor[s] : undefined;
    if (target && target > 1) setStep(target);
  }, [existingAccount, createdBrandId]);

  const { data: stripeConnectStatus } = useQuery({
    ...trpc.payments.integrations.stripe.status.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const { data: stripeConnectUrlData } = useQuery({
    ...trpc.payments.integrations.stripe.connectUrl.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });

  const handleStep1 = useCallback(async () => {
    const name = businessName.trim();
    if (!name) {
      toast.error('Business name is required');
      return;
    }
    if (nameTaken) {
      toast.error(
        nameCheck.data?.reason ?? 'That business name is already taken',
      );
      return;
    }
    setSaving(true);
    try {
      // First run (no brand yet) → create the brand; the server re-checks the
      // unique name. Otherwise persist any legal-name edit onto the existing brand.
      let activeBrandId = brandId;
      if (!activeBrandId) {
        const brand = await createBrand.mutateAsync({
          businessName: name,
          legalName: legalName.trim() || undefined,
        });
        activeBrandId = brand.id;
        setCreatedBrandId(brand.id);
      } else if (legalName.trim()) {
        await updateBrand.mutateAsync({
          brandId: activeBrandId,
          legalName: legalName.trim(),
        });
      }
      await createAccount.mutateAsync({
        brandId: activeBrandId,
        businessName: name,
        email: `owner@${name.toLowerCase().replace(/\s+/g, '')}.com`,
      });
      await updateAccount.mutateAsync({
        brandId: activeBrandId,
        businessName: name,
        abn: abn || undefined,
        industry: industry || undefined,
        teamSize: teamSize || undefined,
        monthlyVolumeEstimate: monthlyVolume || undefined,
        onboardingState: 'brand',
      });
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }, [
    businessName,
    legalName,
    nameTaken,
    nameCheck.data,
    abn,
    industry,
    teamSize,
    monthlyVolume,
    brandId,
  ]);

  const handleStep2 = useCallback(async () => {
    if (!brandId) {
      toast.error('No active brand');
      return;
    }
    setSaving(true);
    try {
      await updateBrandKit.mutateAsync({
        brandId,
        primaryColor,
        accentColor,
        logoLightUrl: logoUrl ?? undefined,
      });
      await updateAccount.mutateAsync({
        brandId,
        proposalTheme: selectedTheme,
        onboardingState: 'stripe',
      });
      setStep(3);
    } catch (e) {
      toast.error('Failed to save brand kit');
    } finally {
      setSaving(false);
    }
  }, [primaryColor, accentColor, selectedTheme, logoUrl, brandId]);

  const handleStep3Connect = useCallback(async () => {
    if (!brandId) {
      toast.error('No active brand');
      return;
    }
    if (stripeConnectUrlData?.url) {
      window.open(stripeConnectUrlData.url, '_blank');
      toast.success(
        'Stripe Connect opened in a new tab. Return here once connected.',
      );
    } else {
      toast.info(
        'Stripe Connect not configured — you can connect later in Settings → Payments',
      );
    }
    setSaving(true);
    await updateAccount.mutateAsync({ brandId, onboardingState: 'template' });
    setSaving(false);
    setStep(4);
  }, [stripeConnectUrlData, brandId]);
  const handleStep3Skip = useCallback(async () => {
    if (!brandId) {
      toast.error('No active brand');
      return;
    }
    setSaving(true);
    await updateAccount.mutateAsync({ brandId, onboardingState: 'template' });
    setSaving(false);
    setStep(4);
  }, [brandId]);

  const handleStep5 = useCallback(async () => {
    if (!templateName.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!brandId) {
      toast.error('No active brand');
      return;
    }
    setSaving(true);
    try {
      // Build a system-generated default template with canonical blocks
      // using the brand kit colours collected in step 2
      const brandKit: BrandKit = {
        primaryColor,
        accentColor,
        logoLightUrl: logoUrl,
        logoDarkUrl: null,
        headingFont: null,
        bodyFont: null,
        backgroundColor: null,
        textColor: null,
      };
      const rawBlocks = createDefaultBlocks({
        businessName: businessName.trim() || 'Your Business',
        currency: 'AUD',
      });
      const themedBlocks = applyBrandKitToBlocks(rawBlocks, brandKit);
      await createTemplate.mutateAsync({
        brandId,
        name: templateName.trim(),
        source: 'system',
        structure: { blocks: themedBlocks, theme: selectedTheme },
        isSystem: true,
      });
      await updateAccount.mutateAsync({ brandId, onboardingState: 'sent' });
      setStep(6);
    } catch (e) {
      toast.error('Failed to create template');
    } finally {
      setSaving(false);
    }
  }, [
    templateName,
    businessName,
    primaryColor,
    accentColor,
    logoUrl,
    selectedTheme,
    brandId,
  ]);

  const handleComplete = useCallback(async () => {
    if (!brandId) {
      toast.error('No active brand');
      return;
    }
    setSaving(true);
    await updateAccount.mutateAsync({ brandId, onboardingState: 'complete' });
    // Adopt the new brand into the shared context now that setup is done — the
    // wizard deferred this so creating the brand mid-flow wouldn't remount the tree.
    await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
    await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    setSaving(false);
    navigate('/app');
  }, [brandId, qc, trpc]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] min-h-screen bg-[var(--bg-page)]">
      {/* Left sidebar */}
      <div
        className="hidden md:flex flex-col"
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          padding: '40px 28px',
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 48,
          }}
        >
          <img
            src="/logo-wordmark.svg"
            alt="Prodesk"
            style={{ height: 28, width: 'auto', objectFit: 'contain' }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(244,241,232,0.4)',
              marginBottom: 20,
            }}
          >
            Setup Progress
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {STEPS.map((s) => {
              const Icon = s.icon;
              const done = step > s.id;
              const active = step === s.id;
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '10px 0',
                    opacity: done ? 0.7 : active ? 1 : 0.35,
                    transition: 'opacity 240ms',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: done
                        ? 'var(--volt)'
                        : active
                          ? 'rgba(244,241,232,0.15)'
                          : 'transparent',
                      border: done
                        ? 'none'
                        : active
                          ? '1.5px solid rgba(244,241,232,0.5)'
                          : '1.5px solid rgba(244,241,232,0.2)',
                      display: 'grid',
                      placeItems: 'center',
                      transition: 'all 240ms',
                    }}
                  >
                    {done ? (
                      <Check size={13} color="var(--ink)" />
                    ) : (
                      <Icon
                        size={12}
                        color={
                          active ? 'var(--paper)' : 'rgba(244,241,232,0.5)'
                        }
                      />
                    )}
                  </div>
                  <div>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: active ? 700 : 500,
                        color: active
                          ? 'var(--paper)'
                          : 'rgba(244,241,232,0.7)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {s.label}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: 'rgba(244,241,232,0.4)',
                        marginTop: 1,
                      }}
                    >
                      {s.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            marginTop: 'auto',
            padding: '16px',
            background: 'rgba(244,241,232,0.06)',
            borderRadius: 10,
          }}
        >
          <p
            style={{
              fontSize: 11,
              color: 'rgba(244,241,232,0.5)',
              lineHeight: 1.5,
            }}
          >
            Need help? Our team is available Mon–Fri 9am–5pm AEST.
          </p>
          <a
            href="/support"
            onClick={(e) => {
              e.preventDefault();
              navigate('/support');
            }}
            style={{
              fontSize: 11,
              color: 'var(--volt)',
              textDecoration: 'none',
              marginTop: 4,
              display: 'block',
              cursor: 'pointer',
            }}
          >
            Contact support
          </a>
        </div>
      </div>

      {/* Right content */}
      <div
        className="p-6 md:p-[60px_80px]"
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: 640,
          overflowY: 'auto',
        }}
      >
        {/* Step indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
            }}
          >
            Step {step} of {STEPS.length}
          </span>
          <div
            style={{
              flex: 1,
              height: 2,
              background: 'var(--border-1)',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(step / STEPS.length) * 100}%`,
                background: 'var(--ink)',
                borderRadius: 1,
                transition: 'width 400ms var(--ease-out)',
              }}
            />
          </div>
        </div>

        {/* Step 1 — Business Profile */}
        {step === 1 && (
          <div style={{ animation: 'fadeSlideIn 300ms var(--ease-out)' }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: 6,
              }}
            >
              Business Profile
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ink-60)',
                marginBottom: 32,
                lineHeight: 1.5,
              }}
            >
              Tell us about your business so we can personalise your EziQuotes
              experience.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="fld">
                <label>Business Name *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Bright Solar Solutions"
                  />
                  {!brandId && debouncedName.trim().length > 1 && (
                    <span
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {nameCheck.isFetching ? (
                        <Loader2
                          size={16}
                          className="animate-spin"
                          color="var(--ink-40)"
                        />
                      ) : nameCheck.data?.available ? (
                        <Check size={16} color="#3A5000" />
                      ) : nameCheck.data ? (
                        <X size={16} color="var(--danger)" />
                      ) : null}
                    </span>
                  )}
                </div>
                {nameTaken && nameCheck.data?.reason && (
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--danger)',
                      marginTop: 6,
                    }}
                  >
                    {nameCheck.data.reason}
                  </p>
                )}
              </div>
              <div className="fld">
                <label>Legal Name (if different)</label>
                <input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="e.g. Bright Solar Solutions Pty Ltd"
                />
              </div>
              <div className="fld">
                <label>ABN</label>
                <input
                  value={abn}
                  onChange={(e) => setAbn(e.target.value)}
                  placeholder="12 345 678 901"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="fld">
                  <label>Industry</label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                  >
                    <option value="">Select industry…</option>
                    {INDUSTRIES.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fld">
                  <label>Team Size</label>
                  <select
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                  >
                    <option value="">Select size…</option>
                    {TEAM_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="fld">
                <label>Estimated Monthly Volume</label>
                <select
                  value={monthlyVolume}
                  onChange={(e) => setMonthlyVolume(e.target.value)}
                >
                  <option value="">Select range…</option>
                  {MONTHLY_VOLUMES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ToS agreement */}
            <div
              style={{
                marginTop: 24,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '14px 16px',
                background: 'var(--bg-inset, #f5f5f3)',
                borderRadius: 10,
                border: '1px solid var(--border-1, #e5e5e3)',
              }}
            >
              <input
                type="checkbox"
                id="tos-agree"
                checked={tosAgreed}
                onChange={(e) => setTosAgreed(e.target.checked)}
                style={{
                  marginTop: 2,
                  flexShrink: 0,
                  accentColor: 'var(--ink)',
                }}
              />
              <label
                htmlFor="tos-agree"
                style={{
                  fontSize: 13,
                  color: 'var(--ink-60)',
                  lineHeight: 1.5,
                  cursor: 'pointer',
                }}
              >
                I have read and agree to the EziQuotes{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--ink)', fontWeight: 600 }}
                >
                  Terms of Service
                </a>{' '}
                and{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--ink)', fontWeight: 600 }}
                >
                  Privacy Policy
                </a>
                . By continuing, I authorise EziQuotes to process payments on
                behalf of my business.
              </label>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
              <button
                className="btn dark"
                onClick={handleStep1}
                disabled={saving || !tosAgreed || nameTaken}
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  opacity: tosAgreed && !nameTaken ? 1 : 0.5,
                }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Brand Kit */}
        {step === 2 && (
          <div style={{ animation: 'fadeSlideIn 300ms var(--ease-out)' }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: 6,
              }}
            >
              Brand Kit
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ink-60)',
                marginBottom: 32,
                lineHeight: 1.5,
              }}
            >
              Upload your logo and set your brand colours. These will appear on
              all client-facing proposals.
            </p>

            {/* Logo upload */}
            <div style={{ marginBottom: 24 }}>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-60)',
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                Logo
              </p>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoUpload(f);
                }}
              />
              <div
                style={{
                  border: logoUrl
                    ? '1.5px solid var(--border-1)'
                    : '1.5px dashed var(--border-2)',
                  borderRadius: 10,
                  padding: '28px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  transition: 'background 120ms',
                  background: 'var(--bg-card)',
                }}
                onClick={() => logoInputRef.current?.click()}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--bg-inset)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = 'var(--bg-card)')
                }
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleLogoUpload(f);
                }}
              >
                {logoUploading ? (
                  <Loader2
                    size={20}
                    color="var(--ink-40)"
                    style={{ animation: 'spin 1s linear infinite' }}
                  />
                ) : logoUrl ? (
                  <>
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      style={{
                        maxHeight: 48,
                        maxWidth: 200,
                        objectFit: 'contain',
                      }}
                    />
                    <p style={{ fontSize: 11, color: 'var(--ink-40)' }}>
                      Click to replace
                    </p>
                  </>
                ) : (
                  <>
                    <Upload size={20} color="var(--ink-40)" />
                    <p
                      style={{
                        fontSize: 13,
                        color: 'var(--ink-60)',
                        textAlign: 'center',
                      }}
                    >
                      <strong style={{ color: 'var(--ink)' }}>
                        Click to upload
                      </strong>{' '}
                      or drag and drop
                      <br />
                      <span style={{ fontSize: 11, color: 'var(--ink-40)' }}>
                        PNG, SVG, or WEBP — max 2MB
                      </span>
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Colours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="fld">
                <label>Primary Colour</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{
                      width: 36,
                      height: 36,
                      padding: 2,
                      borderRadius: 6,
                      border: '1px solid var(--border-2)',
                      cursor: 'pointer',
                    }}
                  />
                  <input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{
                      flex: 1,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  />
                </div>
              </div>
              <div className="fld">
                <label>Accent Colour</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{
                      width: 36,
                      height: 36,
                      padding: 2,
                      borderRadius: 6,
                      border: '1px solid var(--border-2)',
                      cursor: 'pointer',
                    }}
                  />
                  <input
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{
                      flex: 1,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Proposal theme */}
            <div style={{ marginBottom: 24 }}>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-60)',
                  marginBottom: 10,
                  fontWeight: 500,
                }}
              >
                Proposal Theme
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {PROPOSAL_THEMES.map((t) => (
                  <div
                    key={t.value}
                    onClick={() =>
                      setSelectedTheme(t.value as typeof selectedTheme)
                    }
                    style={{
                      border:
                        selectedTheme === t.value
                          ? '2px solid var(--ink)'
                          : '1.5px solid var(--border-1)',
                      borderRadius: 10,
                      padding: '14px 12px',
                      cursor: 'pointer',
                      background:
                        selectedTheme === t.value
                          ? 'var(--bg-inset)'
                          : 'var(--bg-card)',
                      transition: 'all 120ms',
                      position: 'relative',
                    }}
                  >
                    {selectedTheme === t.value && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          width: 16,
                          height: 16,
                          background: 'var(--ink)',
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <Check size={9} color="var(--paper)" />
                      </div>
                    )}
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--ink)',
                        marginBottom: 3,
                      }}
                    >
                      {t.label}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-60)',
                        lineHeight: 1.4,
                      }}
                    >
                      {t.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn"
                onClick={() => setStep(1)}
                style={{ minWidth: 80 }}
              >
                Back
              </button>
              <button
                className="btn dark"
                onClick={handleStep2}
                disabled={saving}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Stripe Connect */}
        {step === 3 && (
          <div style={{ animation: 'fadeSlideIn 300ms var(--ease-out)' }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: 6,
              }}
            >
              Connect Stripe
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ink-60)',
                marginBottom: 32,
                lineHeight: 1.5,
              }}
            >
              Connect your Stripe account to accept payments directly through
              your proposals. EziQuotes's platform fee is deducted automatically
              on each transaction — the rate depends on your plan.
            </p>

            {/* Stripe connect card */}
            <div
              style={{
                border: '1px solid var(--border-1)',
                borderRadius: 14,
                padding: 24,
                background: 'var(--bg-card)',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    background: '#635BFF',
                    borderRadius: 8,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <CreditCard size={18} color="white" />
                </div>
                <div>
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'var(--ink)',
                    }}
                  >
                    Stripe Connect Express
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-60)' }}>
                    Secure, instant payouts to your bank
                  </p>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                {[
                  'Payments deposited directly to your bank',
                  'Instant access to funds (T+1 for AU)',
                  'Full PCI DSS compliance',
                  'Platform fee deducted automatically (based on your plan)',
                ].map((f) => (
                  <div
                    key={f}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <Check size={13} color="#3A5000" />
                    <span style={{ fontSize: 13, color: 'var(--ink-60)' }}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>
              {stripeConnectStatus?.connected ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    background: '#f0fff4',
                    borderRadius: 8,
                    border: '1px solid #68d391',
                  }}
                >
                  <Check size={14} color="#276749" />
                  <span
                    style={{ fontSize: 13, fontWeight: 600, color: '#276749' }}
                  >
                    Stripe Connected — {stripeConnectStatus.stripeAccountId}
                  </span>
                </div>
              ) : (
                <button
                  className="btn dark"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    background: '#635BFF',
                    borderColor: '#635BFF',
                  }}
                  onClick={handleStep3Connect}
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CreditCard size={14} />
                  )}
                  Connect with Stripe
                </button>
              )}
            </div>

            <p
              style={{
                fontSize: 12,
                color: 'var(--ink-40)',
                textAlign: 'center',
                marginBottom: 20,
              }}
            >
              You can also connect Stripe later from Settings → Payments.
            </p>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn"
                onClick={() => setStep(2)}
                style={{ minWidth: 80 }}
              >
                Back
              </button>
              <button
                className="btn ghost"
                onClick={handleStep3Skip}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Skip for now <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Choose Your Plan */}
        {step === 4 && (
          <div style={{ animation: 'fadeSlideIn 300ms var(--ease-out)' }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: 6,
              }}
            >
              Choose Your Plan
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ink-60)',
                marginBottom: 32,
                lineHeight: 1.5,
              }}
            >
              You can change your plan at any time from Settings → Billing.
              Start with Send and upgrade when you're ready.
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                marginBottom: 32,
              }}
            >
              {[
                {
                  value: 'send' as const,
                  label: 'Send',
                  rate: '1%',
                  desc: 'Proposal builder, SMS/email delivery, Stripe payouts, basic chase reminders.',
                  features: [
                    'Proposal builder',
                    'Brand kit',
                    'SMS + email delivery',
                    'Stripe Connect',
                  ],
                  recommended: false,
                  waitlist: false,
                },
                {
                  value: 'close' as const,
                  label: 'Close',
                  rate: '1.7%',
                  desc: 'Everything in Send, plus AI-powered follow-up sequences that close deals automatically.',
                  features: [
                    'Everything in Send',
                    'Cold outreach sequences',
                    'Engagement nudges',
                    'AI message rewriter',
                  ],
                  recommended: true,
                  waitlist: false,
                },
                {
                  value: 'recover' as const,
                  label: 'Recover',
                  rate: '5%',
                  desc: 'Everything in Close, plus missed-payment recovery sequences. Join the waitlist.',
                  features: [
                    'Everything in Close',
                    'Missed payment sequences',
                    'Lapsed client re-engagement',
                  ],
                  recommended: false,
                  waitlist: true,
                },
              ].map((plan) => (
                <div
                  key={plan.value}
                  onClick={() => setSelectedTier(plan.value)}
                  style={{
                    border:
                      selectedTier === plan.value
                        ? '2px solid var(--ink)'
                        : '1.5px solid var(--border-1)',
                    borderRadius: 12,
                    padding: '18px 20px',
                    cursor: 'pointer',
                    background:
                      selectedTier === plan.value
                        ? 'var(--bg-inset)'
                        : 'var(--bg-card)',
                    transition: 'all 150ms',
                    position: 'relative',
                  }}
                >
                  {plan.recommended && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 14,
                        right: 14,
                        background: 'var(--ink)',
                        color: 'var(--volt)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        padding: '2px 7px',
                        borderRadius: 3,
                        fontWeight: 700,
                      }}
                    >
                      RECOMMENDED
                    </span>
                  )}
                  {plan.waitlist && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 14,
                        right: 14,
                        background: 'var(--bg-inset)',
                        color: 'var(--ink-60)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        padding: '2px 7px',
                        borderRadius: 3,
                        fontWeight: 700,
                        border: '1px solid var(--border-1)',
                      }}
                    >
                      WAITLIST
                    </span>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        letterSpacing: '-0.04em',
                        color: 'var(--ink)',
                      }}
                    >
                      {plan.label}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 20,
                        fontWeight: 700,
                        color: 'var(--ink)',
                      }}
                    >
                      {plan.rate}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--ink-40)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      PLATFORM FEE
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--ink-60)',
                      lineHeight: 1.5,
                      marginBottom: 10,
                    }}
                  >
                    {plan.desc}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {plan.features.map((f) => (
                      <span
                        key={f}
                        style={{
                          fontSize: 11,
                          background: 'var(--bg-page)',
                          border: '1px solid var(--border-1)',
                          borderRadius: 4,
                          padding: '2px 7px',
                          color: 'var(--ink-60)',
                        }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn"
                onClick={() => setStep(3)}
                style={{ minWidth: 80 }}
              >
                Back
              </button>
              <button
                className="btn dark"
                onClick={handleStep4Tier}
                disabled={saving}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue with{' '}
                {selectedTier.charAt(0).toUpperCase() +
                  selectedTier.slice(1)}{' '}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — First Template */}
        {step === 5 && (
          <div style={{ animation: 'fadeSlideIn 300ms var(--ease-out)' }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: 6,
              }}
            >
              Create Your First Template
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ink-60)',
                marginBottom: 32,
                lineHeight: 1.5,
              }}
            >
              Templates are the foundation of your proposals. Start from scratch
              or pick from our library.
            </p>

            <div className="fld" style={{ marginBottom: 24 }}>
              <label>Template Name</label>
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Standard Solar Proposal"
              />
            </div>

            {/* Library quick-picks */}
            <div style={{ marginBottom: 24 }}>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-60)',
                  marginBottom: 10,
                  fontWeight: 500,
                }}
              >
                Or start from the library
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  'Solar Installation',
                  'Landscaping Project',
                  'Web Design & Build',
                  'Photography Package',
                ].map((name) => (
                  <div
                    key={name}
                    onClick={() => setTemplateName(name)}
                    style={{
                      border:
                        templateName === name
                          ? '2px solid var(--ink)'
                          : '1px solid var(--border-1)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      background:
                        templateName === name
                          ? 'var(--bg-inset)'
                          : 'var(--bg-card)',
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      transition: 'all 120ms',
                    }}
                  >
                    {name}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn"
                onClick={() => setStep(4)}
                style={{ minWidth: 80 }}
              >
                Back
              </button>
              <button
                className="btn dark"
                onClick={handleStep5}
                disabled={saving}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Create Template <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — Done */}
        {step === 6 && (
          <div
            style={{
              animation: 'fadeSlideIn 300ms var(--ease-out)',
              textAlign: 'center',
              paddingTop: 40,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                background: 'var(--volt)',
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 24px',
              }}
            >
              <Check size={28} color="var(--ink)" />
            </div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: 8,
              }}
            >
              You're all set!
            </h1>
            <p
              style={{
                fontSize: 15,
                color: 'var(--ink-60)',
                marginBottom: 40,
                lineHeight: 1.6,
                maxWidth: 400,
                margin: '0 auto 40px',
              }}
            >
              Your EziQuotes account is ready. Start sending proposals and
              getting paid — fast.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-9 text-left">
              {[
                {
                  icon: '📄',
                  title: 'Create Proposal',
                  desc: 'Build and send your first proposal',
                },
                {
                  icon: '👥',
                  title: 'Add Clients',
                  desc: 'Import or add clients manually',
                },
                {
                  icon: '📱',
                  title: 'Quick Quote',
                  desc: 'Send proposals from your phone',
                },
              ].map((item) => (
                <div
                  key={item.title}
                  style={{
                    border: '1px solid var(--border-1)',
                    borderRadius: 10,
                    padding: 16,
                    background: 'var(--bg-card)',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--ink)',
                      marginTop: 8,
                      marginBottom: 4,
                    }}
                  >
                    {item.title}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--ink-60)' }}>
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            <button
              className="btn dark"
              onClick={handleComplete}
              disabled={saving}
              style={{ padding: '12px 32px', fontSize: 14, borderRadius: 10 }}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Go to Dashboard
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
