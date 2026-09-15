import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Loader2, Mail, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { Avatar, GhostButton, LiveButton, Spec } from '../primitives';
import { useChatInvalidate } from '../../app/use-invalidate';
import { threadPath } from '../../app/routes';

/**
 * Turn an email address into a conversation.
 *
 * Lives on its own rather than inside NewChatDialog because it now has two
 * homes: the dialog, and the inbox list when a search matches nothing. Those are
 * the same job — "the person you want isn't here yet" — and duplicating the
 * lookup would mean duplicating the three rules below, which is exactly the kind
 * of thing that gets half-updated later.
 *
 * The design constraint that shapes every state: this control is the only way to
 * ask "does this address have a Prodesk account?", so it must never become an
 * enumeration tool. Three server rules make that true, and this component's job
 * is not to leak what they protect:
 *
 *   1. EXACT match only — no as-you-type probing, no partial search. The lookup
 *      fires on Enter, on the ＋ button, or on blur with a valid address, and
 *      never on a keystroke.
 *   2. "no account", "opted out" and "they blocked you" return the IDENTICAL
 *      response, so this has exactly ONE negative state and cannot accidentally
 *      distinguish them.
 *   3. Rate limited per user AND per IP, failing closed.
 */

type Found = { id: string; name: string; avatarUrl: string | null };

