import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { SectionCard } from './components';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function PushNotificationsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const settings = useQuery(trpc.superAdmin.getSettings.queryOptions());

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && settings.data) {
      setEmails([...(settings.data.adminForwardingEmails ?? [])]);
      setInitialized(true);
    }
  }, [settings.data, initialized]);

  const save = useMutation({
    ...trpc.superAdmin.updateSettings.mutationOptions(),
    onSuccess: () => {
      toast.success('Forwarding addresses saved!');
      qc.invalidateQueries({ queryKey: trpc.superAdmin.getSettings.queryKey() });
    },
    onError: (e) => toastError(e),
  });

  function addEmail() {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!isEmail(v)) { toast.error('Enter a valid email address.'); return; }
    if (emails.includes(v)) { toast.error('That address is already in the list.'); return; }
    setEmails((prev) => [...prev, v]);
    setDraft('');
  }
  function removeEmail(i: number) {
    setEmails((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <PageHeader
        title="Push Notifications"
        description="Any email destined for a super-admin is redirected to these addresses instead."
      />
      {settings.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-8">
          <SectionCard
            icon={<Bell className="h-5 w-5" />}
            title="Admin Email Forwarding"
            description="When a system email would be sent to a super-admin user, it is delivered to every address below instead. Leave empty to send to super-admins normally."
          >
            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="admin@example.com"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEmail())}
              />
              <Button variant="outline" onClick={addEmail}><Plus className="h-4 w-4" /> Add</Button>
            </div>

            {emails.length === 0 ? (
              <p className="mt-4 py-6 text-center text-sm text-ink-40">No forwarding addresses configured</p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {emails.map((email, i) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border-default)] px-3 py-1 text-sm text-ink-80"
                  >
                    {email}
                    <button type="button" className="text-ink-40 hover:text-danger" onClick={() => removeEmail(i)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          <Button
            className="w-full"
            variant="accent"
            disabled={save.isPending}
            onClick={() => save.mutate({ adminForwardingEmails: emails })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
