import { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Chip } from '../../pages/agency/form-bits';
import { type ServiceStaff } from './types';

/** ISO weekday → short label (ports the Flutter `_dayNames`, Mon-first). */
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Minutes since midnight for a "HH:mm" string (for the start < end check). */
function minutes(t: string): number {
  const [h, m] = t.split(':').map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Configure-availability modal — a 1:1 port of the Flutter `StaffConfigDialog`
 * (working days chips + start/end time). Returns a fully-configured
 * `ServiceStaff` via `onSave`. Service selection (the Flutter
 * `allowServiceSelection` branch) isn't used by the package flow, so it's
 * omitted here.
 */
export function StaffConfigDialog({
  open,
  staffName,
  staffUserId,
  initialConfig,
  onSave,
  onClose,
}: {
  open: boolean;
  staffName?: string;
  staffUserId: string;
  initialConfig?: ServiceStaff;
  onSave: (config: ServiceStaff) => void;
  onClose: () => void;
}) {
  const [workingDays, setWorkingDays] = useState<number[]>(initialConfig?.workingDays ?? [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(initialConfig?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(initialConfig?.endTime ?? '17:00');

  function toggleDay(day: number) {
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  function submit() {
    if (workingDays.length === 0) return void toast.error('Please select at least one working day');
    if (minutes(startTime) >= minutes(endTime)) return void toast.error('Start time must be before end time');
    onSave({
      userId: staffUserId,
      name: staffName,
      workingDays,
      startTime,
      endTime,
      timezone: 'Australia/Sydney',
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[500px] gap-0 p-0">
        {/* Header. */}
        <div className="flex items-start justify-between gap-4 p-6 pb-0">
          <div>
            <h2 className="text-xl font-bold text-ink-100">Configure Availability</h2>
            <p className="text-sm text-ink-60">{staffName ?? 'Staff Member'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-60 hover:bg-inset"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-6">
          <p className="mb-2 text-sm font-semibold text-ink-100">Working Days</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => (
              <Chip key={day} active={workingDays.includes(day)} onClick={() => toggleDay(day)}>
                {DAY_NAMES[day - 1]}
              </Chip>
            ))}
          </div>

          <div className="mt-6 flex gap-4">
            <TimeField label="Start Time" value={startTime} onChange={setStartTime} />
            <TimeField label="End Time" value={endTime} onChange={setEndTime} />
          </div>
        </div>

        {/* Footer. */}
        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--color-border-hairline)] px-6 py-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={submit}>Save Configuration</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1">
      <p className="mb-2 text-sm font-semibold text-ink-100">{label}</p>
      <div className="flex h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3">
        <Clock className="h-4 w-4 shrink-0 text-ink-40" />
        <input
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-full flex-1 bg-transparent text-sm text-ink-100 outline-none"
        />
      </div>
    </div>
  );
}
