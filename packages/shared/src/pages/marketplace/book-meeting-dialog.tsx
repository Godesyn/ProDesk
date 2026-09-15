import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Check } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import type { MarketplaceService } from './types';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Slot { date: string; startTime: string; endTime: string; isoStart: string; assigneeUserId?: string; assigneeName?: string }

/**
 * Book a 30-min meeting for a service: lists available slots (working hours ∩
 * each assigned staff member's Google freebusy) and creates the meeting +
 * Calendar/Meet event. Ports BookMeetingDialog.
 */
export function BookMeetingDialog({ service, open, onOpenChange }: { service: MarketplaceService; open: boolean; onOpenChange: (v: boolean) => void }) {
  const trpc = useTRPC();
  const { brandId } = useActiveContext();
  const [picked, setPicked] = useState<Slot | null>(null);
  const [booked, setBooked] = useState<{ meetUrl: string | null } | null>(null);

  const startDate = ymd(new Date());
  const endDate = ymd(new Date(Date.now() + 14 * 86_400_000));
  const slots = useQuery({
    ...trpc.meetings.availableSlots.queryOptions({ serviceId: service.id, startDate, endDate }),
    enabled: open,
  });

  const create = useMutation({
    ...trpc.meetings.create.mutationOptions(),
    onSuccess: (m) => { setBooked({ meetUrl: m.meetUrl ?? null }); toast.success('Meeting booked'); },
    onError: (e) => toastError(e),
  });

  const book = () => {
    if (!picked || !brandId) return;
    const start = new Date(picked.isoStart);
    const end = new Date(`${picked.date}T${picked.endTime}:00`);
    create.mutate({
      serviceId: service.id,
      agencyId: service.agencyId,
      brandId,
      assigneeUserId: picked.assigneeUserId ?? '',
      startTime: start,
      endTime: end,
      serviceName: service.name,
    });
  };

  const list = (slots.data?.slots ?? []) as Slot[];
  const byDate = list.reduce<Record<string, Slot[]>>((acc, s) => ((acc[s.date] ??= []).push(s), acc), {});

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setPicked(null); setBooked(null); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" /> Book a meeting</DialogTitle>
          <DialogDescription>{service.name} · 30 minutes</DialogDescription>
        </DialogHeader>

        {booked ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success"><Check className="h-6 w-6" /></span>
            <div className="font-medium text-ink-100">You're booked!</div>
            {booked.meetUrl && <a href={booked.meetUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Join Google Meet</a>}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : slots.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-60">No available slots in the next two weeks. The agency may not have a calendar-linked team member for this service.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {Object.entries(byDate).map(([date, daySlots]) => (
              <div key={date}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-40">
                  {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((s) => (
                    <button
                      key={s.isoStart + (s.assigneeUserId ?? '')}
                      onClick={() => setPicked(s)}
                      className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm ${picked?.isoStart === s.isoStart ? 'border-accent bg-accent/10 text-ink-100' : 'border-[color:var(--color-border-default)] text-ink-80 hover:bg-inset'}`}
                    >
                      {s.startTime}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Button variant="accent" disabled={!picked || !brandId || create.isPending} onClick={book}>
              {create.isPending ? 'Booking…' : picked ? `Book ${picked.date} at ${picked.startTime}` : 'Select a time'}
            </Button>
            {!brandId && <p className="text-center text-xs text-ink-40">Switch to a brand workspace to book.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
