import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Loader2, MailX } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { detectReferral } from '../lib/subdomain';
import { Button } from '../components/ui/button';

/**
 * /auth/handoff — the landing point of a cross-origin session hand-off: the
 * white-label subdomain redirect (useSubdomainRedirect) and cross-frontend
 * navigation (useCrossAppOpen, e.g. dashboard → a frontend hosted on another
 * domain). It carries a one-time magic-link `token_hash` minted on the source
 * origin (auth.createSubdomainHandoff); verifyOtp redeems it to establish a
 * session on THIS origin, the same redemption path as /auth/confirm. We then
 * ensure the app user row (idempotent) and route on to `next` (a same-app
 * path, default `/`); the token is dropped from the URL by navigating away.
 */
export function AuthHandoffPage() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ensureUser = useMutation(trpc.auth.ensureUser.mutationOptions());
  const [phase, setPhase] = useState<'verifying' | 'error'>('verifying');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    // Onward path within THIS app only — a path (never a full URL) so the
    // token can't be turned into an open redirect.
    const nextParam = params.get('next');
    const next =
      nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
        ? nextParam
        : '/';

    async function redeem() {
      if (!tokenHash) {
        setPhase('error');
        return;
      }
      const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
      if (error) {
        // A dead token (expired, or already redeemed by an earlier click) is
        // fine when a session already exists on this origin — e.g. the target
        // shares the auth cookie after all, or the user came through here
        // before. Continue signed in rather than showing an error.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setPhase('error');
          return;
        }
        navigate(next, { replace: true });
        return;
      }
      // Session established on this origin. Ensure the user row (idempotent;
      // also re-stamps nothing since the user already exists) then route on.
      try {
        await ensureUser.mutateAsync(detectReferral());
        await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      } catch {
        /* non-fatal: the session is live; auth.me will resolve on the next load */
      }
      navigate(next, { replace: true });
    }
    redeem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-paper p-5">
      <div className="w-full max-w-sm animate-reveal rounded-[var(--radius-lg)] border border-[color:var(--color-border-hairline)] bg-card p-10 text-center shadow-2">
        <div className="mb-6 font-mono text-xs font-semibold uppercase tracking-[0.32em] text-ink-40">Prodesk</div>
        {phase === 'verifying' ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent/12 ring-1 ring-accent/20">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </span>
            <h1 className="mt-5 text-section-title text-ink-100">Taking you to your workspace…</h1>
            <p className="mt-2 text-sm text-ink-60">One moment while we sign you in.</p>
          </>
        ) : (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-danger/10 ring-1 ring-danger/20">
              <MailX className="h-8 w-8 text-danger" />
            </span>
            <h1 className="mt-5 text-section-title text-ink-100">Sign-in link expired</h1>
            <p className="mt-2 text-sm text-ink-60">This hand-off link is no longer valid. Please sign in again.</p>
            <Button asChild variant="accent" size="lg" className="mt-6 w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
