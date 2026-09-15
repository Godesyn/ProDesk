import { useEffect } from 'react';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser, signOut } from '../auth/auth-context';
import { useTRPC } from '../lib/trpc';
import { Button } from '../components/ui/button';
import { useConfirm } from '../components/ui/confirm-dialog';
import { AuthShell } from '../auth/auth-shell';

/**
 * Blocking "verify your email" gate. The user is signed in (session exists), but
 * App renders this instead of the app while their app-level verification is
 * pending (auth.me → isEmailVerified === false). Clicking our link on ANY device
 * flips the flag server-side (/auth/confirm → auth.markEmailVerified); this
 * screen polls auth.me so it advances on its own once that happens — no reliance
 * on a shared browser session.
 */
export function VerifyEmailPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const resend = useMutation(trpc.auth.resendConfirmation.mutationOptions());
  const confirm = useConfirm();
  const email = user?.email ?? '';

  const handleSignOut = async () => {
    if (await confirm({
      title: 'Sign out?',
      description: 'You’ll need to log in again to get back in.',
      confirmLabel: 'Sign out',
      destructive: true,
    })) void signOut();
  };

  // Re-fetch server truth every few seconds; when isEmailVerified turns true,
  // App drops this gate automatically.
  useEffect(() => {
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    }, 3000);
    return () => clearInterval(id);
  }, [qc, trpc]);

  async function recheck() {
    await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    const fresh = qc.getQueryData(trpc.auth.me.queryKey()) as { isEmailVerified?: boolean } | undefined;
    if (!fresh?.isEmailVerified) {
      toast.message('Not verified yet — click the link in your email, then try again.');
    }
  }

  async function handleResend() {
    if (!email) {
      toast.error('No email on file — please sign in again.');
      return;
    }
    try {
      await resend.mutateAsync({ email });
      toast.success('Verification email sent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend email');
    }
  }

  return (
    <AuthShell
      eyebrow="One last step"
      title="Verify your"
      titleAccent="email"
      subtitle={
        <>
          We sent a verification link{email ? <> to <span className="font-medium text-ink-100">{email}</span></> : ''}. Click it to unlock your account — this page continues automatically.
        </>
      }
      footer={
        <button onClick={() => void handleSignOut()} disabled={resend.isPending} className="font-medium text-ink-60 transition-colors hover:text-accent">
          Sign out
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-4 shadow-1">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/12 ring-1 ring-accent/20">
            <MailCheck className="h-5 w-5 text-accent" />
          </span>
          <p className="text-sm text-ink-60">Waiting for confirmation — keep this tab open.</p>
        </div>
        <Button variant="accent" size="lg" className="w-full" onClick={recheck} disabled={resend.isPending}>
          I have verified my email
        </Button>
        <Button variant="outline" size="lg" className="w-full" onClick={handleResend} disabled={resend.isPending}>
          Resend verification email
        </Button>
      </div>
    </AuthShell>
  );
}
