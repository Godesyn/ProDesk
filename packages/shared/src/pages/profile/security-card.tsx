import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useTRPC } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';

/**
 * Security card + change-password dialog — ports `ProfileSecurityCard` and the
 * reauthenticate-then-update flow (`profile_controller.updatePassword`). The
 * current password is verified via a fresh Supabase sign-in before the new
 * password is set server-side.
 */
export function SecurityCard({ email }: { email: string }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const changePassword = useMutation(trpc.users.changePassword.mutationOptions());

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  async function submit() {
    if (next.length < 8) return toast.error('New password must be at least 8 characters');
    if (next !== confirm) return toast.error('Passwords do not match');
    setBusy(true);
    try {
      // Reauthenticate: verify the current password.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (signInError) throw new Error('Current password is incorrect');
      await changePassword.mutateAsync({ newPassword: next });
      toast.success('Password updated');
      setOpen(false);
      reset();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Security</CardTitle></CardHeader>
      <CardContent>
        {/* On mobile: title + action stay on row 1; the description drops below
            full-width (max-md:order-last + w-full). On desktop it stays nested
            under the title. flex-wrap lets the mobile row break. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-inset text-ink-60"><KeyRound className="h-5 w-5" /></span>
            <div>
              <div className="text-sm font-medium text-ink-100">Password</div>
              <div className="text-sm text-ink-60 max-md:hidden">Update your account password</div>
            </div>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>Update</Button>
          {/* Mobile-only full-width description row. */}
          <div className="w-full text-sm text-ink-60 md:hidden max-md:order-last">Update your account password</div>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Enter your current password, then choose a new one.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5"><Label htmlFor="cur">Current password</Label><Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="new">New password</Label><Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="conf">Confirm new password</Label><Input id="conf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="accent" disabled={busy} onClick={submit}>{busy ? 'Updating…' : 'Update password'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
