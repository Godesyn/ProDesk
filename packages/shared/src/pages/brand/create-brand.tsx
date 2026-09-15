import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { Building2, Globe, Check, Loader2, X } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useCurrentUser } from '../../auth/auth-context';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PhoneInput } from '../../components/ui/phone-input';
import { Field } from '../agency/form-bits';
import { OnboardingHeader } from '../../components/layout/onboarding-header';
import { urlError, normalizeUrlOrUndefined } from '../../lib/url';

/** Create Brand Profile — Business Name / Website / Phone. Ports create_brand_screen.dart. */
export function CreateBrandPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();

  // Referral support: ?ref=<token> seeds the brand id + referralToken (Flutter referralId).
  const params = new URLSearchParams(window.location.search);
  const referralId = params.get('ref') || undefined;
  const initialName = params.get('name') || '';
  // Proposal flow: ?proposalToken=<token> means the user created this brand to
  // attach a proposal opened from the email link — connect it, then open it.
  const proposalToken = params.get('proposalToken') || undefined;

  const [businessName, setBusinessName] = useState(initialName);
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Live business-name availability — unique across the brand+agency namespace
  // (mirrors the create-agency form). Debounced to avoid a query per keystroke.
  const debouncedName = useDebounced(businessName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName }),
    enabled: debouncedName.trim().length > 1,
  });
  const nameTaken = !!businessName.trim() && nameCheck.data && !nameCheck.data.available;

  const connectProposal = useMutation(trpc.proposals.connectViaToken.mutationOptions());

  const create = useMutation({
    ...trpc.brands.create.mutationOptions(),
    onSuccess: async (brand) => {
      toast.success('Brand profile created!');
      await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      if (proposalToken) {
        try {
          const res = await connectProposal.mutateAsync({ token: proposalToken, mode: 'existing', brandId: brand.id });
          navigate(`/proposal/${res.proposalId}`);
          return;
        } catch {
          // Connection failed (e.g. expired token) — still land them in their new brand.
        }
      }
      navigate('/brand-dashboard');
    },
    onError: (e) => toastError(e),
  });

  const submit = () => {
    setError(null);
    if (!businessName.trim()) { setError('Business Name is required'); return; }
    if (nameTaken) { setError(nameCheck.data?.reason ?? 'This business name is already taken'); return; }
    const websiteIssue = urlError(website);
    if (websiteIssue) { setError(websiteIssue); return; }
    create.mutate({
      businessName: businessName.trim(),
      website: normalizeUrlOrUndefined(website),
      phone: phone.trim() || undefined,
      ...(referralId ? { id: referralId, referralToken: referralId } : {}),
    });
  };

  return (
    <div className="mx-auto max-w-[560px] px-5 py-10 animate-reveal">
      <OnboardingHeader
        eyebrow="Brand profile"
        title="Tell us about your"
        titleAccent="business"
        description="A few basics to set up your brand. You can refine everything later from your profile."
        backTo={user?.role ? undefined : '/role-selection'}
        backLabel="Choose a different role"
      />

      <Card className="p-6 sm:p-8 shadow-2">
        <div className="flex flex-col gap-5">
          <Field
            label="Business name"
            htmlFor="bn"
            error={
              error && !businessName.trim()
                ? error
                : nameTaken
                  ? nameCheck.data?.reason
                  : null
            }
          >
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
              <Input id="bn" className="pl-9 pr-9" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Inc." />
              {debouncedName.trim().length > 1 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {nameCheck.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-ink-40" />
                  ) : nameCheck.data?.available ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : nameCheck.data ? (
                    <X className="h-4 w-4 text-danger" />
                  ) : null}
                </span>
              )}
            </div>
          </Field>

          <Field label="Website" htmlFor="ws" hint="Optional — include https://">
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
              <Input id="ws" className="pl-9" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
            </div>
          </Field>

          <Field label="Business phone" htmlFor="ph" hint="Optional">
            <PhoneInput id="ph" value={phone} onChange={setPhone} />
          </Field>

          {error && businessName.trim() && <span className="text-sm text-danger">{error}</span>}

          <Button variant="accent" size="lg" className="mt-1 w-full" disabled={create.isPending || !!nameTaken} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create brand profile'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Debounce a fast-changing value so we don't fire a query per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
