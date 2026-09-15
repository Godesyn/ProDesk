import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useMutation } from '@tanstack/react-query';
import { Mail, MailCheck, Loader2, AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { Button } from '../components/ui/button';
import { AuthShell, AuthField, IconInput, PasswordInput } from '../auth/auth-shell';

/** /forgot-password — request a reset email via our SMTP (auth.requestPasswordReset). */
export function ForgotPasswordPage() {
  const trpc = useTRPC();
  const requestReset = useMutation(trpc.auth.requestPasswordReset.mutationOptions());
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Server always resolves success (doesn't leak whether the account exists).
      await requestReset.mutateAsync({ email });
      setSent(true);
      toast.success('Password reset email sent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset link');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your"
      titleAccent="password"
      subtitle={sent ? undefined : "Enter your email and we'll send you a secure reset link."}
      footer={<Link href="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}
    >
      {sent ? (
        <div className="flex flex-col items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-8 text-center shadow-1">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/12 ring-1 ring-accent/20">
            <MailCheck className="h-7 w-7 text-accent" />
          </span>
          <div>
            <p className="font-medium text-ink-100">Check your inbox</p>
            <p className="mt-1 text-sm text-ink-60">
              We sent a reset link to <span className="font-medium text-ink-100">{email}</span>.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AuthField label="Email" htmlFor="email">
            <IconInput id="email" icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
          </AuthField>
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

/** /auth/action — set a new password. The recovery link we email now carries a
 *  token_hash (our SMTP owns the link), so we redeem it with verifyOtp on mount
 *  to establish the recovery session BEFORE collecting the new password. */
export function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  // 'verifying' until the recovery token is redeemed; 'invalid' if the link is bad.
  const [phase, setPhase] = useState<'verifying' | 'ready' | 'invalid'>('verifying');

  const mismatch = confirm.length > 0 && password !== confirm;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = params.get('type') ?? 'recovery';
    // No token_hash → either an already-established session (legacy detectSessionInUrl)
    // or a stale link. Probe for a session; if present, allow the form.
    async function redeem() {
      if (!tokenHash) {
        const { data } = await supabase.auth.getSession();
        setPhase(data.session ? 'ready' : 'invalid');
        return;
      }
      const { error } = await supabase.auth.verifyOtp({
        type: type as 'recovery',
        token_hash: tokenHash,
      });
      setPhase(error ? 'invalid' : 'ready');
      if (error) toast.error('This reset link is invalid or has expired.');
    }
    redeem();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error('Passwords do not match');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toastError(error);
    toast.success('Password updated');
    navigate('/');
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Set a new"
      titleAccent="password"
      subtitle={
        phase === 'verifying' ? 'Verifying your reset link…'
          : phase === 'invalid' ? undefined
            : 'Choose a new password for your account.'
      }
      footer={phase !== 'invalid' ? <Link href="/login" className="font-medium text-accent hover:underline">Back to sign in</Link> : undefined}
    >
      {phase === 'verifying' && (
        <div className="flex items-center justify-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-8 text-sm text-ink-60 shadow-1">
          <Loader2 className="h-5 w-5 animate-spin text-accent" /> Verifying…
        </div>
      )}

      {phase === 'invalid' && (
        <div className="flex flex-col items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-8 text-center shadow-1">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-danger/10 ring-1 ring-danger/20">
            <AlertCircle className="h-7 w-7 text-danger" />
          </span>
          <p className="text-sm text-ink-60">This reset link is invalid or has expired.</p>
          <Button asChild variant="accent" size="lg" className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      )}

      {phase === 'ready' && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AuthField label="New password" htmlFor="password">
            <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="••••••••" autoComplete="new-password" />
          </AuthField>
          <AuthField label="Confirm password" htmlFor="confirm" error={mismatch ? 'Passwords do not match' : null}>
            <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} placeholder="••••••••" autoComplete="new-password" />
          </AuthField>
          <Button type="submit" variant="accent" size="lg" className="mt-1 w-full" disabled={loading || mismatch}>
            {loading ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * /auth/reset-otp — migrated-account recovery. A user brought over from Firebase
 * Auth has no usable password, so on a failed login the server emails them a
 * one-time code and routes them here. They enter the code (verifyOtp establishes
 * a recovery session), then set a new password (updateUser), and we clear the
 * server-side `requiresPasswordReset` flag.
 */
export function MigratedResetPage() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const startReset = useMutation(trpc.auth.startMigratedReset.mutationOptions());
  const verifyOtp = useMutation(trpc.auth.verifyMigratedOtp.mutationOptions());
  const completeReset = useMutation(trpc.auth.completeMigratedReset.mutationOptions());
  const email = new URLSearchParams(window.location.search).get('email') ?? '';

  const [phase, setPhase] = useState<'otp' | 'password'>('otp');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Fail fast on a bad code before showing the password step (the code is
      // re-checked server-side when the password is actually set).
      await verifyOtp.mutateAsync({ email, code: otp.trim() });
      setPhase('password');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That code is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error('Passwords do not match');
    setLoading(true);
    try {
      // Server verifies the code + sets the password via the admin API, then
      // clears the migrated flag. We then establish a session by signing in.
      await completeReset.mutateAsync({ email, code: otp.trim(), password });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Password was set; just send them to sign in manually as a fallback.
        toast.success('Password set — please sign in');
        navigate('/login');
        return;
      }
      toast.success('Password set — you’re all signed in');
      navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set your password');
      // A wrong/expired code at this point sends them back to re-enter it.
      if (err instanceof Error && /code/i.test(err.message)) setPhase('otp');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    try {
      await startReset.mutateAsync({ email });
      setOtp('');
      toast.success('A new code is on its way');
    } catch {
      toast.error('Could not resend the code');
    }
  }

  if (!email) {
    return (
      <AuthShell eyebrow="Account security" title="Something's" titleAccent="missing" footer={<Link href="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
        <div className="flex flex-col items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-8 text-center shadow-1">
          <AlertCircle className="h-7 w-7 text-danger" />
          <p className="text-sm text-ink-60">Start from the sign-in page so we know which account to recover.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account security"
      title={phase === 'otp' ? 'Enter your' : 'Set a new'}
      titleAccent={phase === 'otp' ? 'code' : 'password'}
      subtitle={
        phase === 'otp'
          ? 'For security purposes you’ll create a new password. Enter the code we just emailed you.'
          : 'Choose a new password for your account.'
      }
      footer={<Link href="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}
    >
      {phase === 'otp' ? (
        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-accent/8 px-4 py-3 text-sm text-ink-60">
            <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
            <span>We emailed a one-time code to <span className="font-medium text-ink-100">{email}</span>.</span>
          </div>
          <AuthField label="Verification code" htmlFor="otp">
            <IconInput
              id="otp"
              icon={KeyRound}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
              placeholder="1234"
            />
          </AuthField>
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={loading || otp.length !== 4}>
            {loading ? 'Verifying…' : 'Verify code'}
          </Button>
          <button type="button" onClick={handleResend} className="text-xs font-medium text-ink-60 transition-colors hover:text-accent">
            Didn’t get it? Resend code
          </button>
        </form>
      ) : (
        <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
          <AuthField label="New password" htmlFor="new-password">
            <PasswordInput id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="••••••••" autoComplete="new-password" />
          </AuthField>
          <AuthField label="Confirm password" htmlFor="confirm-password" error={mismatch ? 'Passwords do not match' : null}>
            <PasswordInput id="confirm-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} placeholder="••••••••" autoComplete="new-password" />
          </AuthField>
          <Button type="submit" variant="accent" size="lg" className="mt-1 w-full" disabled={loading || mismatch}>
            {loading ? 'Saving…' : 'Set password & continue'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
