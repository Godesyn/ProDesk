import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Loader2, MailX } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { detectReferral } from '../lib/subdomain';
import { Button } from '../components/ui/button';

/**
 * /auth/confirm — redeems the email-verification / magic link we send from our
 * own SMTP (auth.signUp / auth.resendConfirmation). The link carries a
 * `token_hash` + `type`; verifyOtp establishes a session. Redeeming it proves
 * inbox ownership, so we then mark the app user verified (auth.markEmailVerified)
 * to clear the "verify your email" nudge, and route on.
 */
export function AuthConfirmPage() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ensureUser = useMutation(trpc.auth.ensureUser.mutationOptions());
  const markVerified = useMutation(trpc.auth.markEmailVerified.mutationOptions());
  const [phase, setPhase] = useState<'verifying' | 'error'>('verifying');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = (params.get('type') ?? 'signup') as 'signup' | 'magiclink' | 'email';

    async function redeem() {
      if (!tokenHash) {
        setPhase('error');
        return;
      }
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (error) {
        setPhase('error');
        return;
      }
      // Session established. Ensure the app user row exists (idempotent; also
      // creates the support thread for a brand-new device), then flip the
      // app-level verified flag so the nudge banner clears.
      try {
        await ensureUser.mutateAsync(detectReferral());
        await markVerified.mutateAsync();
        await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      } catch {
        /* non-fatal: account is usable; banner just lingers until next verify */
      }
      navigate('/');
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
            <h1 className="mt-5 text-section-title text-ink-100">Confirming your email…</h1>
            <p className="mt-2 text-sm text-ink-60">Hold on while we activate your account.</p>
          </>
        ) : (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-danger/10 ring-1 ring-danger/20">
              <MailX className="h-8 w-8 text-danger" />
            </span>
            <h1 className="mt-5 text-section-title text-ink-100">Link invalid or expired</h1>
            <p className="mt-2 text-sm text-ink-60">This confirmation link is no longer valid. Try signing in, or request a new link.</p>
            <Button asChild variant="accent" size="lg" className="mt-6 w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
