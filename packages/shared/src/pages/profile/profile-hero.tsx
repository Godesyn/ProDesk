import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { StorageBucket } from '../../lib/storage-buckets';
import { uploadFile } from '../../lib/storage';
import { useTRPC } from '../../lib/trpc';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar';
import { initialsOf } from '../../lib/utils';

interface HeroUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  profileUrl?: string | null;
}

const displayName = (u: HeroUser) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

/**
 * Profile hero — ports `ProfileHeroSection`: 120px avatar with a camera-button
 * overlay that picks a file, uploads to storage, and sets profileUrl. Display
 * name, email, and an "Active Member" pill.
 */
export function ProfileHero({ user, meKey }: { user: HeroUser; meKey: unknown }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const updateProfile = useMutation({
    ...trpc.users.updateProfile.mutationOptions(),
    onSuccess: () => {
      toast.success('Profile photo updated');
      qc.invalidateQueries({ queryKey: meKey as never });
    },
    onError: (e) => toastError(e),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const publicUrl = await uploadFile(StorageBucket.Uploads, `profiles/${user.id}`, file);
      await updateProfile.mutateAsync({ profileUrl: publicUrl });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="relative">
        <Avatar className="h-28 w-28">
          {user.profileUrl && <AvatarImage src={user.profileUrl} />}
          <AvatarFallback className="text-2xl">{initialsOf(displayName(user))}</AvatarFallback>
        </Avatar>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border-2 border-[color:var(--color-paper)] bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          title="Change photo"
        >
          <Camera className="h-4 w-4" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>
      <div>
        <div className="text-h3 text-ink-100">{displayName(user)}</div>
        <div className="text-sm text-ink-60">{user.email}</div>
      </div>
      <span className="rounded-full bg-success/12 px-3 py-1 text-xs font-medium text-success">Active Member</span>
    </div>
  );
}
