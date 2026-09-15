import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { toastError } from '../lib/errors';
import { Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
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

export function LoginPage() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const startMigratedReset = useMutation(
    trpc.auth.startMigratedReset.mutationOptions(),
  );
  const [email, setEmail] = useState(DEV_AUTH_PREFILL?.email ?? '');
  const [password, setPassword] = useState(DEV_AUTH_PREFILL?.password ?? '');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error) {
      setLoading(false);
      return; // session established — the app shell takes over.
    }
    // A failed password login may be a user migrated from Firebase Auth (no
    // password hash carried over). Ask the server: if so, it emails a one-time
    // code and we route them to set a new password; otherwise show the real error.
    try {
      const res = await startMigratedReset.mutateAsync({ email });
      if (res.migrated) {
        navigate(`/auth/reset-otp?email=${encodeURIComponent(email)}`);
        return;
      }
    } catch {
      /* fall through to the normal credentials error */
    } finally {
      setLoading(false);
    }
    toastError(error);
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Without this, Supabase falls back to its dashboard "Site URL" (set to
      // localhost for dev), so prod/white-label users get bounced to localhost.
      // Returning to the current origin also lets useSubdomainRedirect hand off.
      options: { redirectTo: window.location.origin },
    });
    if (error) toastError(error);
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to"
      titleAccent={(CLIENT_AUTH_BRANDING[PRODESK_CLIENT] ?? CLIENT_AUTH_BRANDING.prodesk).wordmark}
      subtitle="Pick up where you left off — your workspace is ready."
      footer={
        <>
          Don't have an account?{' '}
          <Link
            href="/signup"
            className="font-medium text-accent hover:underline"
          >
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
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
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </AuthField>

        <div className="-mt-1 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-ink-60 transition-colors hover:text-accent"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          variant="accent"
          size="lg"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Signing in…' : 'Sign in'}
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
