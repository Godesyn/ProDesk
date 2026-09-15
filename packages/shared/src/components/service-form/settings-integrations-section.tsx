import { type ReactNode } from 'react';
import { ToggleRow, Chip } from '../../pages/agency/form-bits';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { initialsOf } from '../../lib/utils';
import { SectionHeader } from './section-header';
import { type ServiceStaff } from './types';

/**
 * Settings & Integrations toggles (ports `SettingsIntegrationsSection`). Toggle
 * order matches Flutter: Buy Now → Book Meeting → Sales Proposal → Visibility.
 *
 * When "Book Meeting" is on, a meeting-config block appears beneath it. Callers
 * may inject a custom block via `meetingConfig` (ports the Flutter
 * `meetingConfigWidget` slot — used by the package builder for its sales-staff
 * editor); otherwise the built-in assigned-staff multiselect is shown.
 */
export function SettingsIntegrationsSection({
  allowBuyNow,
  allowSalesProposal,
  allowBookMeeting,
  isActive,
  onAllowBuyNow,
  onAllowSalesProposal,
  onAllowBookMeeting,
  onIsActive,
  members,
  assignedStaff,
  onAssignedStaff,
  meetingConfig,
}: {
  allowBuyNow: boolean;
  allowSalesProposal: boolean;
  allowBookMeeting: boolean;
  isActive: boolean;
  onAllowBuyNow: (v: boolean) => void;
  onAllowSalesProposal: (v: boolean) => void;
  onAllowBookMeeting: (v: boolean) => void;
  onIsActive: (v: boolean) => void;
  members?: { id: string; name: string; profileUrl?: string | null }[];
  assignedStaff?: ServiceStaff[];
  onAssignedStaff?: (s: ServiceStaff[]) => void;
  /** Custom block rendered under the Book Meeting toggle (ports `meetingConfigWidget`). */
  meetingConfig?: ReactNode;
}) {
  return (
    <div>
      <SectionHeader title="Settings & Integrations" />
      <div className="flex flex-col gap-3">
        <ToggleRow label={'Enable "Buy Now"'} description="Allow instant checkout via Stripe" checked={allowBuyNow} onChange={onAllowBuyNow} />
        <ToggleRow label={'Enable "Book Meeting"'} description="Allow clients to book a discovery call" checked={allowBookMeeting} onChange={onAllowBookMeeting} />
        {allowBookMeeting &&
          (meetingConfig !== undefined ? (
            meetingConfig
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] p-3">
              <div className="mb-2 text-sm font-semibold text-ink-100">Assigned Sales Staff</div>
              {(members ?? []).length === 0 ? (
                <p className="text-xs text-ink-40">No staff available.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(members ?? []).map((m) => {
                    const active = (assignedStaff ?? []).some((s) => s.userId === m.id);
                    return (
                      <Chip
                        key={m.id}
                        active={active}
                        onClick={() =>
                          onAssignedStaff?.(active ? (assignedStaff ?? []).filter((s) => s.userId !== m.id) : [...(assignedStaff ?? []), { userId: m.id, name: m.name }])
                        }
                      >
                        <span className="flex items-center gap-1.5">
                          <Avatar className="h-5 w-5 shrink-0">
                            {m.profileUrl && <AvatarImage src={m.profileUrl} />}
                            <AvatarFallback className="text-[9px]">{initialsOf(m.name)}</AvatarFallback>
                          </Avatar>
                          <span className="truncate">{m.name}</span>
                        </span>
                      </Chip>
                    );
                  })}
                </div>
              )}
              {(assignedStaff ?? []).length === 0 && (
                <p className="mt-2 text-xs text-warn">No staff assigned. Booking will not be available.</p>
              )}
            </div>
          ))}
        <ToggleRow label="Allow other agencies to sell this service" description="Allow generating custom proposals for this service" checked={allowSalesProposal} onChange={onAllowSalesProposal} />
        <ToggleRow label="Visibility" description="Show this in infin8 marketplace" checked={isActive} onChange={onIsActive} />
      </div>
    </div>
  );
}
