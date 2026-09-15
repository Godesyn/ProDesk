import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, Sparkles, User } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { captureBetaCode } from '../beta/beta-code';
import { supabase } from '../lib/supabase';
import { DEV_AUTH_PREFILL } from '../lib/dev-prefill';
import { Button } from '../components/ui/button';
import {
  AuthShell,
  AuthField,
  IconInput,
  PasswordInput,
  OrDivider,
  GoogleMark,
  CLIENT_AUTH_BRANDING,
} from '../auth/auth-shell';
import { PRODESK_CLIENT } from '../lib/client-id';
import { toastError } from '../lib/errors';

export function SignupPage() {
  const trpc = useTRPC();
  const [, setLocation] = useLocation();
  const signUp = useMutation(trpc.auth.signUp.mutationOptions());
  const [firstName, setFirstName] = useState(DEV_AUTH_PREFILL?.firstName ?? '');
  const [lastName, setLastName] = useState(DEV_AUTH_PREFILL?.lastName ?? '');
  const [email, setEmail] = useState(DEV_AUTH_PREFILL?.email ?? '');
  const [password, setPassword] = useState(DEV_AUTH_PREFILL?.password ?? '');
  const [confirmPassword, setConfirmPassword] = useState(
    DEV_AUTH_PREFILL?.password ?? '',
  );
  const [loading, setLoading] = useState(false);

  // Beta cohort from `?beta=<code>`. Captured to localStorage on first render so
  // it survives the Google OAuth round-trip; AuthProvider redeems it at
  // provisioning time. Reading it here is purely to describe the offer.
  const betaCode = useMemo(() => captureBetaCode(), []);
  const betaQuery = useQuery({
    ...trpc.beta.versionByCode.queryOptions({ code: betaCode ?? '' }),
    enabled: !!betaCode,
    // A bad code is a non-event — no retries, no error surface. The form must
    // work identically whether or not the beta lookup resolves.
    retry: false,
  });
  const beta = betaQuery.data?.joinable ? betaQuery.data : null;

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    // Confirm-password match — validated both inline (the field error) and here on submit.
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      // Server creates a login-ready account and sends OUR branded verification
      // email via SMTP (auth.signUp). Names ride in user_metadata for first
      // authed load. "Login now, verify later" — we sign in immediately so the
      // user lands in the app; a banner nudges them to verify via the link.
      await signUp.mutateAsync({ email, password, firstName, lastName });
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } catch (err) {
      setLoading(false);
      toast.error(
        err instanceof Error ? err.message : 'Could not create account',
      );
      return;
    }
    // Session established — App routes on to role-selection / dashboard.
    setLoading(false);
    setLocation('/');
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Mirror login: return to the current origin so prod/white-label users
      // aren't bounced to the dashboard "Site URL", and useSubdomainRedirect
      // can hand off after the OAuth round-trip.
      options: { redirectTo: window.location.origin },
    });
    if (error) toastError(error);
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your"
      titleAccent="account"
      subtitle={`Start building on ${(CLIENT_AUTH_BRANDING[PRODESK_CLIENT] ?? CLIENT_AUTH_BRANDING.prodesk).wordmark} — it only takes a minute.`}
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        {/* Beta invitation — shown only for a code that is genuinely joinable, so
            we never promise free access a signup won't actually receive. */}
        {beta && (
          <div className="flex gap-3 rounded-lg border border-accent/30 bg-accent/8 p-4">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-ink-100">
                {beta.label ?? `Beta ${beta.code}`} invitation
              </p>
              <p className="text-xs leading-relaxed text-ink-60">
                {beta.description ??
                  'Your account gets the full Prodesk Suite free while the beta runs — every tool unlocked, nothing to pay.'}
              </p>
              <p className="text-xs font-medium text-ink-80">
                Free for {beta.durationDays} days from today. We'll email you
                the pricing before it ends — no card needed to start.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <AuthField label="First name" htmlFor="first">
            <IconInput
              id="first"
              icon={User}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              placeholder="John"
              autoComplete="given-name"
            />
          </AuthField>
          <AuthField label="Last name" htmlFor="last">
            <IconInput
              id="last"
              icon={User}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              placeholder="Doe"
              autoComplete="family-name"
            />
          </AuthField>
        </div>

        <AuthField label="Email" htmlFor="email">
          <IconInput
            id="email"
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@company.com"
            autoComplete="email"
          />
        </AuthField>

        <AuthField label="Password" htmlFor="password">
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </AuthField>

        <AuthField
          label="Confirm password"
          htmlFor="confirm"
          error={mismatch ? 'Passwords do not match' : null}
        >
          <PasswordInput
            id="confirm"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </AuthField>

        <Button
          type="submit"
          variant="accent"
          size="lg"
          className="mt-1 w-full"
          disabled={loading || mismatch}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </Button>

        <OrDivider />

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={handleGoogle}
        >
          <GoogleMark /> Continue with Google
        </Button>
      </form>
    </AuthShell>
  );
}
