import { Users, User, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar';
import { initialsOf } from '../../lib/utils';

export interface Beneficiary {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  profileUrl?: string | null;
}

const displayName = (b: Beneficiary) => [b.firstName, b.lastName].filter(Boolean).join(' ') || b.email;

/**
 * Super-admin per-user filter — ports `_UserFilterDialog`. "All Users" plus one
 * row per beneficiary (avatar, name, email), with a check on the selected one.
 */
export function UserFilterDialog({
  open,
  onOpenChange,
  beneficiaries,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  beneficiaries: Beneficiary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  function pick(id: string | null) {
    onSelect(id);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select User</DialogTitle>
          <DialogDescription>Filter earnings by beneficiary</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-[60vh] overflow-y-auto">
          <button type="button" onClick={() => pick(null)} className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors hover:bg-inset ${selectedId === null ? 'bg-inset' : ''}`}>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-inset text-ink-60"><Users className="h-5 w-5" /></span>
            <span className={`flex-1 ${selectedId === null ? 'font-semibold' : ''} text-ink-100`}>All Users</span>
            {selectedId === null && <Check className="h-5 w-5 text-ink-100" />}
          </button>
          {beneficiaries.map((b) => (
            <button key={b.id} type="button" onClick={() => pick(b.id)} className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors hover:bg-inset ${selectedId === b.id ? 'bg-inset' : ''}`}>
              <Avatar className="h-11 w-11">
                {b.profileUrl && <AvatarImage src={b.profileUrl} />}
                <AvatarFallback>{initialsOf(displayName(b)) || <User className="h-5 w-5" />}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-ink-100 ${selectedId === b.id ? 'font-semibold' : 'font-medium'}`}>{displayName(b)}</span>
                <span className="block truncate text-xs text-ink-40">{b.email}</span>
              </span>
              {selectedId === b.id && <Check className="h-5 w-5 shrink-0 text-ink-100" />}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
