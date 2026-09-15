import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Check } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { openInNewTab } from '../../lib/redirect';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { useConfirm } from '../../components/ui/confirm-dialog';

/**
 * Google Calendar integration — ports `ProfileCalendarIntegrationCard`. Connect
 * runs the real Google OAuth consent redirect; the callback (?calendar_callback)
 * exchanges the code for tokens via `meetings.linkCalendar`.
 */
export function CalendarCard({ linked, meKey }: { linked: boolean; meKey: unknown }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const auth = useQuery(trpc.meetings.calendarAuthUrl.queryOptions({}));
  const refresh = () => qc.invalidateQueries({ queryKey: meKey as never });

  const link = useMutation({
    ...trpc.meetings.linkCalendar.mutationOptions(),
    onSuccess: () => { toast.success('Calendar linked'); refresh(); },
    onError: (e) => toastError(e),
  });
  const unlink = useMutation({
    ...trpc.meetings.unlinkCalendar.mutationOptions(),
    onSuccess: () => { toast.success('Calendar unlinked'); refresh(); },
    onError: (e) => toastError(e),
  });

  // Handle the OAuth redirect callback: ?calendar_callback=true&code=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar_callback') === 'true' && params.get('code')) {
      const code = params.get('code')!;
      link.mutate({ code });
      // Strip the OAuth params from the URL so a refresh doesn't re-run it.
      const url = new URL(window.location.href);
      ['calendar_callback', 'code', 'scope', 'authuser', 'prompt'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configured = auth.data?.configured ?? false;

  return (
    <Card>
      <CardHeader><CardTitle>Integrations</CardTitle></CardHeader>
      <CardContent>
        {/* On mobile: title (+Linked badge) and the action stay on row 1; the sync
            description drops below full-width (max-md:order-last + w-full). On desktop
            it stays nested under the title. flex-wrap lets the mobile row break. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-inset text-ink-60"><Calendar className="h-5 w-5" /></span>
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink-100">
                Google Calendar
                {linked && <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" /> Linked</span>}
              </div>
              <div className="text-sm text-ink-60 max-md:hidden">
                {configured ? 'Sync meeting bookings and availability with your calendar.' : 'Calendar integration is not configured in this environment.'}
              </div>
            </div>
          </div>
          {linked ? (
            <Button
              variant="outline"
              disabled={unlink.isPending}
              onClick={async () => {
                if (!(await confirm({
                  title: 'Unlink Google Calendar?',
                  description: 'Meeting bookings and availability will no longer sync with your calendar. You can reconnect at any time.',
                  confirmLabel: 'Unlink',
                  destructive: true,
                }))) return;
                unlink.mutate();
              }}
            >Unlink</Button>
          ) : (
            <Button
              variant="accent"
              disabled={!configured || link.isPending || !auth.data?.url}
              onClick={() => { if (auth.data?.url) openInNewTab(auth.data.url); }}
            >
              {link.isPending ? 'Linking…' : 'Connect'}
            </Button>
          )}
          {/* Mobile-only full-width description row. */}
          <div className="w-full text-sm text-ink-60 md:hidden max-md:order-last">
            {configured ? 'Sync meeting bookings and availability with your calendar.' : 'Calendar integration is not configured in this environment.'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
