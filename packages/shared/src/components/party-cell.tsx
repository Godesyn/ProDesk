import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { initialsOf } from '../lib/utils';

export interface PartyChip {
  id: string;
  name: string;
  logoUrl?: string | null;
}

/**
 * A table-cell chip for a party (brand / agency / user): logo (or initials) + name.
 * Used by the role-aware Brand/Agency columns and the beneficiary column across the
 * payout and invoice tables. `rounded` squares the avatar for org entities
 * (brands/agencies); leave it off for people.
 */
export function PartyCell({
  party,
  rounded = true,
}: {
  party?: { name: string; logoUrl?: string | null } | null;
  rounded?: boolean;
}) {
  if (!party?.name) return <span className="text-ink-40">—</span>;
  const shape = rounded ? 'rounded-[var(--radius-sm)]' : '';
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className={`h-7 w-7 ${shape}`}>
        {party.logoUrl && <AvatarImage src={party.logoUrl} />}
        <AvatarFallback className={`text-[10px] ${shape}`}>{initialsOf(party.name)}</AvatarFallback>
      </Avatar>
      <span className="text-ink-80">{party.name}</span>
    </div>
  );
}
