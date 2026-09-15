/* Post-signup onboarding for the Websites app. This frontend is brand-only and
 * skips role selection: a freshly signed-up, role-less user lands straight here
 * and just names their brand. Creating it sets the brandOwner role + active brand
 * server-side (brands.create), after which App routes into the Websites workspace.
 * Mirrors clients/links CreateBrandOnboarding. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Building2, Check, Loader2, X } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { Card } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Field } from '@shared/pages/agency/form-bits';
import { OnboardingHeader } from '@shared/components/layout/onboarding-header';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function CreateBrandOnboarding() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debouncedName = useDebounced(businessName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName }),
    enabled: debouncedName.trim().length > 1,
  });
  const nameTaken = !!businessName.trim() && nameCheck.data && !nameCheck.data.available;

  const create = useMutation({
    ...trpc.brands.create.mutationOptions(),
    onSuccess: async () => {
      // Settle the URL to home BEFORE refreshing auth.me, so the app re-renders
      // into WebsitesApp on '/' (see the links onboarding note).
      navigate('/');
      await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Could not create brand'),
  });

  const submit = () => {
    setError(null);
    const name = businessName.trim();
    if (!name) {
      setError('Brand name is required');
      return;
    }
    if (nameTaken) {
      setError(nameCheck.data?.reason ?? 'This business name is already taken');
      return;
    }
    create.mutate({ businessName: name });
  };

  return (
    <div className="mx-auto max-w-[480px] px-5 py-10 animate-reveal">
      <OnboardingHeader
        eyebrow="Get started"
        title="Name your"
        titleAccent="brand"
        description="Your brand is your Websites workspace. You can refine everything later in Settings."
      />

      <Card className="p-6 shadow-2 sm:p-8">
        <div className="flex flex-col gap-5">
          <Field
            label="Brand name"
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
              <Input
                id="bn"
                className="pl-9 pr-9"
                autoFocus
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder="e.g. Brighton Bakehouse"
              />
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

          {error && businessName.trim() && (
            <span className="text-sm text-danger">{error}</span>
          )}

          <Button
            variant="accent"
            size="lg"
            className="mt-1 w-full"
            disabled={create.isPending || !!nameTaken}
            onClick={submit}
          >
            {create.isPending ? 'Creating…' : 'Create brand'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
