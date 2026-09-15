import { ChevronDown, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import {
  IDENTITY_GROUPS,
  identitySubtitle,
  identityVisuals,
  unreadLabel,
  type ChatIdentity,
} from './chat-types';

function IdentityAvatar({ identity, size = 32 }: { identity: ChatIdentity; size?: number }) {
  const { icon: Icon, tint, fg } = identityVisuals(identity.type);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[8px]', tint)}
      style={{ width: size, height: size }}
    >
      {identity.entityLogo ? (
        <img src={identity.entityLogo} alt="" className="h-full w-full rounded-[8px] object-cover" />
      ) : (
        <Icon className={fg} style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </span>
  );
}

function UnreadPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
      {unreadLabel(count)}
    </span>
  );
}

/**
 * "Chat as" identity selector. Grouped dropdown with section headers, colored
 * avatars and per-identity unread badges. Ports `ChatIdentitySelector`.
 */
export function IdentitySelector({
  identities,
  selected,
  unreadByKey,
  onSelect,
  onClear,
  loading,
}: {
  identities: ChatIdentity[];
  selected: ChatIdentity | null;
  unreadByKey: Record<string, number>;
  onSelect: (i: ChatIdentity) => void;
  onClear: () => void;
  loading?: boolean;
}) {
  const unreadFor = (i: ChatIdentity) => unreadByKey[`${i.type}_${i.entityId}`] ?? 0;

  return (
    <div>
      <div className="mb-1.5 flex h-5 items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-60">Chat as</span>
        {selected && (
          <button onClick={onClear} className="text-ink-60 hover:text-ink-100" aria-label="Clear identity">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={loading}
          className="flex h-12 w-full items-center gap-2 rounded-[12px] border border-ink-100 bg-card px-3 text-left disabled:opacity-60"
        >
          {selected ? (
            <>
              <IdentityAvatar identity={selected} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-100">{selected.entityName}</span>
                <span className="block truncate text-[11px] text-ink-40">{identitySubtitle(selected)}</span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-sm text-ink-40">{loading ? 'Loading…' : 'Select who to chat as…'}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-40" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {identities.length === 0 ? (
            <DropdownMenuItem disabled>No brands or agencies found</DropdownMenuItem>
          ) : (
            IDENTITY_GROUPS.map((group, gi) => {
              const items = identities.filter((i) => i.type === group.type);
              if (items.length === 0) return null;
              return (
                <div key={group.type}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[11px] tracking-[0.08em] text-ink-40">{group.label}</DropdownMenuLabel>
                  {items.map((identity) => (
                    <DropdownMenuItem
                      key={`${identity.type}_${identity.entityId}`}
                      onSelect={() => onSelect(identity)}
                      className="flex items-center gap-3 py-2"
                    >
                      <IdentityAvatar identity={identity} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-100">{identity.entityName}</span>
                        <span className="block truncate text-xs text-ink-40">{identitySubtitle(identity)}</span>
                      </span>
                      <UnreadPill count={unreadFor(identity)} />
                    </DropdownMenuItem>
                  ))}
                </div>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
