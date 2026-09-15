import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { uploadFile } from '@shared/lib/storage';
import { StorageBucket } from '@shared/lib/storage-buckets';
import { Avatar, GhostButton, LiveButton, Spec } from '../components/primitives';

/**
 * NATIVE account screen (`/profile`).
 *
 * The shared `@shared/pages/profile` page is styled for the main Prodesk app and
 * would read as a foreign document inside the room. What is shared is the DATA
 * layer only: `users.updateProfile`, `users.changePassword` and the storage
 * upload helper.
 *
 * It is deliberately short. Everything a messenger's user actually tunes —
 * appearance, notifications, discoverability, blocked people — lives in
 * `/settings`, because those are chat decisions. This screen is only the three
 * things that belong to the ACCOUNT: your face, your name, your password.
 *
 * Your face matters more here than anywhere else in the suite: it is the read
 * bead every person you talk to watches travel down the spine.
 */

const fieldStyle: React.CSSProperties = {
  background: 'var(--room-3)',
  border: '1px solid var(--wire)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--voice)',
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cx-card p-5">
      <Spec>{title}</Spec>
      {hint && (
        <p className="mt-1.5 text-sm" style={{ color: 'var(--voice-2)' }}>
          {hint}
        </p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Account() {
  const { data: user } = useCurrentUser();

  if (!user) {
    return (
      <div className="grid h-full place-items-center">
        <Spec>Loading…</Spec>
      </div>
    );
  }

  return (
    <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-20 pt-8">
        <header className="mb-3">
          <Spec>Account</Spec>
          <h1
            className="mt-1.5 text-[26px] font-bold tracking-tight"
            style={{ color: 'var(--voice)' }}
          >
            {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
          </h1>
        </header>

        <PhotoAndName user={user} />
        <PasswordSection />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ photo + name */

type AccountUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileUrl?: string | null;
};

function PhotoAndName({ user }: { user: AccountUser }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');

  useEffect(() => {
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
  }, [user.firstName, user.lastName]);

  const meKey = trpc.auth.me.queryKey();
  const updateProfile = useMutation({
    ...trpc.users.updateProfile.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meKey }),
    onError: (e) => toastError(e),
  });

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const dirty =
    firstName.trim() !== (user.firstName ?? '') || lastName.trim() !== (user.lastName ?? '');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const publicUrl = await uploadFile(StorageBucket.Uploads, `profiles/${user.id}`, file);
      await updateProfile.mutateAsync({ profileUrl: publicUrl });
      toast.success('Photo updated');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Section title="You" hint="This is the face that rides the spine in every conversation.">
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          <Avatar name={displayName} url={user.profileUrl} size={80} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Change photo"
            aria-label="Change photo"
            className="press absolute -bottom-0.5 -right-0.5 grid h-8 w-8 place-items-center rounded-full text-white disabled:opacity-60"
            style={{ background: 'var(--live)', border: '2px solid var(--room-2)' }}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPick(e)}
          />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold" style={{ color: 'var(--voice)' }}>
            {displayName}
          </p>
          <p className="text-sm" style={{ color: 'var(--voice-2)' }}>
            {user.email}
          </p>
          <Spec className="mt-2 block">JPG or PNG · square works best</Spec>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="acct-first" className="mb-1.5 block">
            <Spec>First name</Spec>
          </label>
          <input
            id="acct-first"
            className="h-10 w-full px-3 text-sm outline-none"
            style={fieldStyle}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="acct-last" className="mb-1.5 block">
            <Spec>Last name</Spec>
          </label>
          <input
            id="acct-last"
            className="h-10 w-full px-3 text-sm outline-none"
            style={fieldStyle}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {!dirty && !updateProfile.isPending && (
          <Spec>
            <Check className="mr-1 inline h-3 w-3" />
            Saved
          </Spec>
        )}
        <LiveButton
          armed={dirty}
          disabled={!dirty || updateProfile.isPending}
          onClick={() =>
            updateProfile.mutate(
              { firstName: firstName.trim(), lastName: lastName.trim() },
              { onSuccess: () => toast.success('Name updated') },
            )
          }
        >
          {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </LiveButton>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- password */

function PasswordSection() {
  const trpc = useTRPC();
  const [next, setNext] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const changePassword = useMutation(trpc.users.changePassword.mutationOptions());

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirmValue.length > 0 && next !== confirmValue;
  const canSave = next.length >= 8 && next === confirmValue && !changePassword.isPending;

  const submit = async () => {
    if (!canSave) return;
    try {
      await changePassword.mutateAsync({ newPassword: next });
      setNext('');
      setConfirmValue('');
      toast.success('Password changed');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Section title="Password" hint="At least eight characters. You stay signed in here.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="acct-pw" className="mb-1.5 block">
            <Spec>New password</Spec>
          </label>
          <input
            id="acct-pw"
            type="password"
            autoComplete="new-password"
            className="h-10 w-full px-3 text-sm outline-none"
            style={fieldStyle}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          {tooShort && (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>
              Eight characters minimum.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="acct-pw2" className="mb-1.5 block">
            <Spec>Confirm</Spec>
          </label>
          <input
            id="acct-pw2"
            type="password"
            autoComplete="new-password"
            className="h-10 w-full px-3 text-sm outline-none"
            style={fieldStyle}
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
          />
          {mismatch && (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>
              These don’t match.
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {(next || confirmValue) && (
          <GhostButton
            onClick={() => {
              setNext('');
              setConfirmValue('');
            }}
          >
            Cancel
          </GhostButton>
        )}
        <LiveButton armed={canSave} disabled={!canSave} onClick={() => void submit()}>
          {changePassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Change password
        </LiveButton>
      </div>
    </Section>
  );
}