export function PersonFinder({
  initialEmail = '',
  autoFocus = true,
  compact = false,
  secondaryAction,
  onStarted,
  onIsGroupChange,
}: {
  /** Seeded from the inbox search box when it already looks like an address. */
  initialEmail?: string;
  autoFocus?: boolean;
  /** Inline (in the thread list) drops the chrome the dialog supplies. */
  compact?: boolean;
  /** e.g. the dialog's Cancel button, rendered beside the primary action. */
  secondaryAction?: ReactNode;
  onStarted?: (threadId: string) => void;
  /** Fires when the finder crosses into group territory (two or more people). */
  onIsGroupChange?: (isGroup: boolean) => void;
}) {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const invalidate = useChatInvalidate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState(initialEmail);
  // Whether the user has typed into THIS field. Until they have, it mirrors
  // whatever the host is seeding it with (the inbox's search box, once that looks
  // like an address) — so typing an email into the list search carries straight
  // through instead of having to be retyped once the finder appears.
  const touched = useRef(false);
  const [chips, setChips] = useState<Found[]>([]);
  const [groupName, setGroupName] = useState('');
  const [notFound, setNotFound] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);

  const discover = useMutation(trpc.chat.discoverByEmail.mutationOptions());
  const invite = useMutation(trpc.chat.inviteByEmail.mutationOptions());
  const createDirect = useMutation(trpc.chat.createDirect.mutationOptions());
  const createGroup = useMutation(trpc.chat.createGroup.mutationOptions());

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    if (!touched.current) setEmail(initialEmail);
  }, [initialEmail]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isGroup = chips.length >= 2;
  const busy = createDirect.isPending || createGroup.isPending;

  useEffect(() => {
    onIsGroupChange?.(isGroup);
    // The callback is a render-time arrow at every call site; depending on it
    // would fire this on every keystroke instead of on the transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup]);

  const lookup = () => {
    const value = email.trim().toLowerCase();
    if (!valid || discover.isPending) return;
    setNotFound(null);
    setInvited(false);
    discover.mutate(
      { email: value },
      {
        onSuccess: (res) => {
          if (!res.found) {
            setNotFound(value);
            return;
          }
          if (chips.some((c) => c.id === res.user.id)) {
            setEmail('');
            return;
          }
          setChips((prev) => [...prev, res.user]);
          setEmail('');
        },
        onError: (e) => toastError(e),
      },
    );
  };

  const opened = ({ threadId }: { threadId: string }) => {
    invalidate.afterThreadChange();
    onStarted?.(threadId);
    navigate(threadPath(threadId));
  };

  const start = () => {
    if (chips.length === 0) return;
    if (isGroup) {
      createGroup.mutate(
        { name: groupName.trim() || undefined, memberIds: chips.map((c) => c.id) },
        { onSuccess: opened, onError: (e) => toastError(e) },
      );
      return;
    }
    createDirect.mutate({ userId: chips[0].id }, { onSuccess: opened, onError: (e) => toastError(e) });
  };

  /** What Enter does, so the ＋ button can do exactly the same thing. */
  const commit = () => {
    if (valid) lookup();
    else if (chips.length) start();
  };

  return (
    <div>
      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5"
              style={{ background: 'var(--room-3)' }}
            >
              <Avatar name={c.name} url={c.avatarUrl} size={22} />
              <span className="text-[13px] font-medium" style={{ color: 'var(--voice)' }}>
                {c.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => setChips((prev) => prev.filter((x) => x.id !== c.id))}
              >
                <X className="h-3 w-3" style={{ color: 'var(--voice-3)' }} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            touched.current = true;
            setEmail(e.target.value);
            setNotFound(null);
            setInvited(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            // Backspace on an empty field removes the last chip — the token-input
            // convention people already have in their fingers from email clients.
            if (e.key === 'Backspace' && email === '' && chips.length) {
              setChips((prev) => prev.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (valid) lookup();
          }}
          placeholder="name@company.com"
          className="h-11 w-full pl-3 pr-11 text-sm outline-none"
          style={{
            background: 'var(--room-3)',
            border: '1px solid var(--wire)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--voice)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
          }}
        />
        {/*
          The ＋ is the same gesture as Enter, made visible. "Type an address and
          press Enter" is a rule you have to be told; a button at the end of the
          field is one you can see. It is armed on exactly the states Enter acts
          on, so the two can never disagree about whether there is anything to do.
        */}
        <button
          type="button"
          onClick={commit}
          disabled={(!valid && chips.length === 0) || discover.isPending}
          aria-label={valid ? 'Look up this address' : 'Start the conversation'}
          title={valid ? 'Look up this address' : 'Start the conversation'}
          className="press absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full transition-colors disabled:opacity-30"
          style={{
            background: valid || chips.length ? 'var(--live)' : 'var(--room-2)',
            color: valid || chips.length ? '#fff' : 'var(--voice-3)',
          }}
        >
          {discover.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className={compact ? 'mt-2.5' : 'mt-3 min-h-[52px]'}>
        {discover.isPending && (
          <span className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--voice-3)' }} />
            <Spec>Looking…</Spec>
          </span>
        )}

        {/* THE single negative state. "No account", "opted out of being found"
            and "they blocked you" all land here and are indistinguishable — an
            opt-out you can detect is not an opt-out. */}
        {notFound && !discover.isPending && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px]" style={{ color: 'var(--voice-2)' }}>
              No Prodesk account for that address.
            </p>
            {invited ? (
              <Spec style={{ color: 'var(--live)' }}>Invitation sent</Spec>
            ) : (
              <GhostButton
                onClick={() =>
                  invite.mutate(
                    { email: notFound },
                    {
                      onSuccess: () => {
                        setInvited(true);
                        toast.success('Invitation sent');
                      },
                      onError: (e) => toastError(e),
                    },
                  )
                }
                disabled={invite.isPending}
              >
                {invite.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                Invite them
              </GhostButton>
            )}
          </div>
        )}

        {isGroup && (
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (optional)"
            maxLength={80}
            className="mt-2 h-10 w-full px-3 text-sm outline-none"
            style={{
              background: 'var(--room-3)',
              border: '1px solid var(--wire)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--voice)',
            }}
          />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Spec>
          {chips.length === 0
            ? 'Enter to look up'
            : isGroup
              ? `${chips.length} people`
              : 'Enter to open'}
        </Spec>
        <div className="flex items-center gap-2">
          {secondaryAction}
          <LiveButton
            armed={chips.length > 0}
            disabled={chips.length === 0 || busy}
            onClick={start}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isGroup ? 'Start group' : 'Message'}
          </LiveButton>
        </div>
      </div>
    </div>
  );
}
