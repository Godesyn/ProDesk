/**
 * NewBrandDialog — "New brand" for the frontends whose only create-brand flow was
 * a full-page onboarding (Websites, Logo Studio, SIGKITT, EziQuotes).
 *
 * The shared AppShell always offers "New brand" inside the brand dropdown, even
 * for single-brand users (that was the whole point: the old per-frontend switchers
 * rendered a dead label when you had one brand, so you could never make a second).
 * The frontends that already ship their own themed modal — Verdiict, Adeyy — keep
 * theirs; this is the neutral default for everyone else.
 *
 * One field on purpose: `brands.create` needs only a business name, and the new
 * brand becomes the selected context server-side, so the app is already scoped to
 * it once the queries refresh. Everything else is edited later in Settings.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function NewBrandDialog({
  open,
  onOpenChange,
  /** Ran after the brand exists and the cache has been refreshed. */
  onCreated,
  /** What a brand is in this app, e.g. "Each brand is its own Websites workspace." */
  blurb,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  blurb?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Business names are unique across the brand+agency namespace; check live so the
  // user isn't told only on submit. Debounced to avoid a query per keystroke.
  const debouncedName = useDebounced(businessName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName }),
    enabled: open && debouncedName.trim().length > 1,
  });
  const nameTaken = !!businessName.trim() && nameCheck.data && !nameCheck.data.available;

  // Reopening should be a clean form, not the last failed attempt.
  useEffect(() => {
    if (!open) {
      setBusinessName('');
      setError(null);
    }
  }, [open]);

  const create = useMutation({
    ...trpc.brands.create.mutationOptions(),
    onSuccess: async () => {
      // brands.create also switches the active context, so refresh both the list
      // and auth.me before handing back — then everything re-resolves scoped to
      // the new brand.
      await Promise.all([
        qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() }),
        qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
      ]);
      onOpenChange(false);
      onCreated?.();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create brand'),
  });

  const submit = () => {
    setError(null);
    const name = businessName.trim();
    if (!name) {
      setError('Brand name is required');
      return;
    }
    if (nameTaken) {
      setError(nameCheck.data?.reason ?? 'This business name is already taken');
      return;
    }
    create.mutate({ businessName: name });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
          <DialogDescription>
            {blurb ?? 'Each brand is its own workspace. You can refine it later in Settings.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label htmlFor="psp-new-brand" className="text-sm font-medium text-ink-80">
            Brand name
          </label>
          <div className="relative">
            <Input
              id="psp-new-brand"
              value={businessName}
              autoFocus
              placeholder="Acme Coffee"
              onChange={(e) => setBusinessName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !create.isPending) submit();
              }}
              aria-invalid={!!nameTaken || undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {nameCheck.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-ink-40" />
              ) : businessName.trim().length > 1 && !nameTaken && nameCheck.data ? (
                <Check className="h-4 w-4 text-[color:var(--color-success)]" />
              ) : null}
            </span>
          </div>
          {(error || nameTaken) && (
            <p className="text-xs text-[color:var(--color-danger)]">
              {nameTaken
                ? (nameCheck.data?.reason ?? 'This business name is already taken')
                : error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || !!nameTaken}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create brand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
