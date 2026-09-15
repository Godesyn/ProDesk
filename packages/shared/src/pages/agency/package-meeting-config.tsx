import { useState } from 'react';
import { Pencil, Plus, Trash2, Users, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { initialsOf } from '../../lib/utils';
import { StaffConfigDialog, type ServiceStaff } from '../../components/service-form';

export interface MeetingMember {
  id: string;
  name: string;
  email?: string;
  profileUrl?: string | null;
  /** Agency-default sales commission (%) — seeds a newly-added member. */
  salesPersonCommission?: number;
}

/**
 * Assigned-sales-staff editor for the package's "Book Meeting" flow — a 1:1 port
 * of `PackageMeetingConfigSection`. Each assigned member carries a sales
 * commission (%) and an availability config (working days + hours). Adding a
 * member first picks from the unassigned staff, then configures availability.
 */
export function PackageMeetingConfigSection({
  members,
  assignedStaff,
  commissions,
  commissionError,
  onAddStaff,
  onEditStaff,
  onRemoveStaff,
  onCommissionChange,
}: {
  members: MeetingMember[];
  assignedStaff: ServiceStaff[];
  commissions: Record<string, string>;
  /** Inline commission error per staff (only passed after a failed submit). */
  commissionError?: (userId: string) => string | null;
  onAddStaff: (config: ServiceStaff) => void;
  onEditStaff: (index: number, config: ServiceStaff) => void;
  onRemoveStaff: (index: number) => void;
  onCommissionChange: (userId: string, value: string) => void;
}) {
  // null = closed; { mode: 'add', member } picks then configures; { mode: 'edit' } reconfigures.
  const [picking, setPicking] = useState(false);
  const [configuring, setConfiguring] = useState<
    | { mode: 'add'; member: MeetingMember }
    | { mode: 'edit'; index: number; staff: ServiceStaff }
    | null
  >(null);

  const assignedIds = new Set(assignedStaff.map((s) => s.userId));
  const available = members.filter((m) => !assignedIds.has(m.id));

  function openAdd() {
    if (available.length === 0) return void toast.warning('No available staff to add');
    setPicking(true);
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[6px] bg-inset text-ink-100">
            <Users className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-ink-100">Assigned Sales Staff</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" /> Add Staff
        </Button>
      </div>

      <div className="mt-4">
        {assignedStaff.length === 0 ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-warn bg-inset px-3 py-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
            <span className="text-[13px] font-semibold text-warn">No staff assigned. Booking will not be available.</span>
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--color-border-hairline)]">
            {assignedStaff.map((staff, index) => {
              const days = staff.workingDays?.length ?? 0;
              const commErr = commissionError?.(staff.userId) ?? null;
              const memberData = members.find((m) => m.id === staff.userId);
              return (
                <div key={staff.userId} className="flex items-center gap-3 py-2.5">
                  <Avatar className="h-9 w-9 shrink-0">
                    {memberData?.profileUrl && <AvatarImage src={memberData.profileUrl} />}
                    {staff.name && <AvatarFallback>{initialsOf(staff.name)}</AvatarFallback>}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink-100">{staff.name ?? 'Unknown Staff'}</div>
                    <div className="truncate text-xs text-ink-60">
                      {days} days • {staff.startTime ?? '09:00'} - {staff.endTime ?? '17:00'}
                    </div>
                  </div>
                  <div className="w-[88px] shrink-0">
                    <label className="block">
                      <span className="mb-0.5 block text-[10px] text-ink-40">Comm(%)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={commissions[staff.userId] ?? '0'}
                        onChange={(e) => onCommissionChange(staff.userId, e.target.value)}
                        className={`h-9 w-full rounded-[var(--radius-sm)] border bg-card px-2 text-sm text-ink-100 outline-none focus:ring-2 focus:ring-[color:var(--color-accent-ring)] ${commErr ? 'border-danger' : 'border-[color:var(--color-border-default)]'}`}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfiguring({ mode: 'edit', index, staff })}
                    className="grid h-8 w-8 place-items-center rounded-full text-ink-80 hover:bg-inset"
                    aria-label="Edit availability"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveStaff(index)}
                    className="grid h-8 w-8 place-items-center rounded-full text-danger hover:bg-inset"
                    aria-label="Remove staff"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 1 — pick an unassigned staff member. */}
      <Dialog open={picking} onOpenChange={(o) => !o && setPicking(false)}>
        <DialogContent className="max-w-[460px] gap-0 p-0">
          <div className="border-b border-[color:var(--color-border-hairline)] px-6 py-4">
            <h2 className="text-lg font-bold text-ink-100">Select Staff</h2>
          </div>
          <div className="max-h-[480px] overflow-y-auto p-2">
            {available.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setPicking(false);
                  setConfiguring({ mode: 'add', member: m });
                }}
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left hover:bg-inset"
              >
                <Avatar className="h-9 w-9 shrink-0">
                  {m.profileUrl && <AvatarImage src={m.profileUrl} />}
                  <AvatarFallback>{initialsOf(m.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink-100">{m.name}</div>
                  {m.email && <div className="truncate text-xs text-ink-60">{m.email}</div>}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Step 2 — configure availability (add) / reconfigure (edit). */}
      {configuring && (
        <StaffConfigDialog
          open
          staffUserId={configuring.mode === 'add' ? configuring.member.id : configuring.staff.userId}
          staffName={configuring.mode === 'add' ? configuring.member.name : configuring.staff.name}
          initialConfig={configuring.mode === 'edit' ? configuring.staff : undefined}
          onClose={() => setConfiguring(null)}
          onSave={(config) => {
            if (configuring.mode === 'add') onAddStaff(config);
            else onEditStaff(configuring.index, config);
            setConfiguring(null);
          }}
        />
      )}
    </div>
  );
}
