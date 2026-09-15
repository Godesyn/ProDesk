/* Create-brand onboarding for the Signatures (SIGKITT) app. Shown when the user
 * has no brand for the context selector (e.g. an agency-only user, or a brand
 * user whose brand was removed) — SignaturesApp's shell renders this instead of
 * dead-ending on "No brand selected". Naming a brand calls brands.create, which
 * sets the brandOwner role + active brand server-side; once brands.mine / auth.me
 * refresh, the app is scoped to it and drops into the workspace.
 *
 * Uses the SHARED tRPC client (not the local signatures client) so the created
 * brand invalidates the same brands.mine / auth.me queries useActiveContext reads.
 * Styled to match the SIGKITT design language (paper #F4F1E8, ink #0E0E0C, lime
 * #D9F542) from the email-signature-builder export. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Building2, ChevronRight, Loader2, Check, X } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';

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
  const { data: user } = useCurrentUser();
  const [, navigate] = useLocation();
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Live business-name availability check (debounced) — names are unique across
  // the shared brand+agency namespace.
  const debouncedName = useDebounced(businessName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName }),
    enabled: debouncedName.trim().length > 1,
  });
  const nameTaken =
    !!businessName.trim() && nameCheck.data && !nameCheck.data.available;

  const create = useMutation({
    ...trpc.brands.create.mutationOptions(),
    onSuccess: async () => {
      // The brand is NOT auto-added to SIGKITT — the user enables it from the
      // workspace banner / brand list (first brand is free). Land on the workspace
      // home BEFORE invalidating auth so the shell mounts scoped to the new brand.
      navigate('/');
      await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Could not create brand'),
  });

  function submit() {
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
    create.mutate({ businessName: name });
  }

  return (
    <div className="sigkitt flex min-h-screen flex-col bg-[#F4F1E8]">
      {/* Lightweight header — logo + sign-out (mirrors the export's onboarding chrome). */}
      <div className="flex h-14 items-center justify-between border-b border-[#E8E5DC] px-6">
        <img
          src="/sigkitt-logo.svg"
          alt="SIGKITT"
          className="h-6 w-auto"
        />
        <button
          className="text-xs text-[#999] transition-colors hover:text-[#0E0E0C]"
          onClick={() => void signOut()}
        >
          {user?.email ? `${user.email} · Sign out` : 'Sign out'}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#0E0E0C]">
              Get started
            </span>
          </div>
          <h1 className="mb-2 text-3xl font-black leading-tight tracking-tight text-[#0E0E0C]">
            Name your{' '}
            <em
              className="not-italic"
              style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}
            >
              brand
            </em>
            .
          </h1>
          <p className="mb-7 text-sm leading-relaxed text-[#666]">
            Your brand is your signatures workspace — its brand kits, team members
            and templates all live inside it. You can refine everything later.
          </p>

          <div className="rounded-3xl border border-[#E8E5DC] bg-white p-6 shadow-xl">
            <label
              className="mb-1.5 block text-xs font-semibold text-[#0E0E0C]"
              htmlFor="bizname"
            >
              Brand / business name
            </label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999]" />
              <input
                id="bizname"
                className="w-full rounded-xl border border-[#E8E5DC] bg-white py-2.5 pl-10 pr-10 text-sm text-[#0E0E0C] outline-none transition-colors focus:border-[#0E0E0C]"
                placeholder="e.g. Avenue Property"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                autoFocus
              />
              {debouncedName.trim().length > 1 && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {nameCheck.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#999]" />
                  ) : nameCheck.data?.available ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : nameCheck.data ? (
                    <X className="h-4 w-4 text-red-600" />
                  ) : null}
                </span>
              )}
            </div>
            {nameTaken && nameCheck.data?.reason ? (
              <p className="mt-1.5 text-xs text-red-600">{nameCheck.data.reason}</p>
            ) : error ? (
              <p className="mt-1.5 text-xs text-red-600">{error}</p>
            ) : null}

            <button
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0E0E0C] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1a1a18] disabled:opacity-60"
              onClick={submit}
              disabled={create.isPending || !!nameTaken}
            >
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
                </>
              ) : (
                <>
                  Create brand <ChevronRight className="h-4 w-4 text-primary" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
