import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Moon, Sun, SunMoon } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { Avatar, GhostButton, Spec } from '../components/primitives';
import { setGround, storedGround, type Ground } from '../lib/ground';
import { desktopEnabled, desktopPermission, setDesktopEnabled } from '../lib/notify';
import { useChatInvalidate } from '../app/use-invalidate';

/**
 * Settings — four short sections, no tabs.
 *
 * Appearance first, because it is the one people change on day one and the one
 * this app is opinionated about. Privacy second, because email discoverability is
 * the feature that makes this messenger work AND the one people are entitled to
 * turn off — so the toggle says in plain words exactly what it changes, and the
 * server makes turning it off indistinguishable from having no account at all.
 */

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
        <p className="mt-1.5 max-w-md text-sm" style={{ color: 'var(--voice-2)' }}>
          {hint}
        </p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  busy,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  /** In flight — shows a spinner. */
  busy?: boolean;
  /** Not available at all (no browser support, permission denied). No spinner:
   *  a spinner promises something is happening, and nothing is. */
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={busy || disabled}
        onClick={() => onChange(!checked)}
        className="press relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
        style={{ background: checked ? 'var(--live)' : 'var(--room-3)' }}
      >
        <span
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: checked ? 19 : 3 }}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium" style={{ color: 'var(--voice)' }}>
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-[13px]" style={{ color: 'var(--voice-2)' }}>
            {hint}
          </span>
        )}
      </span>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--voice-3)' }} />}
    </label>
  );
}

export function SettingsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const invalidate = useChatInvalidate();
  const [ground, setGroundState] = useState<Ground>(() => storedGround());
  const [desktop, setDesktop] = useState(() => desktopEnabled());
  const permission = desktopPermission();

  const discovery = useQuery(trpc.chat.discoverySettings.queryOptions());
  const blocked = useQuery(trpc.chat.listBlocked.queryOptions());
  const unblock = useMutation(trpc.chat.unblockUser.mutationOptions());

  /**
   * Privacy flips on the click, not on the response.
   *
   * A switch that waits for a round trip before it moves is a switch people press
   * twice — and pressing this one twice is asking to be unlisted and then listed
   * again. The cache is written first and rolled back if the server refuses.
   */
  const discoveryKey = trpc.chat.discoverySettings.queryKey();
  const setDiscoverable = useMutation(
    trpc.chat.setDiscoverable.mutationOptions({
      // async, not sync: TContext is inferred from `Promise<T> | T`, and a sync
      // return pins it to `undefined` so the rollback stops compiling.
      onMutate: async ({ discoverable }) => {
        const previous = qc.getQueryData(discoveryKey);
        qc.setQueryData(discoveryKey, (old) =>
          old ? { ...old, discoverableByEmail: discoverable } : old,
        );
        return { previous };
      },
      onError: (e, _vars, ctx) => {
        qc.setQueryData(discoveryKey, ctx?.previous);
        toastError(e);
      },
      onSuccess: (_res, { discoverable }) => {
        toast.success(discoverable ? 'People can find you' : 'You’re unlisted');
      },
      onSettled: () => void qc.invalidateQueries(trpc.chat.discoverySettings.pathFilter()),
    }),
  );

  const grounds: { key: Ground; label: string; icon: typeof Moon }[] = [
    { key: 'night', label: 'Night', icon: Moon },
    { key: 'day', label: 'Day', icon: Sun },
    { key: 'system', label: 'Match system', icon: SunMoon },
  ];

  return (
    <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-20 pt-8">
        <header className="mb-3">
          <Spec>Settings</Spec>
          <h1
            className="mt-1.5 text-[26px] font-bold tracking-tight"
            style={{ color: 'var(--voice)' }}
          >
            How chat behaves
          </h1>
        </header>

        <Section
          title="Appearance"
          hint="Chat is dark by default — most messages get read in a dark room. This is a device setting, not an account one."
        >
          <div className="flex flex-wrap gap-2">
            {grounds.map((g) => {
              const active = ground === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => {
                    setGround(g.key);
                    setGroundState(g.key);
                  }}
                  className="press inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors"
                  style={{
                    background: active ? 'var(--live-soft)' : 'transparent',
                    border: `1px solid ${active ? 'var(--live)' : 'var(--wire-2)'}`,
                    color: active ? 'var(--voice)' : 'var(--voice-2)',
                  }}
                >
                  <g.icon className="h-3.5 w-3.5" />
                  {g.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          title="Privacy"
          hint="Turning this off is indistinguishable from having no account: anyone who searches your address is told the same thing either way."
        >
          <Toggle
            label="Let people find me by my email address"
            hint="Someone who types your exact address can start a conversation. Partial searches never work, for anyone."
            checked={discovery.data?.discoverableByEmail ?? true}
            busy={discovery.isLoading}
            onChange={(next) => setDiscoverable.mutate({ discoverable: next })}
          />
        </Section>

        <Section title="Blocked" hint="They can’t message you or find you by email address.">
          {blocked.isLoading ? (
            <Spec>Loading…</Spec>
          ) : (blocked.data ?? []).length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--voice-2)' }}>
              You haven’t blocked anyone.
            </p>
          ) : (
            <ul>
              {(blocked.data ?? []).map((b) => (
                <li
                  key={b.userId}
                  className="flex items-center gap-3 py-2.5"
                  style={{ borderBottom: '1px solid var(--wire)' }}
                >
                  <Avatar name={b.name} url={b.avatarUrl} size={30} />
                  <span
                    className="min-w-0 flex-1 truncate text-[13.5px]"
                    style={{ color: 'var(--voice)' }}
                  >
                    {b.name}
                  </span>
                  <GhostButton
                    disabled={unblock.isPending}
                    onClick={() =>
                      unblock.mutate(
                        { userId: b.userId },
                        {
                          onSuccess: () => {
                            invalidate.afterBlockChange();
                            toast.success('Unblocked');
                          },
                          onError: (e) => toastError(e),
                        },
                      )
                    }
                  >
                    Unblock
                  </GhostButton>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Notifications"
          hint="Email digests are grouped and only sent when you’ve been away. Muted and archived conversations never email you; a message request is only ever counted, never quoted."
        >
          <Toggle
            label="Desktop notifications"
            hint={
              permission === 'unsupported'
                ? 'This browser doesn’t support them.'
                : permission === 'denied'
                  ? 'Blocked for this site — allow notifications in your browser’s site settings first.'
                  : 'Only when Chat isn’t the tab you’re looking at. This device only.'
            }
            checked={desktop}
            disabled={permission === 'unsupported' || permission === 'denied'}
            onChange={(next) => {
              void setDesktopEnabled(next).then((live) => {
                setDesktop(live);
                if (next && !live) {
                  toast.error('Your browser didn’t allow notifications.');
                }
              });
            }}
          />
          <p className="mt-3 text-sm" style={{ color: 'var(--voice-2)' }}>
            Mute a single conversation from its ⋯ menu — 30 minutes through to
            until you turn it back on. Archiving silences one too.
          </p>
        </Section>
      </div>
    </div>
  );
}
