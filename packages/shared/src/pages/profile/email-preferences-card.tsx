import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

type Channel = 'task' | 'chat';

const CHANNELS: { channel: Channel; label: string; desc: string }[] = [
  {
    channel: 'task',
    label: 'Task emails',
    desc: 'Assignments, comments, and status changes on your tasks.',
  },
  {
    channel: 'chat',
    label: 'Chat emails',
    desc: 'Notifications for new chat messages while you are away.',
  },
];

/** A small accessible on/off pill toggle (no Switch primitive exists in ui/). */
function Toggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-accent' : 'bg-inset border border-border-default'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

/**
 * Email notification preferences (Flutter GlobalMailingToggle +
 * emailPreferencesRepository). A channel toggled OFF means the user is
 * unsubscribed from that channel's transactional email. Backed by the
 * emailUnsubscribes table via users.toggleUnsubscribeChannel.
 */
export function EmailPreferencesCard() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const key = trpc.users.unsubscribedChannels.queryKey();
  const { data } = useQuery(trpc.users.unsubscribedChannels.queryOptions());
  const unsubscribed = new Set((data?.channels ?? []) as Channel[]);

  const toggle = useMutation({
    ...trpc.users.toggleUnsubscribeChannel.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: () => toast.error('Failed to update preferences'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Notifications</CardTitle>
        <CardDescription>
          Choose which emails you'd like to receive from Prodesk.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {CHANNELS.map(({ channel, label, desc }) => {
          const enabled = !unsubscribed.has(channel);
          return (
            <div
              key={channel}
              // On mobile: label + toggle stay on row 1; the description drops below
              // full-width (max-md:order-last + w-full). On desktop it stays nested
              // under the label. flex-wrap lets the mobile row break.
              className="flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-inset text-ink-60">
                  <Mail className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-medium text-ink-100">
                    {label}
                  </div>
                  <div className="text-sm text-ink-60 max-md:hidden">{desc}</div>
                </div>
              </div>
              <Toggle
                on={enabled}
                disabled={toggle.isPending}
                // unsubscribe = the new state is OFF.
                onChange={(next) =>
                  toggle.mutate({ channel, unsubscribe: !next })
                }
              />
              {/* Mobile-only full-width description row. */}
              <div className="w-full text-sm text-ink-60 md:hidden max-md:order-last">{desc}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
